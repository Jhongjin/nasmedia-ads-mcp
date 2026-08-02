"use client";

import { useMemo, useState } from "react";

import type {
  MetaMcpGovernanceAccount,
  MetaMcpTargetTopologyScenario,
  MetaMcpTopologyReadiness,
} from "@/lib/meta-mcp-account-governance";
import { MetaMcpTopologyInventoryChecker } from "@/components/governance/meta-mcp-topology-inventory-checker";
import type { MetaMcpAccountPolicyLedgerReadiness } from "@/lib/meta-mcp-account-policy-ledger";
import type { MetaMcpPolicyAdministrationReadiness } from "@/lib/server/meta-mcp-policy-administration";

const PAGE_SIZE = 25;

const policyLabels = {
  enabled: "MCP 사용",
  disabled: "MCP 미사용",
  not_configured: "관리 기준 미설정",
} as const;

export function McpAccountGovernanceClient({
  accounts,
  topology,
  targetScenario,
  maximumTargetAdAccountCount,
  policyLedgerReadiness,
  policyAdministrationReadiness,
}: Readonly<{
  accounts: readonly MetaMcpGovernanceAccount[];
  topology: MetaMcpTopologyReadiness;
  targetScenario: MetaMcpTargetTopologyScenario;
  maximumTargetAdAccountCount: number;
  policyLedgerReadiness: MetaMcpAccountPolicyLedgerReadiness;
  policyAdministrationReadiness: MetaMcpPolicyAdministrationReadiness;
}>) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const filteredAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

    if (!normalizedQuery) {
      return accounts;
    }

    return accounts.filter((account) =>
      account.name.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
      account.businessName.toLocaleLowerCase("ko-KR").includes(normalizedQuery),
    );
  }, [accounts, query]);
  const pageCount = Math.max(1, Math.ceil(filteredAccounts.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const paginatedAccounts = filteredAccounts.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  return (
    <>
      <section className="mcp-topology-grid" aria-label="Meta MCP 연결 현황">
        <article>
          <p>현재 읽기 연결 계정</p>
          <strong>{topology.observedAccountCount.toLocaleString("ko-KR")}</strong>
          <span>Meta Marketing API의 이번 읽기 결과 기준</span>
        </article>
        <article>
          <p>구성된 시스템 사용자</p>
          <strong>{topology.configuredSystemUserCount.toLocaleString("ko-KR")}</strong>
          <span>계정별 연결 식별자와 토큰은 표시하지 않음</span>
        </article>
        <article>
          <p>계정만 가정한 이론 상한</p>
          <strong>{topology.nominalAdAccountCapacityAtZeroOtherAssets.toLocaleString("ko-KR")}</strong>
          <span>시스템 사용자당 전체 자산 최대 {topology.perSystemUserTotalAssetLimit.toLocaleString("ko-KR")}개 기준</span>
        </article>
        <article>
          <p>관찰 규모의 이론상 최소 버킷</p>
          <strong>{topology.requiredSystemUserCountAtObservedScale.toLocaleString("ko-KR")}</strong>
          <span>{topology.hasNominalCapacityForObservedAccounts ? "다른 자산을 제외하면 이론 상한 이내" : "계정 수만으로도 이론 상한을 초과함"}</span>
        </article>
      </section>

      <section className="mcp-governance-notice" aria-label="정책 저장소 안내">
        <strong>계정별 MCP 사용 정책은 아직 적용되지 않았습니다.</strong>
        <p>
          이 화면은 현재 읽기 연결된 계정만 보여줍니다. 계정별 사용·미사용을 실제로 저장하려면 중앙의 서버측 정책 저장소와 변경 감사 로그를 먼저 연결해야 합니다.
          시스템 사용자당 300개는 전체 자산 한도이므로, 페이지·픽셀·카탈로그 등 다른 자산이 있으면 실제 계정 수용량은 더 낮아집니다. 브라우저 상태나 임시 파일로는 설정을 저장하지 않습니다.
        </p>
        {policyLedgerReadiness.status === "unconfigured" ? (
          <p className="mcp-policy-hold">
            정책 원장 미연결: 저장소와 불변 감사 로그가 준비되기 전까지 모든 계정은 MCP 사용 미설정 상태로 유지됩니다.
          </p>
        ) : null}
        {policyAdministrationReadiness.status === "unconfigured" ? (
          <p className="mcp-policy-hold">
            정책 관리자 미구성: 회사 SSO 로그인만으로는 정책을 변경할 수 없습니다. 변경 권한은 별도 서버측 관리자 지정 후에만 열립니다.
          </p>
        ) : null}
        {policyAdministrationReadiness.status === "invalid" ? (
          <p className="mcp-policy-hold">
            정책 관리자 설정 확인 필요: 관리자 지정 형식이 안전하게 검증되지 않아 정책 변경이 차단된 상태입니다.
          </p>
        ) : null}
      </section>

      <section className="mcp-governance-notice" aria-label="전사 광고계정 목표 토폴로지 시나리오">
        <strong>{targetScenario.targetAdAccountCount.toLocaleString("ko-KR")}개 계정 초기 시나리오</strong>
        <p>
          시스템 사용자당 전체 자산 최대 {targetScenario.perSystemUserTotalAssetLimit.toLocaleString("ko-KR")}개만 기준으로 하면 최소 {targetScenario.theoreticalMinimumSystemUserCount}개 풀이 필요합니다.
          다만 페이지·픽셀·카탈로그와 성장 여유를 위해 광고계정은 풀당 최대 {targetScenario.recommendedAdAccountBudgetPerSystemUser.toLocaleString("ko-KR")}개로 계획하고,
          나머지 {targetScenario.reservedOtherAssetSlotsPerSystemUser.toLocaleString("ko-KR")}개 자산 슬롯을 남기는 {targetScenario.recommendedSystemUserPoolCount}개 풀 구성을 권장합니다.
          2,000개는 초기 예시일 뿐 전사 범위를 제한하지 않습니다. 아래 집계 도구에서 실제 전사 목표 수를 입력해 다시 계산할 수 있습니다. 이는 용량 계획일 뿐 실제 자산 배정이나 MCP 사용 승인이 아닙니다. 각 시스템 사용자의 자산 합계가 확인된 뒤에만 확정할 수 있습니다.
        </p>
      </section>

      <MetaMcpTopologyInventoryChecker
        initialTargetScenario={targetScenario}
        maximumTargetAdAccountCount={maximumTargetAdAccountCount}
      />

      <section className="mcp-account-panel">
        <div className="mcp-account-panel-heading">
          <div>
            <h2>계정별 MCP 활용 상태</h2>
            <p>현재는 연결 현황만 확인합니다. 권한·토큰·Meta Business Suite 자산 배정은 이 화면에서 변경하지 않습니다.</p>
          </div>
          <label className="mcp-search-field">
            <span>계정 또는 비즈니스 검색</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="계정명 또는 비즈니스명"
            />
          </label>
        </div>
        <div className="table-scroll" tabIndex={0}>
          <table className="accounts-table mcp-accounts-table">
            <thead>
              <tr>
                <th scope="col">광고계정</th>
                <th scope="col">비즈니스</th>
                <th scope="col">읽기 연결</th>
                <th scope="col">MCP 사용 정책</th>
              </tr>
            </thead>
            <tbody>
              {paginatedAccounts.map((account, index) => (
                <tr key={`${account.name}-${account.businessName}-${index}`}>
                  <th scope="row">{account.name}</th>
                  <td>{account.businessName}</td>
                  <td><span className="status-badge status-active">연결됨</span></td>
                  <td><span className="status-badge status-neutral">{policyLabels[account.policyStatus]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredAccounts.length === 0 ? (
          <p className="mcp-empty">검색 조건에 맞는 현재 연결 계정이 없습니다.</p>
        ) : null}
        {filteredAccounts.length > PAGE_SIZE ? (
          <nav className="pagination" aria-label="MCP 계정 목록 페이지">
            <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>이전</button>
            <span>{currentPage} / {pageCount}</span>
            <button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>다음</button>
          </nav>
        ) : null}
      </section>
    </>
  );
}
