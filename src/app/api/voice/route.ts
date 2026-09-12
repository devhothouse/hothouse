import { NextResponse } from "next/server";
import { synthesizeSpeech } from "@/lib/tts";

export const runtime = "nodejs";

/**
 * POST /api/voice — text-to-speech through the ACTIVE TTS provider
 * (ElevenLabs by default; switchable in Manager → TTS Settings across
 * ElevenLabs, OpenAI/compatible, Google Cloud, Cartesia, Fish Audio, and
 * any Custom HTTP bridge).
 * Returns raw audio bytes on success; JSON {success:false,error} on failure.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, voiceId } = body;

    if (!text || !voiceId) {
      return NextResponse.json({ success: false, error: "text and voiceId are required." }, { status: 400 });
    }

    const result = await synthesizeSpeech(String(text), String(voiceId));

    return new Response(new Uint8Array(result.audio), {
      headers: {
        "Content-Type": result.contentType,
      },
    });
  } catch (error: any) {
    console.error("Voice API Error:", error);
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
}
