import { NextResponse } from "next/server";

import {
  createMetaInventoryAuthorizationRequest,
  getMetaInventoryStateCookieOptions,
  META_INVENTORY_STATE_COOKIE,
  MetaPersonalAccessInventoryError,
} from "@/lib/meta-personal-access-inventory";
import { getOperatorSession } from "@/lib/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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

  try {
    const { authorizationUrl, state } = await createMetaInventoryAuthorizationRequest(session.subject);
    const response = NextResponse.redirect(authorizationUrl);

    response.headers.set("Cache-Control", "no-store");
    response.cookies.set({
      name: META_INVENTORY_STATE_COOKIE,
      value: state,
      ...getMetaInventoryStateCookieOptions(),
    });

    return response;
  } catch (error) {
    const category = error instanceof MetaPersonalAccessInventoryError ? error.category : "configuration";

    return Response.json(
      {
        ok: false,
        category,
        error: "개인 관리자 계정 읽기 전용 점검을 시작할 수 없습니다.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
