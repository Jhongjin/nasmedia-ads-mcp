import { timingSafeEqual } from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  generateText,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";

import {
  getMetaAdAccountInsights,
  listAssignedMetaAdAccounts,
} from "@/lib/meta-marketing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ACCOUNTS_SENT_TO_MODEL = 50;

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `${name} 환경변수가 설정되지 않았습니다.`,
    );
  }

  return value;
}

function safeSecretEquals(
  provided: string | null,
  expected: string,
): boolean {
  if (!provided) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(
    providedBuffer,
    expectedBuffer,
  );
}

export async function POST(request: Request) {
  const expectedSecret = getRequiredEnv(
    "AGENT_TEST_SECRET",
  );

  const providedSecret = request.headers.get(
    "x-agent-secret",
  );

  if (
    !safeSecretEquals(
      providedSecret,
      expectedSecret,
    )
  ) {
    return Response.json(
      {
        ok: false,
        error: "인증되지 않은 요청입니다.",
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  let prompt =
    "접근 가능한 Meta 광고계정의 현황을 요약해 주세요.";

  try {
    const body = (await request.json()) as {
      prompt?: unknown;
    };

    if (
      typeof body.prompt === "string" &&
      body.prompt.trim()
    ) {
      if (body.prompt.length > 2000) {
        return Response.json(
          {
            ok: false,
            error:
              "질문은 2,000자 이하로 입력해 주세요.",
          },
          { status: 400 },
        );
      }

      prompt = body.prompt.trim();
    }
  } catch {
    // 요청 본문이 없으면 기본 질문을 사용합니다.
  }

  try {
    const apiKey = getRequiredEnv(
      "OPENROUTER_API_KEY",
    );

    const modelName = getRequiredEnv(
      "OPENROUTER_MODEL",
    );

    const openrouter = createOpenRouter({
      apiKey,
    });

    const today = new Date()
      .toISOString()
      .slice(0, 10);

    const result = await generateText({
      model: openrouter(modelName),

      system: [
        "당신은 Meta 광고 데이터 분석 도우미입니다.",
        `오늘 날짜는 ${today}입니다.`,
        "반드시 제공된 도구 실행 결과만 근거로 답하세요.",
        "도구 결과에 없는 수치나 사실을 추정하지 마세요.",
        "사용자가 명시적으로 요청하지 않는 한 광고계정 ID는 표시하지 마세요.",
        "광고 성과 질문에는 반드시 광고계정과 조회 기간이 필요합니다.",
        "기간이 없으면 임의로 정하지 말고 필요한 시작일과 종료일을 요청하세요.",
        "광고계정 이름이 모호하면 후보를 안내하고 더 정확한 이름을 요청하세요.",
        "비용은 광고계정 통화와 함께 표시하세요.",
        "현재 도구는 조회 전용이며 광고를 생성하거나 수정할 수 없습니다.",
        "답변은 한국어로 작성하세요.",
      ].join("\n"),

      prompt,

      tools: {
        listMetaAdAccounts: tool({
          description:
            "현재 시스템 사용자에게 할당된 Meta 광고계정 목록, 활성 상태, 통화 정보를 조회합니다.",

          inputSchema: z.object({}),

          execute: async () => {
            const accounts =
              await listAssignedMetaAdAccounts();

            const currencyCounts =
              accounts.reduce<Record<string, number>>(
                (result, account) => {
                  const currency =
                    account.currency ?? "UNKNOWN";

                  result[currency] =
                    (result[currency] ?? 0) + 1;

                  return result;
                },
                {},
              );

            const activeAccountCount =
              accounts.filter(
                (account) =>
                  account.account_status === 1,
              ).length;

            return {
              totalAccountCount: accounts.length,
              activeAccountCount,
              inactiveAccountCount:
                accounts.length -
                activeAccountCount,
              currencyCounts,
              truncated:
                accounts.length >
                MAX_ACCOUNTS_SENT_TO_MODEL,
              accounts: accounts
                .slice(
                  0,
                  MAX_ACCOUNTS_SENT_TO_MODEL,
                )
                .map((account) => ({
                  name:
                    account.name ??
                    "이름 없는 광고계정",
                  isActive:
                    account.account_status === 1,
                  statusCode:
                    account.account_status,
                  disableReason:
                    account.disable_reason,
                  currency: account.currency,
                  timezone:
                    account.timezone_name,
                })),
            };
          },
        }),

        getMetaAdAccountInsights: tool({
          description:
            "특정 Meta 광고계정의 지정 기간 통합 성과를 조회합니다. 노출, 도달, 클릭, 비용, CTR, CPC, CPM, 빈도와 전환 액션을 반환합니다.",

          inputSchema: z.object({
            accountQuery: z
              .string()
              .min(1)
              .max(200)
              .describe(
                "광고계정 이름 또는 광고계정 ID. 사용자가 입력한 표현을 사용합니다.",
              ),

            since: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .describe(
                "조회 시작일, YYYY-MM-DD 형식",
              ),

            until: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .describe(
                "조회 종료일, YYYY-MM-DD 형식",
              ),
          }),

          execute: async ({
            accountQuery,
            since,
            until,
          }) => {
            return getMetaAdAccountInsights({
              accountQuery,
              since,
              until,
            });
          },
        }),
      },

      prepareStep: ({ stepNumber }) => {
        if (stepNumber === 0) {
          return {
            // 첫 단계에서는 목록 또는 인사이트 도구 중
            // 하나를 반드시 선택하게 합니다.
            toolChoice: "required",
          };
        }

        return {
          // 도구 결과 확인 후 추가 도구 호출 또는
          // 최종 답변 생성을 모델이 판단합니다.
          toolChoice: "auto",
        };
      },

      stopWhen: stepCountIs(4),
      temperature: 0.1,
      maxOutputTokens: 1200,
    });

    return Response.json(
      {
        ok: true,
        model: modelName,
        answer: result.text,
        stepCount: result.steps.length,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Agent test failed:", error);

    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "에이전트 실행 중 오류가 발생했습니다.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}