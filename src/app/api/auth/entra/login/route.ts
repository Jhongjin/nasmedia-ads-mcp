import { NextRequest, NextResponse } from "next/server";

import { ENTRA_OAUTH_STATE_COOKIE } from "@/lib/operator-auth-constants";
import {
  createEntraAuthorizationRequest,
  getEntraStateCookieOptions,
  OperatorAuthError,
} from "@/lib/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { authorizationUrl, stateCookieValue } = await createEntraAuthorizationRequest();
    const response = NextResponse.redirect(authorizationUrl);

    response.cookies.set(ENTRA_OAUTH_STATE_COOKIE, stateCookieValue, getEntraStateCookieOptions());

    return response;
  } catch (error) {
    const reason = error instanceof OperatorAuthError && error.category === "configuration"
      ? "configuration"
      : "unavailable";

    return NextResponse.redirect(new URL(`/sign-in?error=${reason}`, request.url));
  }
}
