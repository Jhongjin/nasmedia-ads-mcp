"use client";

import { useState } from "react";

import {
  assessMetaMcpVerifiedTopology,
  buildMetaMcpTargetTopologyScenario,
  type MetaMcpSystemUserAggregateInventory,
  type MetaMcpTargetTopologyScenario,
} from "@/lib/meta-mcp-account-governance";

type InventoryField = Exclude<keyof MetaMcpSystemUserAggregateInventory, "systemUserSlot">;

type InventoryRow = Readonly<{
  systemUserSlot: number;
  adAccountCount: string;
  pageCount: string;
  pixelCount: string;
  catalogCount: string;
  otherAssetCount: string;
  reportedTotalAssetCount: string;
}>;

const fields: readonly Readonly<{ key: InventoryField; label: string }>[] = [
  { key: "adAccountCount", label: "광고계정" },
  { key: "pageCount", label: "페이지" },
  { key: "pixelCount", label: "픽셀" },
  { key: "catalogCount", label: "카탈로그" },
  { key: "otherAssetCount", label: "기타 자산" },
  { key: "reportedTotalAssetCount", label: "Meta 표시 총계" },
];

function createRows(count: number): InventoryRow[] {
  return Array.from({ length: count }, (_, index) => ({
    systemUserSlot: index + 1,
    adAccountCount: "",
    pageCount: "",
    pixelCount: "",
    catalogCount: "",
    otherAssetCount: "",
    reportedTotalAssetCount: "",
  }));
}

