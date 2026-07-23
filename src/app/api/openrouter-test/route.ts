import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const modelName = process.env.OPENROUTER_MODEL;

  if (!apiKey || !modelName) {
    return Response.json(
      {
        ok: false,
        error: "OpenRouter 환경변수가 설정되지 않았습니다.",
        missing: {
          OPENROUTER_API_KEY: !apiKey,
          OPENROUTER_MODEL: !modelName,
        },
      },
      { status: 500 },
    );
  }

  try {
    const openrouter = createOpenRouter({
      apiKey,
    });

    const result = await generateText({
      model: openrouter(modelName),
      prompt: "다른 설명 없이 정확히 OPENROUTER_OK라고만 답하세요.",
    });

    return Response.json({
      ok: true,
      model: modelName,
      response: result.text.trim(),
    });
  } catch (error) {
    console.error("OpenRouter test failed:", error);

    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "OpenRouter 호출 중 알 수 없는 오류가 발생했습니다.",
      },
      { status: 500 },
    );
  }
}