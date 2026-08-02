import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildMetaMcpGovernanceAccounts,
  buildMetaMcpTargetTopologyScenario,
  buildMetaMcpTopologyReadiness,
  assessMetaMcpVerifiedTopology,
} from "../src/lib/meta-mcp-account-governance.ts";

const accounts = buildMetaMcpGovernanceAccounts(
  [
    { id: "account-1", name: "계정 A", business: { name: "비즈니스 A" } },
    { id: "account-2", name: "계정 B", business: { name: "비즈니스 B" } },
  ],
  [{ accountId: "account-1", state: "enabled" }],
);

assert.equal(accounts[0]?.policyStatus, "enabled");
assert.equal(accounts[1]?.policyStatus, "not_configured");
assert.equal(accounts[0]?.liveReadStatus, "connected");

const readiness = buildMetaMcpTopologyReadiness({
  configuredSystemUserCount: 7,
  perSystemUserTotalAssetLimit: 300,
  observedAccountCount: 2_000,
});

assert.equal(readiness.nominalAdAccountCapacityAtZeroOtherAssets, 2_100);
assert.equal(readiness.requiredSystemUserCountAtObservedScale, 7);
assert.equal(readiness.hasNominalCapacityForObservedAccounts, true);

const targetScenario = buildMetaMcpTargetTopologyScenario({
  targetAdAccountCount: 2_000,
  perSystemUserTotalAssetLimit: 300,
  recommendedAdAccountBudgetPerSystemUser: 250,
});

assert.equal(targetScenario.theoreticalMinimumSystemUserCount, 7);
assert.equal(targetScenario.recommendedSystemUserPoolCount, 8);
assert.equal(targetScenario.reservedOtherAssetSlotsPerSystemUser, 50);
assert.equal(targetScenario.recommendedAccountCapacity, 2_000);
assert.equal(targetScenario.requiresVerifiedAssetInventory, true);

const expandedTargetScenario = buildMetaMcpTargetTopologyScenario({
  targetAdAccountCount: 4_000,
  perSystemUserTotalAssetLimit: 300,
  recommendedAdAccountBudgetPerSystemUser: 250,
});

assert.equal(expandedTargetScenario.theoreticalMinimumSystemUserCount, 14);
assert.equal(expandedTargetScenario.recommendedSystemUserPoolCount, 16);
assert.equal(expandedTargetScenario.recommendedAccountCapacity, 4_000);

const verifiedTopology = assessMetaMcpVerifiedTopology({
  configuredSystemUserCount: 8,
  perSystemUserTotalAssetLimit: 300,
  targetAdAccountCount: 2_000,
  inventories: Array.from({ length: 8 }, (_, index) => ({
    systemUserSlot: index + 1,
    adAccountCount: 250,
    pageCount: 12,
    pixelCount: 8,
    catalogCount: 4,
    otherAssetCount: 1,
    reportedTotalAssetCount: 275,
  })),
});

assert.equal(verifiedTopology.inventoryCoversEveryConfiguredSystemUser, true);
assert.equal(verifiedTopology.everySystemUserWithinAssetLimit, true);
assert.equal(verifiedTopology.maximumAdAccountCapacityAtCurrentNonAdAssetUsage, 2_200);
assert.equal(verifiedTopology.canSupportTargetAdAccountCount, true);
assert.equal(verifiedTopology.canProceedToTopologyDecision, true);

assert.throws(
  () => buildMetaMcpGovernanceAccounts(
    [{ id: "duplicate", name: "A", business: { name: "B" } }, { id: "duplicate", name: "C", business: { name: "D" } }],
    [],
  ),
);
assert.throws(
  () => buildMetaMcpTopologyReadiness({
    configuredSystemUserCount: 0,
    perSystemUserTotalAssetLimit: 300,
    observedAccountCount: 1,
  }),
);
assert.throws(
  () => buildMetaMcpTargetTopologyScenario({
    targetAdAccountCount: 2_000,
    perSystemUserTotalAssetLimit: 300,
    recommendedAdAccountBudgetPerSystemUser: 301,
  }),
);
assert.throws(
  () => assessMetaMcpVerifiedTopology({
    configuredSystemUserCount: 1,
    perSystemUserTotalAssetLimit: 300,
    targetAdAccountCount: 1,
    inventories: [{
      systemUserSlot: 1,
      adAccountCount: 1,
      pageCount: 0,
      pixelCount: 0,
      catalogCount: 0,
      otherAssetCount: 0,
      reportedTotalAssetCount: 2,
    }],
  }),
);

const topologyInventoryCheckerSource = readFileSync(
  new URL("../src/components/governance/meta-mcp-topology-inventory-checker.tsx", import.meta.url),
  "utf8",
);
const governancePageSource = readFileSync(
  new URL("../src/app/mcp-account-governance/page.tsx", import.meta.url),
  "utf8",
);

assert.match(topologyInventoryCheckerSource, /^"use client";/);
assert.match(topologyInventoryCheckerSource, /assessMetaMcpVerifiedTopology/);
assert.match(topologyInventoryCheckerSource, /buildMetaMcpTargetTopologyScenario/);
assert.match(topologyInventoryCheckerSource, /광고계정 목표 수/);
assert.match(topologyInventoryCheckerSource, /maximumTargetAdAccountCount/);
assert.match(topologyInventoryCheckerSource, /입력값은 저장하거나 전송하지 않습니다/);
assert.doesNotMatch(topologyInventoryCheckerSource, /\bfetch\s*\(/);
assert.doesNotMatch(topologyInventoryCheckerSource, /\b(?:localStorage|sessionStorage)\b/);
assert.doesNotMatch(topologyInventoryCheckerSource, /document\.cookie/);
assert.match(governancePageSource, /McpAccountGovernancePlanningOnly/);
assert.match(governancePageSource, /maximumTargetAdAccountCount/);
assert.match(governancePageSource, /실제 자산 배정 없이 시스템 사용자 풀 수용량을 먼저 확인할 수 있습니다/);

console.log(JSON.stringify({
  governanceProjectionPassed: true,
  policyDefaultsAreNotConfigured: true,
  topologyCapacityMathPassed: true,
  targetTopologyScenarioPassed: true,
  fourThousandAccountExpansionScenarioPassed: true,
  targetScenarioRequiresVerifiedAssetInventory: true,
  aggregateTopologyAssessmentPassed: true,
  aggregateInventoryUsesNoAccountIdentifiers: true,
  aggregateInventoryCheckerIsBrowserOnlyAndNoPersistence: true,
  planningCapacityCheckerRemainsAvailableWhenInventoryReadIsBlocked: true,
  companyWideTargetCanBeRecalculatedLocally: true,
  invalidInputRejected: true,
  accountIdsPrinted: false,
  tokenValuesPrinted: false,
}));
