/**
 * Account-level policy is intentionally modelled separately from Meta
 * credentials and Meta Business Suite assignments.
 *
 * The current deployment has no durable policy store connected to this
 * application. Therefore this module can prepare a truthful read-only
 * management view, but it cannot claim that an account was enabled or disabled
 * for MCP until a server-side governance ledger is approved and connected.
 */

export type MetaMcpAccountPolicyState = "enabled" | "disabled";

export type MetaMcpAccountPolicyRecord = Readonly<{
  accountId: string;
  state: MetaMcpAccountPolicyState;
}>;

export type MetaMcpGovernanceAccountInput = Readonly<{
  id: string;
  name: string;
  business: Readonly<{
    name: string;
  }>;
}>;

export type MetaMcpGovernanceAccount = Readonly<{
  name: string;
  businessName: string;
  liveReadStatus: "connected";
  policyStatus: "enabled" | "disabled" | "not_configured";
}>;

export type MetaMcpTopologyReadiness = Readonly<{
  configuredSystemUserCount: number;
  perSystemUserTotalAssetLimit: number;
  nominalAdAccountCapacityAtZeroOtherAssets: number;
  observedAccountCount: number;
  requiredSystemUserCountAtObservedScale: number;
  hasNominalCapacityForObservedAccounts: boolean;
}>;

/**
 * The company's stated upper-bound target. This is a planning input only; it
 * is not an inventory result and must never cause a Meta asset assignment.
 */
/**
 * A starting point for the operator-facing capacity planner, not a company
 * coverage cap. The actual target must be entered from the approved aggregate
 * inventory of every company-linked advertising account.
 */
export const META_MCP_INITIAL_TARGET_AD_ACCOUNT_COUNT = 2_000;

/**
 * Reserve 50 of Meta's 300 total asset slots for pages, pixels, catalogs, and
 * ordinary account growth. The actual bucket size still requires a verified
 * Business Suite asset inventory before a production cutover.
 */
export const META_MCP_RECOMMENDED_AD_ACCOUNT_BUDGET_PER_SYSTEM_USER = 250;

export type MetaMcpTargetTopologyScenario = Readonly<{
  targetAdAccountCount: number;
  perSystemUserTotalAssetLimit: number;
  recommendedAdAccountBudgetPerSystemUser: number;
  reservedOtherAssetSlotsPerSystemUser: number;
  theoreticalMinimumSystemUserCount: number;
  recommendedSystemUserPoolCount: number;
  recommendedAccountCapacity: number;
  requiresVerifiedAssetInventory: true;
}>;

/**
 * Aggregate-only inventory for one company-managed system-user bucket.
 * `systemUserSlot` is an operator-assigned ordinal, not a Meta identifier.
 * It intentionally carries no account IDs, asset names, or credentials.
 */
export type MetaMcpSystemUserAggregateInventory = Readonly<{
  systemUserSlot: number;
  adAccountCount: number;
  pageCount: number;
  pixelCount: number;
  catalogCount: number;
  otherAssetCount: number;
  reportedTotalAssetCount: number;
}>;

export type MetaMcpVerifiedTopologyAssessment = Readonly<{
  configuredSystemUserCount: number;
  reportedSystemUserCount: number;
  totalAdAccountCount: number;
  totalNonAdAssetCount: number;
  totalAssignedAssetCount: number;
  totalRemainingAssetHeadroom: number;
  maximumAdAccountCapacityAtCurrentNonAdAssetUsage: number;
  inventoryCoversEveryConfiguredSystemUser: boolean;
  everySystemUserWithinAssetLimit: boolean;
  canSupportTargetAdAccountCount: boolean;
  canProceedToTopologyDecision: boolean;
}>;

function normalizeAccountId(value: string): string {
  return value.trim();
}

