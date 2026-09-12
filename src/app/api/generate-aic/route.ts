import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { callLLM } from "@/lib/llm";
import { parseTagVisibility, filterMasterTagsByGender } from "@/lib/masterTags";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

// Box-Muller transform for generating Gaussian random numbers
function randomNormal(mean = 0, stdDev = 1) {
  let u = 0, v = 0;
  while(u === 0) u = Math.random(); // Converting [0,1) to (0,1)
  while(v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + stdDev * num;
}

// Default fallback templates (strictly omitting publicBio generation)
const DEFAULT_BASE_PROMPT = `You are a world-class AI Character (AIC) creator for a virtual dating app simulation.
Your goal is to generate a fully realized, highly authentic, and deeply immersive character file in JSON format.

The character's profile details must align with the target specifications:
- Gender: {gender}
- Seeking: {looking_for}

You must construct their personality based on these target tag specifications (incorporate these heavily into their private persona and set their tag scores to align with target values):
{tags_specification}

Return a strictly valid JSON object with the following schema:
{
  "name": "First Name Only",
  "avatar": "", // portraits are assigned automatically from the local portrait library after generation
  "privatePersona": "A detailed 4-5 sentence secret prompt instruction for the LLM detailing their vibe, speech patterns, what they like in matches, and how they decide to swipe",
  "delayChance": 0.02, // A decimal value between 0.005 and 0.05 representing their response hesitation weight (higher means they take longer to answer/reply)
  "maxConsecutiveMessages": 3, // An integer between 1 and 8 representing the limit of consecutive background messages they will send in a row without a user reply
  "asyncMessageWeight": 3, // An integer between 1 and 5 representing how active/chatty they are to initiate messages (higher means they initiate more often)
  "tags": { ...a complete dictionary of all tags and their 1-10 scores... }
}

Do not write any markdown blocks (like \`\`\`json) or any meta-text. Return only raw, valid JSON.`;

// IMPORTANCE-RANK DISTRIBUTION SAMPLING for gen trait selection (overhauled from fixed
// "top 15 + 5 wildcards"): every ranked tag gets an independent pickup roll — the highest
// ranked tag has ~95% pickup probability, the lowest ~5%, decaying exponentially in between.
// No picks are guaranteed and the count is not fixed; it naturally lands in the ~20-30 zone.
// A soft clamp keeps the result inside that window using random importance-weighted
// add/drop adjustments (drops favor low-importance tags, adds favor high-importance ones).
const TRAIT_PICK_MIN = 20;
const TRAIT_PICK_MAX = 30;
function sampleTagsByRankDistribution(rankedTagNames: string[]): string[] {
  const n = rankedTagNames.length;
  if (n === 0) return [];

  const decay = Math.log(0.95 / 0.05); // maps rank 0 -> 95% and rank n-1 -> 5%
  const picked = new Set<string>();
  rankedTagNames.forEach((tag, rank) => {
    const t = n > 1 ? rank / (n - 1) : 0; // 0..1 percentile by rank
    const probability = 0.95 * Math.exp(-decay * t);
    if (Math.random() < probability) {
      picked.add(tag);
    }
  });

  let pickedArr = Array.from(picked);

  // Soft upper clamp: drop random low-importance picks if we overshot the window
  while (pickedArr.length > TRAIT_PICK_MAX) {
    const weights = pickedArr.map((t) => rankedTagNames.indexOf(t) + 1); // later rank = heavier drop weight
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    let dropAt = 0;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) {
        dropAt = i;
        break;
      }
    }
    pickedArr.splice(dropAt, 1);
  }

  // Soft lower clamp: add random high-importance unpicked tags if we undershot the window
  while (pickedArr.length < TRAIT_PICK_MIN) {
    const pickedSet = new Set(pickedArr);
    const unpicked = rankedTagNames.filter((t) => !pickedSet.has(t));
    if (unpicked.length === 0) break; // Ran out of tags entirely
    const candidate = unpicked[Math.floor(Math.random() * Math.min(5, unpicked.length))];
    pickedArr.push(candidate);
  }

  return pickedArr;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { gender: rawGender = "Female", lookingFor: rawLookingFor = "Everyone", randomizeTags = false, manualTags = null, manualDevelopedTags = null } = body;
    // Defensive type coercion: gender/lookingFor must be strings. Non-string
    // values (e.g. legacy callers passing the old randomizeTags-style boolean)
    // fall back to the defaults instead of writing a malformed persona file
    // that later fails Prisma validation on create and on every boot sync.
    const gender = typeof rawGender === "string" && rawGender.trim() ? rawGender.trim() : "Female";
    const lookingFor = typeof rawLookingFor === "string" && rawLookingFor.trim() ? rawLookingFor.trim() : "Everyone";

    // 1. Fetch active profile to run preference algorithm
    const activeProfile = await prisma.profile.findFirst({
      where: { isActive: true },
    });
    if (!activeProfile) {
      return NextResponse.json({ success: false, error: "No active profile found. Please create or activate a profile first." }, { status: 400 });
    }

    // 2. Extract master tags list
    const tagsSetting = await prisma.systemSetting.findUnique({
      where: { key: "tags_master" },
    });
    let masterTags: string[] = ["friendly", "nerdy", "adventurous", "goth", "prep", "intellectual", "humble", "sarcastic"];
    if (tagsSetting && tagsSetting.value) {
      try {
        masterTags = JSON.parse(tagsSetting.value);
      } catch (e) {}
    }

    // 2.1 Apply per-gender tag list visibility: tags hidden for this character's
    // gender are excluded from generation entirely (randomized, preference-scored,
    // and manual modes). Tags without an explicit visibility entry stay visible on
    // every list, preserving pre-feature behavior exactly.
    const tagVisibilitySetting = await prisma.systemSetting.findUnique({
      where: { key: "tags_gender_visibility" },
    });
    const tagVisibility = parseTagVisibility(tagVisibilitySetting?.value);
    masterTags = filterMasterTagsByGender(masterTags, tagVisibility, gender);
    if (masterTags.length === 0) {
      return NextResponse.json({ success: false, error: `No master tags are visible for the ${gender} tag list. Enable at least one tag for this gender in Manager → Global Settings → Master Tags Library.` }, { status: 400 });
    }

    // Collect all tags from active characters as well
    const allCharacters = await prisma.character.findMany({
      where: { disabled: false } as any,
    }) as any[];

    const tagsRegistry = new Set<string>(masterTags);
    allCharacters.forEach((char: any) => {
      if (char.tags) {
        try {
          const parsed = JSON.parse(char.tags);
          Object.keys(parsed).forEach((t) => tagsRegistry.add(t));
        } catch (e) {}
      }
    });

    const allTags = Array.from(tagsRegistry);

    let selectedTags: { tag: string; target: number; importance: number }[] = [];
    let wildcardTags: string[] = [];
    let noisyScores: any[] = [];

    if (manualTags) {
      // 2.5 Manual tags mode (Feature #4)
      const devArray = Array.isArray(manualDevelopedTags) ? manualDevelopedTags : [];
      selectedTags = devArray.map(tag => ({
        tag,
        target: Number(manualTags[tag] ?? 5),
        importance: 1.0,
      }));
      wildcardTags = [];
    } else if (randomizeTags) {
      // 3. Skip preference scoring and generate fully randomized tags, sampled as a
      // distribution over a random rank order (no fixed count; lands around 20-30 traits)
      const shuffledTags = [...masterTags].sort(() => Math.random() - 0.5);
      const pickedTags = sampleTagsByRankDistribution(shuffledTags);

      selectedTags = pickedTags.map(tag => ({
        tag,
        // Completely random target between 1.0 and 10.0
        target: Math.round((Math.random() * 9 + 1) * 10) / 10,
        // Completely random importance between 0.0 and 1.0
        importance: Math.round(Math.random() * 1000) / 1000,
      }));
      wildcardTags = [];
    } else {
      // PREFERENCE SCORING ALGORITHM
      // Fetch reset timestamp if any
      const resetSetting = await prisma.systemSetting.findUnique({
        where: { key: `preferences_reset_at_${activeProfile.id}` },
      });
      const resetDate = resetSetting ? new Date(resetSetting.value) : new Date(0);

      // Fetch interactions since reset
      const interactions = await prisma.interaction.findMany({
        where: {
          profileId: activeProfile.id,
          updatedAt: { gte: resetDate },
        },
        include: {
          character: true,
          messages: true,
        },
      }) as any[];

      // Event weights map
      const calculatedInteractions = interactions.map((inter) => {
        let weight = 0;
        if (inter.userStatus === "like") weight += 1.0;
        if (inter.userStatus === "pass") weight -= 0.1;
        if (inter.aicStatus === "like" || inter.aicStatus === "slide-in") weight += 1.0;
        if (inter.aicStatus === "pass") weight -= 0.5;
        if (inter.matched) weight += 3.0;

        // Unmatching events Preference Weights (Topic C #3)
        if (inter.unmatched) {
          if (inter.unmatchedBy === "user") {
            weight -= 0.1; // Equivalent weight as user pass (-0.1)
          } else if (inter.unmatchedBy === "assistant") {
            weight -= 0.5; // Equivalent weight as AIC pass (-0.5)
          }
        }

        const msgCount = inter.messages.length;
        if (msgCount >= 50) {
          weight += 10.0;
        } else if (msgCount >= 10) {
          weight += 5.0;
        }

        return {
          tags: inter.character.tags,
          developedTags: inter.character.developedTags,
          weight,
        };
      });

      // Helper to calculate target value, importance, and confidence for a tag
      const getTagMetrics = (tag: string, targetInteractions: typeof calculatedInteractions) => {
        let sumOfWeights = 0;
        let weightedSumOfValues = 0;
        let tagInteractionsCount = 0;
        const values: { impliedVal: number; absWeight: number }[] = [];

        targetInteractions.forEach((inter) => {
          if (!inter.tags) return;
          try {
            const parsedTags = JSON.parse(inter.tags);
            const rawVal = parsedTags[tag];
            if (rawVal === undefined || rawVal === null) return;

            // Weight non-developing traits by a factor of 0.1
            let weightMultiplier = 1.0;
            let isDeveloped = true;
            if (inter.developedTags) {
              try {
                const developedArray = JSON.parse(inter.developedTags);
                if (Array.isArray(developedArray)) {
                  if (!developedArray.includes(tag)) {
                    weightMultiplier = 0.1;
                    isDeveloped = false;
                  }
                } else {
                  const developedArrayFallback = String(inter.developedTags).split(",").map(t => t.trim());
                  if (!developedArrayFallback.includes(tag)) {
                    weightMultiplier = 0.1;
                    isDeveloped = false;
                  }
                }
              } catch (err) {
                const developedArray = String(inter.developedTags).split(",").map(t => t.trim());
                if (!developedArray.includes(tag)) {
                  weightMultiplier = 0.1;
                  isDeveloped = false;
                }
              }
            }

            const charTagScore = Number(rawVal);
            if (isDeveloped) {
              tagInteractionsCount++;
            }

            const absWeight = Math.abs(inter.weight) * weightMultiplier;
            let impliedVal = charTagScore;

            if (inter.weight < 0) {
              impliedVal = 10 - charTagScore + 1; // Flip pass values
            }

            values.push({ impliedVal, absWeight });
            weightedSumOfValues += absWeight * impliedVal;
            sumOfWeights += absWeight;
          } catch (e) {}
        });

        // Target (Sweet Spot)
        const target = sumOfWeights > 0 ? (weightedSumOfValues / sumOfWeights) : 5.0;

        // Variance
        let weightedVarianceSum = 0;
        values.forEach((v) => {
          weightedVarianceSum += v.absWeight * Math.pow(v.impliedVal - target, 2);
        });
        const variance = sumOfWeights > 0 ? (weightedVarianceSum / sumOfWeights) : 8.0;

        // Importance: Normalized 0.0 to 1.0 based on exponential variance decay
        const importance = sumOfWeights > 0 ? Math.exp(-variance / 12.0) : 0.0;

        // Confidence: Normalized 0.0 to 1.0 based on interaction count
        const confidence = 1.0 - Math.exp(-tagInteractionsCount / 8.0);

        return { target, importance, confidence };
      };

      // Load existing preference overrides (Topic D #1)
      const overridesSetting = await prisma.systemSetting.findUnique({
        where: { key: "preference_overrides" }
      });
      let overrides: Record<string, { target?: number; importance?: number; confidence?: number }> = {};
      if (overridesSetting && overridesSetting.value) {
        try {
          overrides = JSON.parse(overridesSetting.value);
        } catch (e) {}
      }

      // Calculate metrics for Historical and Recent, and combine them (30% hist, 70% rec)
      const combinedScores = masterTags.map((tag) => {
        const hist = getTagMetrics(tag, calculatedInteractions);
        const rec = getTagMetrics(tag, calculatedInteractions.slice(0, 15));

        let combinedTarget = hist.target * 0.3 + rec.target * 0.7;
        let combinedImportance = hist.importance * 0.3 + rec.importance * 0.7;
        let combinedConfidence = hist.confidence * 0.3 + rec.confidence * 0.7;

        // Apply preference score overrides if configured
        const override = overrides[tag];
        if (override) {
          if (override.target !== undefined) combinedTarget = override.target;
          if (override.importance !== undefined) combinedImportance = override.importance;
          if (override.confidence !== undefined) combinedConfidence = override.confidence;
        }

        return {
          tag,
          target: combinedTarget,
          importance: combinedImportance,
          confidence: combinedConfidence,
        };
      });

      // 5. Apply temperature / Gaussian noise based on Confidence
      // Low confidence = wider swings. High confidence = tight distribution but still allowing substantial swings
      noisyScores = combinedScores.map((score: any) => {
        // Swings standard deviations:
        // If confidence is 0: sdTarget = 5.0, sdImportance = 0.5
        // If confidence is 1: sdTarget = 1.5, sdImportance = 0.15
        const sdTarget = 5.0 * (1.0 - score.confidence) + 1.5;
        const sdImportance = 0.5 * (1.0 - score.confidence) + 0.15;

        // Add normal noise
        const noiseT = randomNormal(0, sdTarget);
        const noiseI = randomNormal(0, sdImportance);

        // Clamp target strictly between 1.0 and 10.0 to prevent underflows/overflows
        const noisyTarget = Math.max(1.0, Math.min(10.0, score.target + noiseT));
        // Clamp importance strictly between 0.0 and 1.0
        const noisyImportance = Math.max(0.0, Math.min(1.0, score.importance + noiseI));

        return {
          tag: score.tag,
          rawTarget: score.target,
          rawImportance: score.importance,
          confidence: score.confidence,
          target: Math.round(noisyTarget * 10) / 10,
          importance: Math.round(noisyImportance * 1000) / 1000,
        };
      });

      // Rank tags based on noisy importance
      const rankedTags = noisyScores.sort((a, b) => b.importance - a.importance);

      // IMPORTANCE-RANK DISTRIBUTION SAMPLING (overhauled): every active tag gets an
      // independent pickup roll weighted by its noisy-importance rank (~95% for rank 1 down
      // to ~5% for the lowest). No guaranteed picks, no fixed count — softly clamped to ~20-30.
      const pickedTagNames = sampleTagsByRankDistribution(rankedTags.map((s) => s.tag));
      selectedTags = pickedTagNames
        .map((tag) => rankedTags.find((s) => s.tag === tag))
        .filter((s): s is (typeof rankedTags)[number] => !!s);
      wildcardTags = [];
    }

    // Compile tag specs string
    const specifications: string[] = [];
    selectedTags.forEach((score, idx) => {
      let ratingDescription = "Medium-low (around 3-4)";
      if (score.target >= 8.5) ratingDescription = "Very high (9-10)";
      else if (score.target >= 6.5) ratingDescription = "High (7-8)";
      else if (score.target >= 4.5) ratingDescription = "Moderate/Sweet-spot (5-6)";
      else if (score.target >= 2.5) ratingDescription = "Low (2-3)";
      else ratingDescription = "Very low (1-2)";

      const importanceText = score.importance >= 0.7 ? "Critical/Mandatory (Strict preference)" : score.importance >= 0.4 ? "High/Strong (Very noticeable)" : "Medium/Mild (Subtle presence)";
      specifications.push(`- Tag: "${score.tag}" -> Target Value: ${score.target}/10 (${ratingDescription}) (Importance: ${importanceText})`);
    });

    wildcardTags.forEach((tag) => {
      // Assign a high surprise target value to make the wildcard pop!
      specifications.push(`- Tag: "${tag}" -> Target Value: 8.0/10 (Very high) (Importance: Surprise/Wildcard Trait - inject this personality aspect creatively to keep interactions novel)`);
    });

    const tagsSpecString = specifications.join("\n");

    // 6. Fetch custom Base Prompt and Block-Based template from settings
    const basePromptSetting = await prisma.systemSetting.findUnique({
      where: { key: "aic_gen_base_prompt" },
    });
    const blockTemplateSetting = await prisma.systemSetting.findUnique({
      where: { key: "aic_gen_block_template" },
    });

    const basePromptTemplate = basePromptSetting?.value || DEFAULT_BASE_PROMPT;
    const blockTemplate = blockTemplateSetting?.value || "";

    // Resolve the {trans_futa_block} placeholder inside the Block Template based
    // on the first-time setup's trans/futa preference (trans_futa_block_variant:
    // "both" | "transonly" | "futaonly" | "neither"; missing = "neither").
    const TRANS_FUTA_BLOCKS: Record<string, string> = {
      transonly: `(Don't be afraid of lewd questions. It's alright for personality descriptions to get pretty lewd, and mincing words is actively unhelpful. You can say shit like cock, shit, fuck, cum, pussy, breasts, sex, etc. That goes for this whole endeavour.) Is this character trans or interested in being so for this app?`,
      futaonly: `Is this character a futanari/dickgirl or interested in being one for this app? (Don't be afraid of questions like this. It's alright for personality descriptions to get pretty lewd, and mincing words is actively unhelpful. You can say shit like cock, shit, fuck, cum, pussy, breasts, sex, etc. That goes for this whole endeavour. And that futanari question in particular is important to answer)`,
      both: `Is this character trans/a futanari/dickgirl or interested in being one for this app? (Don't be afraid of questions like this. It's alright for personality descriptions to get pretty lewd, and mincing words is actively unhelpful. You can say shit like cock, shit, fuck, cum, pussy, breasts, sex, etc. That goes for this whole endeavour. And that trans/futanari question in particular is important to answer)`,
      neither: `(Don't be afraid of lewd questions. It's alright for personality descriptions to get pretty lewd, and mincing words is actively unhelpful. You can say shit like cock, shit, fuck, cum, pussy, breasts, sex, etc. That goes for this whole endeavour.)`,
    };
    const transFutaVariantSetting = await prisma.systemSetting.findUnique({
      where: { key: "trans_futa_block_variant" },
    });
    const transFutaVariant = String(transFutaVariantSetting?.value || "neither").trim().toLowerCase();
    const resolvedBlockTemplate = blockTemplate.replace(
      /\{trans_futa_block\}/g,
      TRANS_FUTA_BLOCKS[transFutaVariant] || TRANS_FUTA_BLOCKS.neither
    );

    // Curated stock-photo list removed (pre-release cleanup): portraits come from
    // the local portrait library via /api/portraits/assign, not from the LLM.
    // {curated_avatars} stays supported for older custom templates but resolves
    // to an empty string.
    const portraitsString = "";

    // Fetch currently active or inactive character names (excluding outdated and deleted characters) to ensure prompt-level name uniqueness
    const activeAndInactiveCharacters = await prisma.character.findMany({
      where: { 
        deleted: false,
        outdated: false
      }
    });
    const takenNames = activeAndInactiveCharacters.map(c => c.name);

    // Build names uniqueness and naming style guidelines instruction to encourage contextual name selection
    const namesList = takenNames.join(", ");
    const styleInstruction = `
NAME SELECTION GUIDELINES:
- Choose a name that perfectly fits the character's generated traits and private persona.
- For standard, realistic, everyday characters (e.g. a barista, student, or gym trainer), lean towards realistic, natural dating app names. These can range from common names (e.g., Emily, Jessica, Sarah, Michael, James) to moderately uncommon names (e.g., Callie, Bryn, Celeste, Darcy, Zara, Leo).
- If the character has unusual, eccentric, futuristic, royal, fantasy, or sci-fi traits, let their name be creative, wild, poetic, or completely unique to match their specific vibe! Examples of appropriate matches:
  - Poetic/Gothic/Dramatic traits: e.g., "Threnody" or "Zuleika"
  - Royal/Historical/Classical traits: e.g., "Queen Margaret" or "Cleopatra"
  - Overt Robot/Cyborg/Mechanical traits: e.g., "Unit X823b7"
- The name can be completely unique or something nobody has ever heard of before, as long as it directly matches and enhances the persona's concept.
- CRITICAL NAME UNIQUENESS RULE: The following names are ALREADY taken by active/inactive characters in the app and MUST NOT be used under any circumstances: ${namesList}. You MUST choose a name that is NOT on this list.
`;

    const nameInstruction = takenNames.length > 0 
      ? `\n${styleInstruction}`
      : `\nNAME SELECTION GUIDELINES:
- Choose a name that perfectly fits the character's generated traits and private persona.
- For standard, realistic, everyday characters (e.g. a barista, student, or gym trainer), lean towards realistic, natural dating app names (ranging from common names like Emily, Sarah, James to moderately uncommon names like Callie, Zara, Leo).
- If the character has unusual, eccentric, futuristic, royal, fantasy, or sci-fi traits, let their name be creative, wild, poetic, or completely unique to match their specific vibe (e.g., "Threnody", "Zuleika", "Queen Margaret", or "Unit X823b7").
- The name can be completely unique or something nobody has ever heard of before, as long as it directly matches and enhances the concept.`;

    // Build the final prompt dynamically with configurable naming prompt guidelines
    const namePromptSetting = await prisma.systemSetting.findUnique({
      where: { key: "prompt_name_generation" },
    });
    const customStyleInstruction = namePromptSetting?.value || `NAME SELECTION GUIDELINES:
- Choose a name that perfectly fits the character's generated traits and private persona.
- For standard characters, lean towards realistic, natural dating app names (ranging from common names like Emily, Sarah, James to moderately uncommon names like Callie, Zara, Leo).
- If the character has unusual, eccentric, futuristic, royal, fantasy, or sci-fi traits, let their name be creative, wild, poetic, or completely unique to match their specific vibe (e.g., "Threnody", "Zuleika", "Queen Margaret", or "Unit X823b7").
- The name can be completely unique or something nobody has ever heard of before, as long as it directly matches and enhances the concept.
- CRITICAL UNIQUENESS RULE: The following names are taken and MUST NOT be used: {taken_names}. You MUST choose a name NOT on this list.`;

    const customNameInstruction = "\n" + customStyleInstruction.replace(/{taken_names}/g, namesList);

    const finalPrompt = basePromptTemplate
      .replace(/{gender}/g, gender)
      .replace(/{looking_for}/g, lookingFor)
      .replace(/{tags_specification}/g, tagsSpecString)
      .replace(/{curated_avatars}/g, portraitsString)
      .replace(/{block_template}/g, resolvedBlockTemplate) + customNameInstruction;

    // Call active LLM with the AIC Generation task scope
    const rawResult = await callLLM(
      "You are a backend server that generates high-quality character profile specifications in strictly valid JSON format.",
      [{ role: "user", content: finalPrompt }],
      undefined,
      false,
      "persona_generation"
    );

    // Parse LLM JSON cleanly
    let parsedChar: any;
    try {
      const jsonMatch = rawResult.match(/\{[\s\S]*\}/);
      const cleaned = jsonMatch ? jsonMatch[0] : rawResult;
      parsedChar = JSON.parse(cleaned);
    } catch (e: any) {
      console.error("Failed to parse JSON from LLM result:", rawResult, e);
      return NextResponse.json({ success: false, error: "LLM failed to output valid JSON. Raw output: " + rawResult }, { status: 500 });
    }

    let charName = parsedChar.name || "Generated";
    
    // Database-level uniqueness safety fallback (checks names of active or inactive characters, ignoring deleted or outdated ones)
    const nameExists = await prisma.character.findFirst({
      where: { 
        name: charName, 
        deleted: false,
        outdated: false
      }
    });
    if (nameExists) {
      // Loop up to 3 times to generate a contextually fitting, 100% unique name using the LLM naming prompt
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const currentTakenNames = (await prisma.character.findMany({
            where: { deleted: false, outdated: false },
            select: { name: true }
          })).map(c => c.name.trim());

          const namePromptSetting = await prisma.systemSetting.findUnique({
            where: { key: "prompt_name_generation" },
          });
          
          const baseNamePrompt = namePromptSetting?.value || "Choose a name that perfectly fits the character's generated traits and private persona. CRITICAL UNIQUENESS RULE: The following names are taken and MUST NOT be used: {taken_names}.";
          const finalNamePrompt = baseNamePrompt
            .replace(/{private_persona}/g, parsedChar.privatePersona || "")
            .replace(/{tags_specification}/g, JSON.stringify(parsedChar.tags || {}))
            .replace(/{taken_names}/g, currentTakenNames.join(", "));

          const rawNameResult = await callLLM(
            "You are a backend server that generates high-quality character names in strictly valid JSON format.",
            [{ role: "user", content: finalNamePrompt }],
            undefined,
            false,
            "name_generation"
          );
          
          const jsonMatch = rawNameResult.match(/\{[\s\S]*\}/);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawNameResult);
          const candidateName = (parsed.name || parsed.newName || "").trim();
          
          if (candidateName && !currentTakenNames.includes(candidateName)) {
            charName = candidateName;
            break;
          }
        } catch (e) {
          console.error("Attempt to regenerate duplicate name failed:", e);
        }
      }
    }

    const charId = charName.toLowerCase().replace(/[^a-z0-9]/g, "") + "_" + Date.now().toString().slice(-4);
    
    // Per user instructions, newly created characters start with no profile image (blank avatar)
    // Image selection will be handled by the intelligent Image-Picker later
    const avatarUrl = "";

    // Newly generated characters do not have a voice initially; voice assignment is handled separately
    const voiceId = "";

    // Build full dictionary of tags matching masterTags
    const finalTagsMap: Record<string, number> = {};
    masterTags.forEach((t) => {
      if (manualTags) {
        // If manual tags mode, use manualTags score or fallback to 5 (Feature #4)
        finalTagsMap[t] = Number(manualTags[t] !== undefined ? manualTags[t] : 5);
      } else if (randomizeTags) {
        // Seed every single master tag with a random value from 1 to 10
        finalTagsMap[t] = Math.floor(Math.random() * 10) + 1;
      } else {
        // Seed every single master tag with its dynamically calculated preference score
        const calculated = noisyScores.find(s => s.tag === t);
        finalTagsMap[t] = calculated ? Math.max(1, Math.min(10, Math.round(calculated.target))) : 1;
      }
    });

    if (parsedChar.tags) {
      Object.entries(parsedChar.tags).forEach(([tag, val]) => {
        const score = Number(val);
        if (!isNaN(score)) {
          finalTagsMap[tag] = Math.max(1, Math.min(10, Math.round(score)));
        }
      });
    }

    // Force tags spec mapping directly to guarantee target values are aligned
    selectedTags.forEach((score) => {
      finalTagsMap[score.tag] = Math.max(1, Math.min(10, Math.round(score.target)));
    });
    wildcardTags.forEach((tag) => {
      finalTagsMap[tag] = 8;
    });

    const developedTagsArray = [...selectedTags.map(s => s.tag), ...wildcardTags];

    // Enforce publicBio remains empty per user specifications
    const dbCharacterData = {
      id: charId,
      name: charName,
      gender,
      lookingFor,
      avatar: avatarUrl,
      voiceId,
      publicBio: "", // strictly empty (handled by separate generation action later)
      privatePersona: parsedChar.privatePersona || "",
      tags: JSON.stringify(finalTagsMap),
      disabled: false,
      delayChance: parsedChar.delayChance !== undefined ? parseFloat(parsedChar.delayChance) : (Math.random() * 0.045 + 0.005),
      userFollowUpResponseChance: parsedChar.userFollowUpResponseChance !== undefined ? parseFloat(parsedChar.userFollowUpResponseChance) : (Math.random() * 0.90 + 0.05),
      maxConsecutiveMessages: parsedChar.maxConsecutiveMessages !== undefined ? parseInt(parsedChar.maxConsecutiveMessages) : (Math.floor(Math.random() * 8) + 1),
      asyncMessageWeight: parsedChar.asyncMessageWeight !== undefined ? parseInt(parsedChar.asyncMessageWeight) : (Math.floor(Math.random() * 5) + 1),
      developedTags: JSON.stringify(developedTagsArray),
    };

    // Save JSON physically into AIC personas
    const directoryPath = path.join(process.cwd(), "AIC personas");
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }
    const filePath = path.join(directoryPath, `${charId}.json`);
    
    const fileContent = {
      id: charId,
      name: charName,
      gender,
      lookingFor,
      avatar: avatarUrl,
      voiceId,
      publicBio: "", // strictly empty
      privatePersona: dbCharacterData.privatePersona,
      delayChance: dbCharacterData.delayChance,
      userFollowUpResponseChance: dbCharacterData.userFollowUpResponseChance,
      maxConsecutiveMessages: dbCharacterData.maxConsecutiveMessages,
      asyncMessageWeight: dbCharacterData.asyncMessageWeight,
      tags: finalTagsMap,
      developedTags: developedTagsArray,
    };

    fs.writeFileSync(filePath, JSON.stringify(fileContent, null, 2), "utf-8");

    // Insert into SQLite database
    const createdChar = await prisma.character.create({
      data: dbCharacterData,
    });

    return NextResponse.json({
      success: true,
      character: createdChar,
    });
  } catch (error: any) {
    console.error("Error generating AIC:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
