import { redirect } from "next/navigation";

import {
  META_MCP_INITIAL_TARGET_AD_ACCOUNT_COUNT,
  META_MCP_RECOMMENDED_AD_ACCOUNT_BUDGET_PER_SYSTEM_USER,
} from "@/lib/meta-mcp-account-governance";
import { getMetaMcpAccountPolicyLedger } from "@/lib/meta-mcp-account-policy-ledger";
import {
  getMetaSystemUserTopologySummary,
  MetaConnectionConfigurationError,
} from "@/lib/meta-connection-registry";
import { getOperatorSession } from "@/lib/operator-auth";
import { getMetaMcpPolicyAdministrationReadiness } from "@/lib/server/meta-mcp-policy-administration";

export const dynamic = "force-dynamic";

type SystemUserPoolReadiness = Readonly<{
  status: "ready" | "needs_configuration";
  configuredSystemUserCount: number | null;
  nominalAdAccountCapacityAtZeroOtherAssets: number | null;
  mode: "legacy-single" | "system-user-pool" | null;
}>;

function getSystemUserPoolReadiness(): SystemUserPoolReadiness {
  try {
    const topology = getMetaSystemUserTopologySummary();

    return Object.freeze({
      status: "ready",
      configuredSystemUserCount: topology.configuredSystemUserCount,
      nominalAdAccountCapacityAtZeroOtherAssets:
        topology.nominalAdAccountCapacityAtZeroOtherAssets,
      mode: topology.mode,
    });
  } catch (error) {
    if (error instanceof MetaConnectionConfigurationError) {
      return Object.freeze({
        status: "needs_configuration",
        configuredSystemUserCount: null,
        nominalAdAccountCapacityAtZeroOtherAssets: null,
        mode: null,
      });
    }

    throw error;
  }
}

function formatCount(value: number): string {
  return value.toLocaleString("ko-KR");
}

export default async function McpAccountGovernanceReadinessPage() {
  const session = await getOperatorSession();

  if (!session) {
    redirect("/sign-in");
  }

  const pool = getSystemUserPoolReadiness();
  const policyLedgerReadiness = getMetaMcpAccountPolicyLedger().getReadiness();
  const policyAdministrationReadiness = getMetaMcpPolicyAdministrationReadiness();
  const recommendedPoolCount = Math.ceil(
    META_MCP_INITIAL_TARGET_AD_ACCOUNT_COUNT
    / META_MCP_RECOMMENDED_AD_ACCOUNT_BUDGET_PER_SYSTEM_USER,
  );

  return (
    <main className="app-shell page-content">
      <section className="page-heading compact-heading">
        <p className="eyebrow">META ADS MCP · SAFE READINESS</p>
        <h1>시스템 사용자 풀 준비도</h1>
        <p>
          실제 Meta 광고계정·자산·권한·토큰은 읽거나 변경하지 않고,
          배포된 서버의 연결 구성과 계정별 MCP 정책 제어 준비 상태만 확인합니다.
        </p>
        <p>
          <a className="secondary-button access-check-button" href="/mcp-account-governance">
            계정 활용 관리로 돌아가기
          </a>
        </p>
      </section>

      <section className="mcp-topology-grid" aria-label="Meta MCP 준비도 요약">
        <article>
          <p>시스템 사용자 풀 구성</p>
          <strong>{pool.status === "ready" ? "확인됨" : "설정 필요"}</strong>
          <span>
            {pool.status === "ready"
              ? `${formatCount(pool.configuredSystemUserCount ?? 0)}개 시스템 사용자 구성`
              : "서버 전용 연결 구성을 확인한 뒤 다시 열어 주세요."}
          </span>
        </article>
        <article>
          <p>명목상 총 자산 수용량</p>
          <strong>
            {pool.nominalAdAccountCapacityAtZeroOtherAssets === null
              ? "확인 전"
              : `${formatCount(pool.nominalAdAccountCapacityAtZeroOtherAssets)}개`}
          </strong>
          <span>
            다른 자산을 0개로 가정한 수치입니다. 광고계정 수용량을 보장하지 않습니다.
          </span>
        </article>
        <article>
          <p>계정별 MCP 정책 원장</p>
          <strong>{policyLedgerReadiness.status === "unconfigured" ? "미구성" : "확인 필요"}</strong>
          <span>승인·차단·감사 이력을 저장할 durable 원장이 필요합니다.</span>
        </article>
        <article>
          <p>정책 관리자 권한</p>
          <strong>
            {policyAdministrationReadiness.status === "configured" ? "준비됨" : "설정 필요"}
          </strong>
          <span>
            Entra 로그인만으로는 계정별 MCP 정책을 변경할 수 없습니다.
          </span>
        </article>
      </section>

      <section className="mcp-governance-notice" aria-label="안전 경계 안내">
        <strong>이 화면에서 수행하지 않는 작업</strong>
        <p>
          Meta Graph API 호출, 광고계정 또는 자산 목록 조회, 시스템 사용자 식별값·토큰 표시,
          Meta Business Suite 자산 배정, MCP 정책 저장은 수행하지 않습니다.
        </p>
      </section>

      <section className="mcp-account-panel" aria-labelledby="mcp-readiness-next-title">
        <div className="mcp-account-panel-heading">
          <div>
            <h2 id="mcp-readiness-next-title">다음 운영 순서</h2>
            <p>
              초기 예시 {formatCount(META_MCP_INITIAL_TARGET_AD_ACCOUNT_COUNT)}개 기준 권장 풀은
              {` ${formatCount(recommendedPoolCount)}개`}입니다. 이는 전사 목표가 아니라 용량 계획 출발점입니다.
            </p>
          </div>
        </div>
        <div className="mcp-inventory-actions">
          <p>
            1. 시스템 사용자별 총 자산 집계만 확인 · 2. 계정별 MCP 정책·감사 원장 마이그레이션 승인 ·
            3. 승인된 범위에서 읽기 전용 탐침 · 4. 결과 검토 후 Compass·Sentinel·Foresight 연계를 순서대로 진행합니다.
          </p>
        </div>
      </section>
    </main>
  );
}
