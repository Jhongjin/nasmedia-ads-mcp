"use server";

import { runMetaAssistant } from "@/lib/agent-service";
import { getOperatorSession } from "@/lib/operator-auth";

export type AssistantActionState = {
  answer?: string;
  error?: string;
};

export async function askAssistant(
  _previousState: AssistantActionState,
  formData: FormData,
): Promise<AssistantActionState> {
  const session = await getOperatorSession();

  if (!session) {
    return { error: "회사 SSO 로그인 후 사용할 수 있습니다." };
  }

  const prompt = formData.get("prompt");

  if (typeof prompt !== "string" || !prompt.trim()) {
    return { error: "질문을 입력해 주세요." };
  }

  if (prompt.trim().length > 2000) {
    return { error: "질문은 2,000자 이하로 입력해 주세요." };
  }

  try {
    const result = await runMetaAssistant(prompt.trim());
    return { answer: result.answer };
  } catch {
    console.error("Meta assistant action failed.");
    return { error: "AI 어시스턴트를 실행하지 못했습니다. 연결 및 권한 설정을 확인해 주세요." };
  }
}
