import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import {
  getMetaAdAccountInsights,
  listAssignedMetaAdAccounts,
} from "@/lib/meta-marketing";

const MAX_ACCOUNTS_SENT_TO_MODEL = 50;

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error("Agent configuration is incomplete.");
  }

  return value;
}

function getTodayInKorea(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function runMetaAssistant(prompt: string): Promise<{
  answer: string;
  stepCount: number;
}> {
  const apiKey = getRequiredEnv("OPENROUTER_API_KEY");
  const modelName = getRequiredEnv("OPENROUTER_MODEL");
  const openrouter = createOpenRouter({ apiKey });
  const today = getTodayInKorea();

  const result = await generateText({
    model: openrouter(modelName),
    system: [
      "당신은 Meta 광고 데이터 분석 도우미입니다.",
      `오늘 날짜는 ${today}이며 기준 시간대는 Asia/Seoul입니다.`,
      "반드시 제공된 도구 실행 결과만 근거로 답하세요.",
      "도구 결과에 없는 수치나 사실을 추정하지 마세요.",
      "인사이트 도구의 hasData가 false이면 수치를 0으로 해석하지 말고, 해당 기간에 Meta가 반환한 성과 데이터가 없다고 안내하세요.",
      "인사이트 도구의 hasData가 true이고 metrics 값이 0인 경우에만 실제 수치 0으로 설명하세요.",
      "사용자가 명시적으로 요청하지 않는 한 광고계정 ID는 표시하지 마세요.",
      "광고 성과 질문에는 광고계정과 조회 기간이 필요합니다.",
      "사용자가 기간을 명시하지 않았다면 임의의 기간을 만들지 말고 시작일과 종료일을 요청하세요.",
      "광고계정 이름이 모호하면 후보를 안내하고 더 정확한 이름을 요청하세요.",
      "비용, CPC, CPM 등 금액은 광고계정 통화와 함께 표시하세요.",
      "CTR과 빈도는 필요한 경우 소수점 둘째 자리 수준으로 읽기 쉽게 표현하세요.",
      "현재 도구는 조회 전용이며 광고 생성, 수정, 중지 또는 계정 권한 변경을 할 수 없습니다.",
      "답변은 한국어로 작성하세요.",
    ].join("\n"),
    prompt,
    tools: {
      listMetaAdAccounts: tool({
        description:
          "현재 시스템 사용자에게 할당된 Meta 광고계정 목록, 활성 상태, 통화 및 시간대 정보를 조회합니다.",
        inputSchema: z.object({}),
        execute: async () => {
          const accounts = await listAssignedMetaAdAccounts();
          const currencyCounts = accounts.reduce<Record<string, number>>(
            (accumulator, account) => {
              const currency = account.currency ?? "UNKNOWN";
              accumulator[currency] = (accumulator[currency] ?? 0) + 1;
              return accumulator;
            },
            {},
          );

          return {
            totalAccountCount: accounts.length,
            activeAccountCount: accounts.filter(
              (account) => account.account_status === 1,
            ).length,
            inactiveAccountCount: accounts.filter(
              (account) => account.account_status !== 1,
            ).length,
            currencyCounts,
            truncated: accounts.length > MAX_ACCOUNTS_SENT_TO_MODEL,
            accounts: accounts.slice(0, MAX_ACCOUNTS_SENT_TO_MODEL).map((account) => ({
              name: account.name ?? "이름 없는 광고계정",
              isActive: account.account_status === 1,
              statusCode: account.account_status,
              disableReason: account.disable_reason,
              currency: account.currency,
              timezone: account.timezone_name,
            })),
          };
        },
      }),
      getMetaAdAccountInsights: tool({
        description:
          "특정 Meta 광고계정의 지정 기간 통합 성과를 조회합니다. 해당 기간에 데이터 행이 없으면 hasData가 false입니다.",
        inputSchema: z.object({
          accountQuery: z.string().trim().min(1).max(200),
          since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
        execute: getMetaAdAccountInsights,
      }),
    },
    prepareStep: ({ stepNumber }) => ({
      toolChoice: stepNumber === 0 ? "required" : "auto",
    }),
    stopWhen: stepCountIs(4),
    temperature: 0.1,
    maxOutputTokens: 1200,
  });

  return { answer: result.text, stepCount: result.steps.length };
}
