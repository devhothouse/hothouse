import { NextResponse } from "next/server";
import { testModelConfig } from "@/lib/llm";
import { normalizeLlmProvider } from "@/lib/llmTasks";

export const runtime = "nodejs";

/**
 * POST /api/settings/test-model
 * Verifies a Model Config (provider + model + API key + optional base URL)
 * by sending a tiny prompt through the normal provider pipeline. Used by the
 * Manager tab's "AI Model Manager" Test Connection buttons.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { model, apiKey, baseUrl } = body;
    // "local" is the first-class UI alias for the OpenAI-compatible pipeline.
    const provider = normalizeLlmProvider(body.provider);

    if (!provider || !model) {
      return NextResponse.json(
        { success: false, error: "Provider and model are required." },
        { status: 400 }
      );
    }
    // OpenAI-compatible endpoints with a custom (non-OpenAI) base URL — e.g.
    // local Ollama / LM Studio / llama.cpp / vLLM servers — may run without
    // an API key, so the key requirement only applies otherwise.
    const isKeylessLocal =
      provider === "openai" &&
      String(baseUrl || "").trim() !== "" &&
      !/^https:\/\/api\.openai\.com/i.test(String(baseUrl).trim());
    if ((!apiKey || !String(apiKey).trim()) && !isKeylessLocal) {
      return NextResponse.json(
        { success: false, error: "API key is required." },
        { status: 400 }
      );
    }

    await testModelConfig(provider, model, apiKey || "", body.temperature, body.maxTokens, baseUrl);

    return NextResponse.json({
      success: true,
      message: `Connection OK — ${provider}/${model} replied successfully.`,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 200 });
  }
}