function parseCount(value: string): number | null {
  if (value.trim() === "") return null;

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseRow(row: InventoryRow): MetaMcpSystemUserAggregateInventory | null {
  const adAccountCount = parseCount(row.adAccountCount);
  const pageCount = parseCount(row.pageCount);
  const pixelCount = parseCount(row.pixelCount);
  const catalogCount = parseCount(row.catalogCount);
  const otherAssetCount = parseCount(row.otherAssetCount);
  const reportedTotalAssetCount = parseCount(row.reportedTotalAssetCount);

  if (
    adAccountCount === null
    || pageCount === null
    || pixelCount === null
    || catalogCount === null
    || otherAssetCount === null
    || reportedTotalAssetCount === null
  ) {
    return null;
  }

  return {
    systemUserSlot: row.systemUserSlot,
    adAccountCount,
    pageCount,
    pixelCount,
    catalogCount,
    otherAssetCount,
    reportedTotalAssetCount,
  };
}

export function MetaMcpTopologyInventoryChecker({
  initialTargetScenario,
  maximumTargetAdAccountCount,
}: Readonly<{
  initialTargetScenario: MetaMcpTargetTopologyScenario;
  maximumTargetAdAccountCount: number;
}>) {
  const [targetScenario, setTargetScenario] = useState(initialTargetScenario);
  const [targetAdAccountCountText, setTargetAdAccountCountText] = useState(
    String(initialTargetScenario.targetAdAccountCount),
  );
  const [rows, setRows] = useState(() => createRows(initialTargetScenario.recommendedSystemUserPoolCount));
  const [result, setResult] = useState<ReturnType<typeof assessMetaMcpVerifiedTopology> | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function applyTargetAccountCount() {
    const targetAdAccountCount = parseCount(targetAdAccountCountText);

    if (targetAdAccountCount === null || targetAdAccountCount < 1) {
      setMessage("광고계정 목표 수에는 1 이상의 정수를 입력해 주세요.");
      return;
    }

    if (targetAdAccountCount > maximumTargetAdAccountCount) {
      setMessage(
        `현재 보수적 계획 한도는 ${maximumTargetAdAccountCount.toLocaleString("ko-KR")}개입니다. 이를 넘는 전사 목표는 시스템 사용자 수 또는 풀당 자산 여유 기준을 별도로 재설계해야 합니다.`,
      );
      return;
    }

    const nextScenario = buildMetaMcpTargetTopologyScenario({
      targetAdAccountCount,
      perSystemUserTotalAssetLimit: targetScenario.perSystemUserTotalAssetLimit,
      recommendedAdAccountBudgetPerSystemUser:
        targetScenario.recommendedAdAccountBudgetPerSystemUser,
    });

    setTargetScenario(nextScenario);
    setRows(createRows(nextScenario.recommendedSystemUserPoolCount));
    setResult(null);
    setMessage(null);
  }

  function updateRow(slot: number, field: InventoryField, value: string) {
    setRows((current) => current.map((row) => (
      row.systemUserSlot === slot ? { ...row, [field]: value } : row
    )));
    setResult(null);
    setMessage(null);
  }

  function checkInventory() {
    const inventories = rows.map(parseRow);

    if (inventories.some((inventory) => inventory === null)) {
      setResult(null);
      setMessage("각 시스템 사용자 행에 0 이상의 정수와 Meta 화면의 총 자산 수를 모두 입력해 주세요.");
      return;
    }

    try {
      const assessment = assessMetaMcpVerifiedTopology({
        configuredSystemUserCount: rows.length,
        perSystemUserTotalAssetLimit: targetScenario.perSystemUserTotalAssetLimit,
        targetAdAccountCount: targetScenario.targetAdAccountCount,
        inventories: inventories as MetaMcpSystemUserAggregateInventory[],
      });
      setResult(assessment);
      setMessage(null);
    } catch {
      setResult(null);
      setMessage("입력한 자산 항목의 합계와 Meta 화면의 총 자산 수가 일치하는지 확인해 주세요.");
    }
  }

  return (
    <section className="mcp-account-panel mcp-inventory-checker" aria-labelledby="mcp-inventory-checker-title">
      <div className="mcp-account-panel-heading">
        <div>
          <h2 id="mcp-inventory-checker-title">시스템 사용자 자산 집계 확인</h2>
          <p>
            시스템 사용자별로 Meta Business Suite에 표시된 <strong>집계 수치만</strong> 입력해 {targetScenario.targetAdAccountCount.toLocaleString("ko-KR")}개 계정 목표를 수용할 수 있는지 확인합니다.
            광고계정 ID·자산명·토큰은 입력하지 않으며, 입력값은 저장하거나 전송하지 않습니다.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => {
            setRows(createRows(targetScenario.recommendedSystemUserPoolCount));
            setResult(null);
            setMessage(null);
          }}
        >
          입력 초기화
        </button>
      </div>
      <div className="mcp-inventory-actions" aria-label="광고계정 목표 수 설정">
        <label>
          <span>광고계정 목표 수</span>
          <input
            inputMode="numeric"
            min="1"
            max={maximumTargetAdAccountCount}
            pattern="[0-9]*"
            type="text"
            value={targetAdAccountCountText}
            onChange={(event) => {
              setTargetAdAccountCountText(event.target.value.replace(/[^0-9]/g, ""));
              setResult(null);
              setMessage(null);
            }}
          />
        </label>
        <button className="secondary-button" type="button" onClick={applyTargetAccountCount}>
          목표 적용
        </button>
        <p>
          기본값 2,000개는 예시입니다. 최대 {maximumTargetAdAccountCount.toLocaleString("ko-KR")}개까지는 현재 64개 시스템 사용자 슬롯과 풀당 {targetScenario.recommendedAdAccountBudgetPerSystemUser.toLocaleString("ko-KR")}개 보수적 예산으로 시뮬레이션합니다.
        </p>
      </div>
      <div className="table-scroll" tabIndex={0}>
        <table className="accounts-table mcp-inventory-table">
          <thead>
            <tr>
              <th scope="col">시스템 사용자 슬롯</th>
              {fields.map((field) => <th key={field.key} scope="col">{field.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.systemUserSlot}>
                <th scope="row">풀 {row.systemUserSlot}</th>
                {fields.map((field) => (
                  <td key={field.key}>
                    <label className="sr-only" htmlFor={`pool-${row.systemUserSlot}-${field.key}`}>
                      {`풀 ${row.systemUserSlot} ${field.label}`}
                    </label>
                    <input
                      id={`pool-${row.systemUserSlot}-${field.key}`}
                      inputMode="numeric"
                      min="0"
                      pattern="[0-9]*"
                      type="text"
                      value={row[field.key]}
                      onChange={(event) => updateRow(row.systemUserSlot, field.key, event.target.value.replace(/[^0-9]/g, ""))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mcp-inventory-actions">
        <button className="primary-button" type="button" onClick={checkInventory}>집계 확인</button>
        <p>이 결과는 운영 결정용 계산일 뿐, Meta 자산 배정·MCP 활성화·토큰 생성·정책 저장을 실행하지 않습니다.</p>
      </div>
      {message ? <p className="mcp-inventory-message" role="alert">{message}</p> : null}
      {result ? (
        <div className="mcp-inventory-result" role="status">
          <strong>{result.canSupportTargetAdAccountCount ? "목표 수용 가능성 확인" : "목표 수용량 부족 또는 확인 필요"}</strong>
          <p>
            집계 광고계정 {result.totalAdAccountCount.toLocaleString("ko-KR")}개 · 비광고 자산 {result.totalNonAdAssetCount.toLocaleString("ko-KR")}개 · 남은 전체 자산 여유 {result.totalRemainingAssetHeadroom.toLocaleString("ko-KR")}개 · 현재 비광고 자산 기준 최대 광고계정 수용량 {result.maximumAdAccountCapacityAtCurrentNonAdAssetUsage.toLocaleString("ko-KR")}개
          </p>
          <p>
            {result.canProceedToTopologyDecision
              ? "모든 풀의 집계 수치와 300개 전체 자산 한도는 일치합니다. 이 결과를 근거로 담당자가 풀 구성 결정을 검토할 수 있습니다."
              : "모든 풀의 집계 수치가 입력되지 않았거나 300개 전체 자산 한도를 초과했습니다. 계정 연결이나 MCP 정책 변경은 계속 차단됩니다."}
          </p>
        </div>
      ) : null}
    </section>
  );
}
