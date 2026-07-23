import { timingSafeEqual } from "node:crypto";

import { runMetaAssistant } from "@/lib/agent-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function safeSecretEquals(provided: string | null, expected: string): boolean {
  if (!provided) {
    return false;
  }

  const providedBuffer = Buffer.from(provided, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

export async function POST(request: Request) {
  const expectedSecret = process.env.AGENT_TEST_SECRET;

  if (!expectedSecret) {
    return Response.json(
      { ok: false, error: "서버 인증 설정이 완료되지 않았습니다." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!safeSecretEquals(request.headers.get("x-agent-secret"), expectedSecret)) {
    return Response.json(
      { ok: false, error: "인증되지 않은 요청입니다." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  let prompt = "접근 가능한 Meta 광고계정의 현황을 요약해 주세요.";

  try {
    const body = (await request.json()) as { prompt?: unknown };
    if (typeof body.prompt === "string" && body.prompt.trim()) {
      prompt = body.prompt.trim();
    }
  } catch {
    // A body is optional for the protected test utility.
  }

  if (prompt.length > 2000) {
    return Response.json(
      { ok: false, error: "질문은 2,000자 이하로 입력해 주세요." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await runMetaAssistant(prompt);
    return Response.json(
      { ok: true, answer: result.answer, stepCount: result.stepCount },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error("Protected Meta assistant execution failed.");
    return Response.json(
      { ok: false, error: "에이전트 실행 중 오류가 발생했습니다." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
