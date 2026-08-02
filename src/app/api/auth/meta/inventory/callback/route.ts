import { NextResponse, type NextRequest } from "next/server";

import {
  createMetaInventoryResultCookieValue,
  failedMetaInventoryResult,
  getExpiredMetaInventoryStateCookieOptions,
  getMetaInventoryResultCookieOptions,
  inspectMetaPersonalAccess,
  META_INVENTORY_RESULT_COOKIE,
  META_INVENTORY_STATE_COOKIE,
  MetaPersonalAccessInventoryError,
} from "@/lib/meta-personal-access-inventory";
import { getOperatorSession } from "@/lib/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function inventoryResultResponse(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/meta-access-check", request.url));

  response.headers.set("Cache-Control", "no-store");
  response.cookies.set({
    name: META_INVENTORY_STATE_COOKIE,
    value: "",
    ...getExpiredMetaInventoryStateCookieOptions(),
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
        error: "회사 SSO 로그인이 필요합니다.",
      },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const response = inventoryResultResponse(request);
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const storedState = request.cookies.get(META_INVENTORY_STATE_COOKIE)?.value;
  let result;

  if (!code || !returnedState || !storedState) {
    result = failedMetaInventoryResult("authentication");
  } else {
    try {
      result = await inspectMetaPersonalAccess({
        code,
        returnedState,
        storedState,
        operatorSubject: session.subject,
      });
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
