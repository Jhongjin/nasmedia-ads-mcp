import { NextRequest, NextResponse } from "next/server";

import {
  getExpiredOperatorSessionCookieOptions,
  getOperatorSessionCookieName,
} from "@/lib/operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/sign-in", request.url), 303);

  response.cookies.set(getOperatorSessionCookieName(), "", getExpiredOperatorSessionCookieOptions());

  return response;
}
