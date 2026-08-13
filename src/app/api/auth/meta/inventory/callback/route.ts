import { NextResponse, type NextRequest } from "next/server";

import {
  createMetaInventoryResultCookieValue,
  failedMetaInventoryResult,
  getExpiredMetaInventoryStateCookieOptions,
  getExpiredMetaProvisioningStateCookieOptions,
  getMetaInventoryResultCookieOptions,
  inspectMetaPersonalAccessWithAccountIds,
  META_INVENTORY_RESULT_COOKIE,
  META_INVENTORY_STATE_COOKIE,
  META_PROVISIONING_STATE_COOKIE,
  MetaPersonalAccessInventoryError,
} from "@/lib/meta-personal-access-inventory";
import { runMetaRecentSpendFilter } from "@/lib/meta-active-account-scan";
import { provisionRecentActiveAdAccounts } from "@/lib/meta-system-user-provisioning";
import { getOperatorSession } from "@/lib/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function inventoryResultResponse(request: NextRequest, provisioningRequested: boolean) {
  const response = NextResponse.redirect(new URL(
    provisioningRequested ? "/meta-active-account-connection" : "/meta-access-check",
    request.url,
  ));

  response.headers.set("Cache-Control", "no-store");
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

  return response;
}

export async function GET(request: NextRequest) {
  const session = await getOperatorSession();

  if (!session) {
    return Response.json(
      {
        ok: false,
        category: "authentication",
        error: "운영자 로그인이 필요합니다.",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const provisioningState = request.cookies.get(META_PROVISIONING_STATE_COOKIE)?.value;
  const provisioningRequested = Boolean(provisioningState);
  const response = inventoryResultResponse(request, provisioningRequested);
  const storedState = provisioningState ?? request.cookies.get(META_INVENTORY_STATE_COOKIE)?.value;
  let result;

  if (!code || !returnedState || !storedState) {
    result = failedMetaInventoryResult("authentication");
  } else {
    try {
      const inspected = await inspectMetaPersonalAccessWithAccountIds({
        code,
        returnedState,
        storedState,
        operatorSubject: session.subject,
      });
      if (provisioningRequested) {
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
      } else {
        const recentSpendFilter = await runMetaRecentSpendFilter({
          accessToken: inspected.accessToken,
          appSecret: inspected.appSecret,
          operatorSubject: session.subject,
          accountIds: inspected.accountIds,
          inventory: inspected.inventory,
        });

        result = { ...inspected.inventory, recentSpendFilter };
      }
    } catch (error) {
      result = failedMetaInventoryResult(
        error instanceof MetaPersonalAccessInventoryError ? error.category : "upstream",
      );
    }
  }

  try {
    const resultCookieValue = await createMetaInventoryResultCookieValue(result, session.subject);

    response.cookies.set({
      name: META_INVENTORY_RESULT_COOKIE,
      value: resultCookieValue,
      ...getMetaInventoryResultCookieOptions(),
    });
    return response;
  } catch {
    return Response.json(
      {
        ok: false,
        category: "configuration",
        error: "개인 관리자 계정 읽기 전용 점검 결과를 저장할 수 없습니다.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
