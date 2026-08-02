import { getDashboardAccounts } from "@/lib/dashboard-service";
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
        error: "회사 SSO 로그인이 필요합니다.",
      },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const payload = await getDashboardAccounts();
  const status = payload.ok
    ? 200
    : payload.category === "permission"
      ? 403
    : payload.category === "configuration"
      ? 503
      : payload.category === "topology"
        ? 409
        : 502;

  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
