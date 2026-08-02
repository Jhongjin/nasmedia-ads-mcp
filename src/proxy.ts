import { NextResponse, type NextRequest } from "next/server";

import { OPERATOR_SESSION_COOKIE } from "@/lib/operator-auth-constants";

function unauthorizedApiResponse() {
  return NextResponse.json(
    {
      ok: false,
      category: "authentication",
      error: "회사 SSO 로그인이 필요합니다.",
    },
    {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function proxy(request: NextRequest) {
  if (request.cookies.has(OPERATOR_SESSION_COOKIE)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return unauthorizedApiResponse();
  }

  return NextResponse.redirect(new URL("/sign-in", request.url));
}

export const config = {
  matcher: ["/", "/assistant/:path*", "/meta-access-check/:path*", "/api/dashboard/:path*", "/api/auth/meta/:path*"],
};
