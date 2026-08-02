import { redirect } from "next/navigation";

import { McpAccountGovernanceClient } from "@/components/governance/mcp-account-governance-client";
import { MetaMcpTopologyInventoryChecker } from "@/components/governance/meta-mcp-topology-inventory-checker";
import { getDashboardAccounts } from "@/lib/dashboard-service";
import {
  buildMetaMcpGovernanceAccounts,
  buildMetaMcpTargetTopologyScenario,
  buildMetaMcpTopologyReadiness,
  META_MCP_INITIAL_TARGET_AD_ACCOUNT_COUNT,
  META_MCP_RECOMMENDED_AD_ACCOUNT_BUDGET_PER_SYSTEM_USER,
} from "@/lib/meta-mcp-account-governance";
import { getMetaMcpAccountPolicyLedger } from "@/lib/meta-mcp-account-policy-ledger";
import { getMetaMcpPolicyAdministrationReadiness } from "@/lib/server/meta-mcp-policy-administration";
import {
  getMetaSystemUserTopologySummary,
  MAX_META_ASSET_ASSIGNMENTS_PER_SYSTEM_USER,
  MAX_META_SYSTEM_USER_CONNECTIONS,
} from "@/lib/meta-connection-registry";
import { getOperatorSession } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

function McpAccountGovernancePlanningOnly({
  detail,
  targetScenario,
  maximumTargetAdAccountCount,
}: Readonly<{
  detail: string;
  targetScenario: ReturnType<typeof buildMetaMcpTargetTopologyScenario>;
  maximumTargetAdAccountCount: number;
}>) {
  return (
    <main className="app-shell page-content">
      <section className="page-heading compact-heading">
        <p className="eyebrow">META ADS MCP · ACCOUNT GOVERNANCE</p>
        <h1>MCP 계정 활용 관리</h1>
        <p>
          아직 읽기 연결 현황을 불러올 수 없어 계정별 목록과 MCP 사용 정책은 표시하지 않습니다.
          다만 실제 자산 배정 없이 시스템 사용자 풀 수용량을 먼저 확인할 수 있습니다.
        </p>
      </section>
      <section className="feedback-panel feedback-configuration" role="alert">
        <strong>연결 현황 확인 필요</strong>
        <p>{detail}</p>
        <p>
          <a className="secondary-button access-check-button" href="/mcp-account-governance/readiness">
            시스템 사용자 풀 준비도 보기
          </a>
        </p>
      </section>
      <section className="mcp-governance-notice" aria-label="전사 광고계정 목표 계획 안내">
        <strong>{targetScenario.targetAdAccountCount.toLocaleString("ko-KR")}개 계정 초기 사전 계획</strong>
        <p>
          광고계정만으로 계산한 이론상 최소는 {targetScenario.theoreticalMinimumSystemUserCount}개 풀이지만,
          다른 자산 여유를 남기는 권장안은 {targetScenario.recommendedSystemUserPoolCount}개 풀입니다.
          2,000개는 예시이며, 아래에서 전사 전체 목표 수를 변경해 Meta Business Suite 집계 수치로 수용량을 점검할 수 있습니다.
        </p>
      </section>
      <MetaMcpTopologyInventoryChecker
        initialTargetScenario={targetScenario}
        maximumTargetAdAccountCount={maximumTargetAdAccountCount}
      />
    </main>
  );
}

