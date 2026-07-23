import { getDashboardAccounts } from "@/lib/dashboard-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getDashboardAccounts();
  const status = payload.ok
    ? 200
    : payload.category === "permission"
      ? 403
      : payload.category === "configuration"
        ? 503
        : 502;

  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