export function buildMetaMcpGovernanceAccounts(
  accounts: readonly MetaMcpGovernanceAccountInput[],
  policies: readonly MetaMcpAccountPolicyRecord[],
): readonly MetaMcpGovernanceAccount[] {
  const policyByAccountId = new Map<string, MetaMcpAccountPolicyState>();

  for (const policy of policies) {
    const accountId = normalizeAccountId(policy.accountId);

    if (!accountId || policyByAccountId.has(accountId)) {
      throw new Error("Invalid Meta MCP account policy registry.");
    }

    policyByAccountId.set(accountId, policy.state);
  }

  const seenAccountIds = new Set<string>();

  return Object.freeze(accounts.map((account) => {
    const accountId = normalizeAccountId(account.id);

    if (!accountId || seenAccountIds.has(accountId)) {
      throw new Error("Invalid Meta account inventory.");
    }

    seenAccountIds.add(accountId);
    const policy = policyByAccountId.get(accountId);

    return Object.freeze({
      name: account.name,
      businessName: account.business.name,
      liveReadStatus: "connected" as const,
      policyStatus: policy ?? "not_configured",
    });
  }));
}

export function buildMetaMcpTopologyReadiness(input: Readonly<{
  configuredSystemUserCount: number;
  perSystemUserTotalAssetLimit: number;
  observedAccountCount: number;
}>): MetaMcpTopologyReadiness {
  const { configuredSystemUserCount, perSystemUserTotalAssetLimit, observedAccountCount } = input;

  if (
    !Number.isInteger(configuredSystemUserCount) ||
    !Number.isInteger(perSystemUserTotalAssetLimit) ||
    !Number.isInteger(observedAccountCount) ||
    configuredSystemUserCount < 1 ||
    perSystemUserTotalAssetLimit < 1 ||
    observedAccountCount < 0
  ) {
    throw new Error("Invalid Meta MCP topology summary.");
  }

  const nominalAdAccountCapacityAtZeroOtherAssets =
    configuredSystemUserCount * perSystemUserTotalAssetLimit;
  const requiredSystemUserCountAtObservedScale = Math.ceil(
    observedAccountCount / perSystemUserTotalAssetLimit,
  );

  return Object.freeze({
    configuredSystemUserCount,
    perSystemUserTotalAssetLimit,
    nominalAdAccountCapacityAtZeroOtherAssets,
    observedAccountCount,
    requiredSystemUserCountAtObservedScale,
    hasNominalCapacityForObservedAccounts:
      observedAccountCount <= nominalAdAccountCapacityAtZeroOtherAssets,
  });
}

/**
 * Builds an explicit, conservative capacity scenario for a target account
 * count. It has no Meta API, credential, database, or policy-ledger effect.
 */
export function buildMetaMcpTargetTopologyScenario(input: Readonly<{
  targetAdAccountCount: number;
  perSystemUserTotalAssetLimit: number;
  recommendedAdAccountBudgetPerSystemUser: number;
}>): MetaMcpTargetTopologyScenario {
  const {
    targetAdAccountCount,
    perSystemUserTotalAssetLimit,
    recommendedAdAccountBudgetPerSystemUser,
  } = input;

  if (
    !Number.isInteger(targetAdAccountCount)
    || !Number.isInteger(perSystemUserTotalAssetLimit)
    || !Number.isInteger(recommendedAdAccountBudgetPerSystemUser)
    || targetAdAccountCount < 1
    || perSystemUserTotalAssetLimit < 1
    || recommendedAdAccountBudgetPerSystemUser < 1
    || recommendedAdAccountBudgetPerSystemUser > perSystemUserTotalAssetLimit
  ) {
    throw new Error("Invalid Meta MCP target topology scenario.");
  }

  const theoreticalMinimumSystemUserCount = Math.ceil(
    targetAdAccountCount / perSystemUserTotalAssetLimit,
  );
  const recommendedSystemUserPoolCount = Math.ceil(
    targetAdAccountCount / recommendedAdAccountBudgetPerSystemUser,
  );

  return Object.freeze({
    targetAdAccountCount,
    perSystemUserTotalAssetLimit,
    recommendedAdAccountBudgetPerSystemUser,
    reservedOtherAssetSlotsPerSystemUser:
      perSystemUserTotalAssetLimit - recommendedAdAccountBudgetPerSystemUser,
    theoreticalMinimumSystemUserCount,
    recommendedSystemUserPoolCount,
    recommendedAccountCapacity:
      recommendedSystemUserPoolCount * recommendedAdAccountBudgetPerSystemUser,
    requiresVerifiedAssetInventory: true as const,
  });
}

function assertNonNegativeInteger(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Invalid Meta MCP aggregate inventory.");
  }
}

/**
 * Validates an aggregate Meta Business Suite asset snapshot without reading
 * Meta, storing the snapshot, or exposing any sensitive inventory identity.
 *
 * This is deliberately separate from the account-list pagination path: a
 * complete per-system-user total-asset snapshot is required before the company
 * can decide whether the approved all-company system-user pool is operationally safe.
 */
