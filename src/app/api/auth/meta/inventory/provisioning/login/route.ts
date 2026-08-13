import { NextResponse } from "next/server";

import {
  createMetaInventoryAuthorizationRequest,
  getExpiredMetaInventoryStateCookieOptions,
  getMetaProvisioningStateCookieOptions,
  META_INVENTORY_STATE_COOKIE,
  META_PROVISIONING_STATE_COOKIE,
  MetaPersonalAccessInventoryError,
} from "@/lib/meta-personal-access-inventory";
import { getOperatorSession } from "@/lib/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Starts the one-time, operator-initiated active-account assignment flow.
 * The callback is shared with inventory because the Meta Login configuration
 * already allows that exact callback URI.
 */
export async function GET() {
  const session = await getOperatorSession();

  if (!session) {
    return Response.json(
      { ok: false, category: "authentication", error: "운영자 로그인이 필요합니다." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const provisioningConfigId = process.env.META_PROVISIONING_LOGIN_CONFIG_ID?.trim();
    const { authorizationUrl, state } = await createMetaInventoryAuthorizationRequest(
      session.subject,
      ["ads_read", "business_management"],
      provisioningConfigId,
    );
    const response = NextResponse.redirect(authorizationUrl);

    response.headers.set("Cache-Control", "no-store");
    response.cookies.set({
      name: META_PROVISIONING_STATE_COOKIE,
      value: state,
      ...getMetaProvisioningStateCookieOptions(),
    });
    response.cookies.set({
      name: META_INVENTORY_STATE_COOKIE,
      value: "",
      ...getExpiredMetaInventoryStateCookieOptions(),
    });
    return response;
  } catch (error) {
    const category = error instanceof MetaPersonalAccessInventoryError ? error.category : "configuration";

    return Response.json(
      {
        ok: false,
        category,
        error: "최근 집행 계정 연결을 시작할 수 없습니다.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
