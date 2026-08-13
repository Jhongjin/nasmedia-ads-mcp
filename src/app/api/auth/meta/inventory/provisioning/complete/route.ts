import { NextResponse, type NextRequest } from "next/server";

import {
  createMetaInventoryResultCookieValue,
  failedMetaInventoryResult,
  getExpiredMetaInventoryStateCookieOptions,
  getExpiredMetaProvisioningStateCookieOptions,
  getMetaInventoryResultCookieOptions,
  inspectMetaPersonalAccessTokenWithAccountIds,
  META_INVENTORY_RESULT_COOKIE,
  META_INVENTORY_STATE_COOKIE,
  META_PROVISIONING_STATE_COOKIE,
  MetaPersonalAccessInventoryError,
} from "@/lib/meta-personal-access-inventory";
import { provisionRecentActiveAdAccounts } from "@/lib/meta-system-user-provisioning";
import { getOperatorSession } from "@/lib/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ImplicitTokenPayload = {
  accessToken?: unknown;
  expiresIn?: unknown;
  state?: unknown;
};

function normalizedExpiresIn(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 90 * 24 * 60 * 60) {
    return undefined;
  }

  return Math.floor(value);
}

export async function POST(request: NextRequest) {
  const session = await getOperatorSession();

  if (!session) {
    return Response.json(
      { ok: false, category: "authentication", error: "운영자 로그인이 필요합니다." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const provisioningState = request.cookies.get(META_PROVISIONING_STATE_COOKIE)?.value;
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });

  response.cookies.set({
    name: META_INVENTORY_STATE_COOKIE,
    value: "",
    ...getExpiredMetaInventoryStateCookieOptions(),
  });
  response.cookies.set({
    name: META_PROVISIONING_STATE_COOKIE,
    value: "",
    ...getExpiredMetaProvisioningStateCookieOptions(),
  });

  let result;

  try {
    const payload = (await request.json()) as ImplicitTokenPayload;
    const accessToken = typeof payload.accessToken === "string" ? payload.accessToken : "";
    const state = typeof payload.state === "string" ? payload.state : "";

    if (!provisioningState || !accessToken || !state) {
      result = failedMetaInventoryResult("authentication");
    } else {
      const inspected = await inspectMetaPersonalAccessTokenWithAccountIds({
        accessToken,
        expiresIn: normalizedExpiresIn(payload.expiresIn),
        returnedState: state,
        storedState: provisioningState,
        operatorSubject: session.subject,
      });
      const provisioned = await provisionRecentActiveAdAccounts({
        accessToken: inspected.accessToken,
        appSecret: inspected.appSecret,
        operatorSubject: session.subject,
        accountIds: inspected.accountIds,
        inventory: inspected.inventory,
      });
      result = {
        ...inspected.inventory,
        recentSpendFilter: provisioned.recentSpendFilter,
        provisioning: provisioned.provisioning,
      };
    }
  } catch (error) {
    result = failedMetaInventoryResult(
      error instanceof MetaPersonalAccessInventoryError ? error.category : "upstream",
    );
  }

  try {
    response.cookies.set({
      name: META_INVENTORY_RESULT_COOKIE,
      value: await createMetaInventoryResultCookieValue(result, session.subject),
      ...getMetaInventoryResultCookieOptions(),
    });
    return response;
  } catch {
    return Response.json(
      {
        ok: false,
        category: "configuration",
        error: "최근 집행 계정 연결 결과를 저장할 수 없습니다.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