export default async function McpAccountGovernancePage() {
  const session = await getOperatorSession();

  if (!session) {
    redirect("/sign-in");
  }

  const targetScenario = buildMetaMcpTargetTopologyScenario({
    targetAdAccountCount: META_MCP_INITIAL_TARGET_AD_ACCOUNT_COUNT,
    perSystemUserTotalAssetLimit: MAX_META_ASSET_ASSIGNMENTS_PER_SYSTEM_USER,
    recommendedAdAccountBudgetPerSystemUser:
      META_MCP_RECOMMENDED_AD_ACCOUNT_BUDGET_PER_SYSTEM_USER,
  });
  const maximumTargetAdAccountCount =
    MAX_META_SYSTEM_USER_CONNECTIONS
    * META_MCP_RECOMMENDED_AD_ACCOUNT_BUDGET_PER_SYSTEM_USER;

  const dashboard = await getDashboardAccounts();

  if (!dashboard.ok) {
    return (
      <McpAccountGovernancePlanningOnly
        detail={dashboard.error}
        targetScenario={targetScenario}
        maximumTargetAdAccountCount={maximumTargetAdAccountCount}
      />
    );
  }

  // Capacity math and account-level MCP policy must never be presented as
  // complete when the safe per-system-user pagination cap was reached. The
  // operator needs a complete, verified inventory before deciding a pool
  // topology or enabling any future account policy.
  if (dashboard.truncated) {
    return (
      <McpAccountGovernancePlanningOnly
        detail="현재 읽기 결과가 안전한 페이지 한도에 도달해 계정 전체 목록을 확정할 수 없습니다. 일부 목록을 기준으로 MCP 사용 정책을 계산하지 않으며, 시스템 사용자별 자산 합계가 확인될 때까지 실제 자산 배정·권한 변경은 진행하지 않습니다."
        targetScenario={targetScenario}
        maximumTargetAdAccountCount={maximumTargetAdAccountCount}
      />
    );
  }

  let topology;

  try {
    const summary = getMetaSystemUserTopologySummary();
    topology = buildMetaMcpTopologyReadiness({
      configuredSystemUserCount: summary.configuredSystemUserCount,
      perSystemUserTotalAssetLimit: summary.perSystemUserTotalAssetLimit,
      observedAccountCount: dashboard.accounts.length,
    });
  } catch {
    return (
      <main className="app-shell page-content">
        <section className="page-heading compact-heading">
          <p className="eyebrow">META ADS MCP · ACCOUNT GOVERNANCE</p>
          <h1>MCP 계정 활용 관리</h1>
          <p>계정 목록은 확인됐지만 연결 토폴로지 요약은 안전하게 계산할 수 없습니다.</p>
        </section>
        <section className="feedback-panel feedback-configuration" role="alert">
          <strong>연결 토폴로지 설정 확인 필요</strong>
          <p>Meta 시스템 사용자 연결 구성을 운영자가 확인한 뒤 다시 열어 주세요. 이 화면은 계정 연결이나 권한을 변경하지 않습니다.</p>
        </section>
      </main>
    );
  }

  const policyLedger = getMetaMcpAccountPolicyLedger();
  const policyLedgerReadiness = policyLedger.getReadiness();
  const policyAdministrationReadiness = getMetaMcpPolicyAdministrationReadiness();
  const policyRecords = await policyLedger.listPoliciesForInventory();
  const accounts = buildMetaMcpGovernanceAccounts(dashboard.accounts, policyRecords);
  return (
    <main className="app-shell page-content">
      <section className="page-heading compact-heading">
        <p className="eyebrow">META ADS MCP · ACCOUNT GOVERNANCE</p>
        <h1>MCP 계정 활용 관리</h1>
        <p>
          회사가 읽기 연결한 광고계정을 한 번에 확인하고, 이후 계정별 MCP 사용 정책을 안전하게 관리하기 위한 준비 화면입니다.
          실제 Meta 자산 배정·토큰·권한은 변경하지 않습니다.
        </p>
        <p>
          <a className="secondary-button access-check-button" href="/mcp-account-governance/readiness">
            시스템 사용자 풀 준비도 보기
          </a>
        </p>
      </section>
      <McpAccountGovernanceClient
        accounts={accounts}
        topology={topology}
        targetScenario={targetScenario}
        maximumTargetAdAccountCount={maximumTargetAdAccountCount}
        policyLedgerReadiness={policyLedgerReadiness}
        policyAdministrationReadiness={policyAdministrationReadiness}
      />
    </main>
  );
}
