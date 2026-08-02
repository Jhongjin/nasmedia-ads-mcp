import { NextRequest, NextResponse } from "next/server";

import {
  ENTRA_OAUTH_STATE_COOKIE,
  OPERATOR_SESSION_COOKIE,
} from "@/lib/operator-auth-constants";
import {
  exchangeEntraAuthorizationCode,
  getEntraStateCookieOptions,
  getOperatorSessionCookieOptions,
  OperatorAuthError,
} from "@/lib/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSafeSignInUrl(request: NextRequest, reason: string): URL {
  return new URL(`/sign-in?error=${reason}`, request.url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const returnedState = request.nextUrl.searchParams.get("state");
  const stateCookieValue = request.cookies.get(ENTRA_OAUTH_STATE_COOKIE)?.value;

  if (!code) {
    const response = NextResponse.redirect(getSafeSignInUrl(request, "cancelled"));
    response.cookies.set(ENTRA_OAUTH_STATE_COOKIE, "", { ...getEntraStateCookieOptions(), maxAge: 0, expires: new Date(0) });
    return response;
  }

  try {
    const sessionToken = await exchangeEntraAuthorizationCode({
      code,
      returnedState,
      stateCookieValue,
    });
    const response = NextResponse.redirect(new URL("/", request.url));

    response.cookies.set(OPERATOR_SESSION_COOKIE, sessionToken, getOperatorSessionCookieOptions());
    response.cookies.set(ENTRA_OAUTH_STATE_COOKIE, "", { ...getEntraStateCookieOptions(), maxAge: 0, expires: new Date(0) });

    return response;
  } catch (error) {
    const reason = error instanceof OperatorAuthError
      ? error.category === "authorization"
        ? "unauthorized"
        : error.category === "configuration"
          ? "configuration"
          : "failed"
      : "failed";
    const response = NextResponse.redirect(getSafeSignInUrl(request, reason));

    response.cookies.set(ENTRA_OAUTH_STATE_COOKIE, "", { ...getEntraStateCookieOptions(), maxAge: 0, expires: new Date(0) });
    return response;
  }
}
