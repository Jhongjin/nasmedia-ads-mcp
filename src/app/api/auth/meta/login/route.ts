import { createHmac, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  }

  return value;
}

export async function GET() {
  try {
    const appId = getRequiredEnv("META_APP_ID");
    const configId = getRequiredEnv("META_LOGIN_CONFIG_ID");
    const redirectUri = getRequiredEnv("META_REDIRECT_URI");
    const stateSecret = getRequiredEnv("META_OAUTH_STATE_SECRET");

    // CSRF 방지를 위한 일회성 state 생성
    const nonce = randomBytes(32).toString("hex");

    const signature = createHmac("sha256", stateSecret)
      .update(nonce)
      .digest("hex");

    const state = `${nonce}.${signature}`;

    const loginUrl = new URL(
      "https://www.facebook.com/v21.0/dialog/oauth",
    );

    loginUrl.searchParams.set("client_id", appId);
    loginUrl.searchParams.set("redirect_uri", redirectUri);
    loginUrl.searchParams.set("config_id", configId);
    loginUrl.searchParams.set("response_type", "code");
    loginUrl.searchParams.set(
      "override_default_response_type",
      "true",
    );
    loginUrl.searchParams.set("state", state);

    const response = NextResponse.redirect(loginUrl);

    response.cookies.set({
      name: "meta_oauth_state",
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth/meta/callback",
      maxAge: 10 * 60,
    });

    return response;
  } catch (error) {
    console.error("Meta OAuth login initialization failed:", error);

    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Meta 로그인을 시작하지 못했습니다.",
      },
      { status: 500 },
    );
  }
}