export function assessMetaMcpVerifiedTopology(input: Readonly<{
  configuredSystemUserCount: number;
  perSystemUserTotalAssetLimit: number;
  targetAdAccountCount: number;
  inventories: readonly MetaMcpSystemUserAggregateInventory[];
}>): MetaMcpVerifiedTopologyAssessment {
  const {
    configuredSystemUserCount,
    perSystemUserTotalAssetLimit,
    targetAdAccountCount,
    inventories,
  } = input;

  if (
    !Number.isInteger(configuredSystemUserCount)
    || configuredSystemUserCount < 1
    || !Number.isInteger(perSystemUserTotalAssetLimit)
    || perSystemUserTotalAssetLimit < 1
    || !Number.isInteger(targetAdAccountCount)
    || targetAdAccountCount < 1
    || inventories.length > configuredSystemUserCount
  ) {
    throw new Error("Invalid Meta MCP aggregate inventory.");
  }

  const seenSlots = new Set<number>();
  let totalAdAccountCount = 0;
  let totalNonAdAssetCount = 0;
  let totalAssignedAssetCount = 0;
  let everySystemUserWithinAssetLimit = true;

  for (const inventory of inventories) {
    assertNonNegativeInteger(inventory.systemUserSlot);
    assertNonNegativeInteger(inventory.adAccountCount);
    assertNonNegativeInteger(inventory.pageCount);
    assertNonNegativeInteger(inventory.pixelCount);
    assertNonNegativeInteger(inventory.catalogCount);
    assertNonNegativeInteger(inventory.otherAssetCount);
    assertNonNegativeInteger(inventory.reportedTotalAssetCount);

    if (
      inventory.systemUserSlot < 1
      || inventory.systemUserSlot > configuredSystemUserCount
      || seenSlots.has(inventory.systemUserSlot)
    ) {
      throw new Error("Invalid Meta MCP aggregate inventory.");
    }

    seenSlots.add(inventory.systemUserSlot);

    const calculatedTotal =
      inventory.adAccountCount
      + inventory.pageCount
      + inventory.pixelCount
      + inventory.catalogCount
      + inventory.otherAssetCount;

    if (calculatedTotal !== inventory.reportedTotalAssetCount) {
      throw new Error("Invalid Meta MCP aggregate inventory.");
    }

    totalAdAccountCount += inventory.adAccountCount;
    totalNonAdAssetCount += calculatedTotal - inventory.adAccountCount;
    totalAssignedAssetCount += calculatedTotal;
    everySystemUserWithinAssetLimit &&= calculatedTotal <= perSystemUserTotalAssetLimit;
  }

  const inventoryCoversEveryConfiguredSystemUser =
    inventories.length === configuredSystemUserCount;
  const totalCapacityAtCurrentNonAdAssetUsage = inventories.reduce(
    (sum, inventory) => sum + Math.max(
      0,
      perSystemUserTotalAssetLimit
        - (inventory.reportedTotalAssetCount - inventory.adAccountCount),
    ),
    0,
  );
  const totalRemainingAssetHeadroom = inventories.reduce(
    (sum, inventory) => sum + Math.max(
      0,
      perSystemUserTotalAssetLimit - inventory.reportedTotalAssetCount,
    ),
    0,
  );
  const canSupportTargetAdAccountCount =
    inventoryCoversEveryConfiguredSystemUser
    && everySystemUserWithinAssetLimit
    && totalCapacityAtCurrentNonAdAssetUsage >= targetAdAccountCount;

  return Object.freeze({
    configuredSystemUserCount,
    reportedSystemUserCount: inventories.length,
    totalAdAccountCount,
    totalNonAdAssetCount,
    totalAssignedAssetCount,
    totalRemainingAssetHeadroom,
    maximumAdAccountCapacityAtCurrentNonAdAssetUsage:
      totalCapacityAtCurrentNonAdAssetUsage,
    inventoryCoversEveryConfiguredSystemUser,
    everySystemUserWithinAssetLimit,
    canSupportTargetAdAccountCount,
    canProceedToTopologyDecision:
      inventoryCoversEveryConfiguredSystemUser && everySystemUserWithinAssetLimit,
  });
}
