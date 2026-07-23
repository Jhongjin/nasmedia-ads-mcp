import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { getDashboardAccounts } from "@/lib/dashboard-service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialData = await getDashboardAccounts();
  return (
    <main className="app-shell page-content">
      <section className="page-heading">
        <p className="eyebrow">META MARKETING API · LIVE READ</p>
        <h1>광고계정 대시보드</h1>
        <p>접근 가능한 광고계정을 Meta Marketing API에서 최신 상태로 조회합니다. 화면의 모든 수치는 서버 응답으로 계산됩니다.</p>
      </section>
      <DashboardClient initialData={initialData} />
    </main>
  );
}
