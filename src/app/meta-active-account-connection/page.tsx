import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  META_INVENTORY_RESULT_COOKIE,
  readMetaInventoryResultCookieValue,
  type MetaProvisioningResult,
} from "@/lib/meta-personal-access-inventory";
import { getOperatorSession } from "@/lib/operator-auth";
import { MetaProvisioningImplicitCallback } from "./meta-provisioning-implicit-callback";

export const dynamic = "force-dynamic";

function statusLabel(status: "completed" | "failed" | "partial" | undefined) {
  switch (status) {
    case "completed":
      return "연결이 완료되었습니다.";
    case "partial":
      return "일부 계정만 연결되었습니다.";
    case "failed":
      return "연결을 완료하지 못했습니다.";
    default:
      return "연결을 아직 시작하지 않았습니다.";
  }
}

function failureLabel(category: "configuration" | "permission" | "network" | "upstream" | undefined) {
  switch (category) {
    case "permission":
      return "Meta가 business_management 또는 광고계정 성과 조회 권한을 승인하지 않았습니다.";
    case "network":
      return "Meta 연결이 중단되어 변경을 완료하지 못했습니다. 기존 할당은 보존됩니다.";
    case "upstream":
      return "Meta가 일부 요청을 처리하지 못했습니다. 기존 할당은 보존됩니다.";
    case "configuration":
      return "전용 시스템 사용자 풀 설정을 확인하지 못했습니다. 변경을 시작하지 않았습니다.";
    default:
      return "완료 전에는 다음 단계를 시작하지 않습니다.";
  }
}

function failureStageLabel(stage: MetaProvisioningResult["failureStage"]) {
  switch (stage) {
    case "active_account_scan":
      return "최근 집행 이력 판별 단계";
    case "permission_check":
      return "Meta 권한 확인 단계";
    case "pool_configuration":
      return "전용 풀 환경 설정 단계";
    case "pool_validation":
      return "전용 풀 검증 단계";
    case "assignment_inventory":
      return "기존 할당 조회 단계";
    case "capacity_check":
      return "전용 풀 용량 확인 단계";
    case "pool_one_assignment":
      return "Ads Pool 01 배정 단계";
    case "pool_two_assignment":
      return "Ads Pool 02 배정 단계";
    default:
      return null;
  }
}

export default async function MetaActiveAccountConnectionPage() {
  const session = await getOperatorSession();

  if (!session) {
    redirect("/sign-in");
  }

  const resultCookie = (await cookies()).get(META_INVENTORY_RESULT_COOKIE)?.value;
  const result = await readMetaInventoryResultCookieValue(resultCookie, session.subject);
  const provisioning = result?.provisioning;

  return (
    <main className="app-shell page-content">
      <MetaProvisioningImplicitCallback />
      <section className="page-heading">
        <p className="eyebrow">PERSONAL ADMIN ACCESS · ONE-TIME PERMISSION ASSIGNMENT</p>
        <h1>최근 집행 광고계정 연결</h1>
        <p>
          개인 관리자 OAuth 토큰은 이번 요청의 서버 메모리에서만 사용합니다. 최근 6개월 동안 지출이 확인된 계정에만 전용 시스템 사용자 풀의 성과 조회 권한을 부여합니다.
        </p>
      </section>

      <section className="access-check-card" aria-live="polite">
        <div className="access-check-heading">
          <div>
            <p className="access-check-label">현재 상태</p>
            <h2>{statusLabel(provisioning?.status)}</h2>
          </div>
          <a className="primary-button access-check-button" href="/api/auth/meta/inventory/provisioning/login">
            최근 집행 계정 연결 시작
          </a>
        </div>

        {provisioning ? (
          <div className="access-check-grid">
            <article>
              <p>연결 후보</p>
              <strong>{provisioning.candidateAccountCount.toLocaleString("ko-KR")}</strong>
              <span>최근 6개월 지출이 0보다 큰 계정만 포함</span>
            </article>
            <article>
              <p>Ads Pool 01</p>
              <strong>{provisioning.poolOneAssignedAccountCount.toLocaleString("ko-KR")}</strong>
              <span>최대 250개 · ANALYZE만 부여</span>
            </article>
            <article>
              <p>Ads Pool 02</p>
              <strong>{provisioning.poolTwoAssignedAccountCount.toLocaleString("ko-KR")}</strong>
              <span>최대 250개 · ANALYZE만 부여</span>
            </article>
          </div>
        ) : null}

        {provisioning?.status !== "completed" ? (
          <p className="access-check-message">
            {failureLabel(provisioning?.failureCategory)}
            {failureStageLabel(provisioning?.failureStage)
              ? ` 실패 지점: ${failureStageLabel(provisioning?.failureStage)}.`
              : ""}
          </p>
        ) : null}
      </section>

      <section className="access-check-guardrails">
        <h2>이 연결에서 하지 않는 일</h2>
        <ul>
          <li>Conversions API System User 또는 기존 Nasmedia API User 2026의 자산·토큰은 변경하지 않습니다.</li>
          <li>캠페인, 광고, 예산, 크리에이티브를 생성하거나 수정하지 않습니다.</li>
          <li>ads_management 권한은 요청하지 않으며, 연결된 계정에는 ANALYZE(성과 조회)만 부여합니다.</li>
          <li>개인 관리자 OAuth 토큰과 광고계정 식별자는 브라우저·쿠키·로그에 저장하거나 표시하지 않습니다.</li>
        </ul>
      </section>
    </main>
  );
}
