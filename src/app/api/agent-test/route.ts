import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  generateText,
  stepCountIs,
  tool,
} from "ai";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const META_GRAPH_VERSION = "v25.0";
const MAX_META_PAGES = 5;
const MAX_ACCOUNTS_SENT_TO_MODEL = 20;

type MetaAdAccount = {
  id: string;
  account_id?: string;
  name?: string;
  account_status?: number;
  disable_reason?: number;
  currency?: string;
  timezone_name?: string;
};

type MetaApiResponse = {
  data?: MetaAdAccount[];
  paging?: {
    cursors?: {
      after?: string;
    };
    next?: string;
  };
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

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

async function listAssignedMetaAdAccounts(): Promise<
  MetaAdAccount[]
> {
  const accessToken = getRequiredEnv(
    "META_SYSTEM_USER_ACCESS_TOKEN",
  );
  const appSecret = getRequiredEnv("META_APP_SECRET");

  const appSecretProof = createHmac(
    "sha256",
    appSecret,
  )
    .update(accessToken)
    .digest("hex");

  const accounts: MetaAdAccount[] = [];
  let after: string | undefined;

  for (
    let page = 0;
    page < MAX_META_PAGES;
    page += 1
  ) {
    const url = new URL(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts`,
    );

    url.searchParams.set(
      "fields",
      [
        "id",
        "account_id",
        "name",
        "account_status",
        "disable_reason",
        "currency",
        "timezone_name",
      ].join(","),
    );

    url.searchParams.set("limit", "100");
    url.searchParams.set(
      "appsecret_proof",
      appSecretProof,
    );

    if (after) {
      url.searchParams.set("after", after);
    }

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });

    const payload =
      (await response.json()) as MetaApiResponse;

    if (!response.ok || payload.error) {
      const code = payload.error?.code ?? response.status;
      const message =
        payload.error?.message ??
        "Meta Marketing API 호출에 실패했습니다.";

      throw new Error(
        `Meta API 오류 ${code}: ${message}`,
      );
    }

    accounts.push(...(payload.data ?? []));

    const nextAfter =
      payload.paging?.cursors?.after;

    if (!payload.paging?.next || !nextAfter) {
      break;
    }

    after = nextAfter;
  }

  return accounts;
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
    "접근 가능한 Meta 광고계정의 총수와 활성·비활성 현황을 요약해 주세요. 광고계정 ID는 표시하지 마세요.";

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

    const result = await generateText({
      model: openrouter(modelName),

      system: [
        "당신은 Meta 광고 데이터 분석 도우미입니다.",
        "반드시 제공된 도구 실행 결과만 근거로 답하세요.",
        "도구 결과에 없는 사실을 추정하지 마세요.",
        "사용자가 명시적으로 요청하지 않는 한 광고계정 ID는 표시하지 마세요.",
        "현재 도구는 조회 전용이며 광고를 생성하거나 수정할 수 없습니다.",
        "답변은 한국어로 작성하세요.",
      ].join("\n"),

      prompt,

      tools: {
        listMetaAdAccounts: tool({
          description:
            "현재 시스템 사용자에게 할당된 Meta 광고계정 목록과 활성 상태를 조회합니다.",

          inputSchema: z.object({}),

          execute: async () => {
            const accounts =
              await listAssignedMetaAdAccounts();

            const activeAccounts =
              accounts.filter(
                (account) =>
                  account.account_status === 1,
              );

            const currencies = [
              ...new Set(
                accounts
                  .map(
                    (account) =>
                      account.currency,
                  )
                  .filter(
                    (
                      currency,
                    ): currency is string =>
                      Boolean(currency),
                  ),
              ),
            ];

            return {
              totalAccountCount: accounts.length,
              activeAccountCount:
                activeAccounts.length,
              inactiveAccountCount:
                accounts.length -
                activeAccounts.length,
              currencies,
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
      },

      // 첫 호출에서는 반드시 Meta 도구를 실행하고,
      // 두 번째 호출에서는 도구 결과를 바탕으로 답변합니다.
      prepareStep: ({ stepNumber }) => {
        if (stepNumber === 0) {
          return {
            toolChoice: {
              type: "tool",
              toolName: "listMetaAdAccounts",
            },
          };
        }

        return {
          toolChoice: "none",
        };
      },

      stopWhen: stepCountIs(2),
      temperature: 0.1,
      maxOutputTokens: 1000,
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