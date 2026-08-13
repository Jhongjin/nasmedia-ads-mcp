import "server-only";

import {
  createMetaAppSecretProof,
  META_GRAPH_VERSION,
  type MetaPersonalAccessInventory,
  type MetaProvisioningResult,
} from "@/lib/meta-personal-access-inventory";
import {
  recordMetaActiveAccountProvisioningOutcome,
  runMetaRecentSpendFilterWithCandidates,
  type MetaActiveAccountScanCandidates,
} from "@/lib/meta-active-account-scan";

const META_TIMEOUT_MS = 20_000;
const META_BATCH_SIZE = 50;
const MAX_ACTIVE_ACCOUNTS_PER_POOL = 250;
const MAX_ACTIVE_ACCOUNTS_FOR_TWO_POOLS = MAX_ACTIVE_ACCOUNTS_PER_POOL * 2;
const POOLS = [
  {
    environmentName: "META_ACTIVE_ACCOUNT_POOL_01_SYSTEM_USER_ID",
    expectedName: "NasmediaAdsPool01",
  },
  {
    environmentName: "META_ACTIVE_ACCOUNT_POOL_02_SYSTEM_USER_ID",
    expectedName: "NasmediaAdsPool02",
  },
] as const;

type ProvisioningConfiguration = {
  businessId: string;
  pools: Array<{
    systemUserId: string;
  }>;
};

type GraphBatchResponse = Array<{
  code?: number;
  body?: string;
}>;

type ProvisioningFailureCategory = NonNullable<MetaProvisioningResult["failureCategory"]>;
type ProvisioningFailureStage = NonNullable<MetaProvisioningResult["failureStage"]>;

class MetaSystemUserProvisioningError extends Error {
  constructor(readonly category: ProvisioningFailureCategory) {
    super(category);
    this.name = "MetaSystemUserProvisioningError";
  }
}

function getConfiguration(): ProvisioningConfiguration | null {
  const businessId = process.env.META_BUSINESS_ID?.trim();

  if (!businessId || !/^\d{10,20}$/.test(businessId)) {
    return null;
  }

  const pools = POOLS.map(({ environmentName }) => {
    const systemUserId = process.env[environmentName]?.trim();

    if (!systemUserId || !/^\d{10,20}$/.test(systemUserId)) {
      return null;
    }

    return { systemUserId };
  });

  return pools.every((pool) => pool !== null)
    ? { businessId, pools: pools as ProvisioningConfiguration["pools"] }
    : null;
}

function toFailureCategory(response: Response): ProvisioningFailureCategory {
  return response.status === 400 || response.status === 401 || response.status === 403
    ? "permission"
    : "upstream";
}

function getGraphBatchProviderErrorCode(entry: GraphBatchResponse[number]): number | undefined {
  if (entry.code === 200 || !entry.body) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(entry.body) as { error?: { code?: unknown } };
    const errorCode = parsed.error?.code;

    return typeof errorCode === "number" && Number.isInteger(errorCode) && errorCode >= 0
      ? errorCode
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeAccountId(value: string): string | null {
  const normalized = value.trim();

  if (/^act_\d{5,20}$/.test(normalized)) {
    return normalized;
  }

  return /^\d{5,20}$/.test(normalized) ? `act_${normalized}` : null;
}

function uniqueNormalizedAccountIds(values: string[]): string[] | null {
  const normalized = values.map(normalizeAccountId);

  return normalized.some((value) => value === null) ? null : [...new Set(normalized as string[])];
}

async function graphBatchPost(input: {
  accessToken: string;
  appSecret: string;
  batch: Array<{ method: "POST"; relative_url: string; body: string }>;
}): Promise<GraphBatchResponse> {
  let response: Response;
  let payload: GraphBatchResponse;

  try {
    response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: input.accessToken,
        appsecret_proof: createMetaAppSecretProof(input.accessToken, input.appSecret),
        batch: JSON.stringify(input.batch),
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
    payload = (await response.json()) as GraphBatchResponse;
  } catch {
    throw new MetaSystemUserProvisioningError("network");
  }

  if (!response.ok || !Array.isArray(payload)) {
    throw new MetaSystemUserProvisioningError(toFailureCategory(response));
  }

  return payload;
}

async function assignAccounts(input: {
  systemUserId: string;
  accountIds: string[];
  existingAccountIds: Set<string>;
  accessToken: string;
  appSecret: string;
}): Promise<{
  assignedCount: number;
  failureCategory?: ProvisioningFailureCategory;
  providerErrorCode?: number;
}> {
  const unassigned = input.accountIds.filter((accountId) => !input.existingAccountIds.has(accountId));

  for (let offset = 0; offset < unassigned.length; offset += META_BATCH_SIZE) {
    const accountBatch = unassigned.slice(offset, offset + META_BATCH_SIZE);
    const response = await graphBatchPost({
      accessToken: input.accessToken,
      appSecret: input.appSecret,
      batch: accountBatch.map((accountId) => ({
        method: "POST" as const,
        relative_url: `${accountId}/assigned_users`,
        body: new URLSearchParams({
          user: input.systemUserId,
          tasks: JSON.stringify(["ANALYZE"]),
        }).toString(),
      })),
    });
    const successful = response.filter((entry) => entry.code === 200).length;

    if (successful !== accountBatch.length) {
      const failedEntry = response.find((entry) => entry.code !== 200);

      return {
        assignedCount: offset + successful,
        failureCategory: response.some((entry) => entry.code === 400 || entry.code === 401 || entry.code === 403)
          ? "permission"
          : "upstream",
        ...(failedEntry ? { providerErrorCode: getGraphBatchProviderErrorCode(failedEntry) } : {}),
      };
    }
  }

  return { assignedCount: unassigned.length };
}

function failedResult(input: {
  candidateAccountCount: number;
  failureCategory: ProvisioningFailureCategory;
  failureStage: ProvisioningFailureStage;
  poolOneAssignedAccountCount?: number;
  poolTwoAssignedAccountCount?: number;
  providerErrorCode?: number;
}): MetaProvisioningResult {
  return {
    status: "failed",
    candidateAccountCount: input.candidateAccountCount,
    poolOneAssignedAccountCount: input.poolOneAssignedAccountCount ?? 0,
    poolTwoAssignedAccountCount: input.poolTwoAssignedAccountCount ?? 0,
    failureCategory: input.failureCategory,
    failureStage: input.failureStage,
    ...(input.providerErrorCode !== undefined ? { providerErrorCode: input.providerErrorCode } : {}),
  };
}

/**
 * Grants only the Meta ANALYZE task to the current recent-spend candidates.
 * It never creates campaigns, ads, budgets, creatives, or account assets and
 * never persists the personal administrator token or raw account identifiers.
 */
export async function provisionRecentActiveAdAccounts(input: {
  accessToken: string;
  appSecret: string;
  operatorSubject: string;
  accountIds: string[];
  inventory: MetaPersonalAccessInventory;
}): Promise<{ recentSpendFilter: MetaActiveAccountScanCandidates["summary"]; provisioning: MetaProvisioningResult }> {
  const scan = await runMetaRecentSpendFilterWithCandidates(input);
  const candidateAccountIds = uniqueNormalizedAccountIds(scan.activeAccountIds);
  const complete = async (provisioning: MetaProvisioningResult) => {
    await recordMetaActiveAccountProvisioningOutcome({
      operatorSubject: input.operatorSubject,
      runId: scan.runId,
      outcome: provisioning,
    });
    return { recentSpendFilter: scan.summary, provisioning };
  };

  if (scan.summary.status !== "completed" || !candidateAccountIds) {
    return complete(failedResult({
        candidateAccountCount: 0,
        failureCategory: "configuration",
        failureStage: "active_account_scan",
      }));
  }

  if (!input.inventory.grantedPermissions?.adsRead || !input.inventory.grantedPermissions.businessManagement) {
    return complete(failedResult({
        candidateAccountCount: candidateAccountIds.length,
        failureCategory: "permission",
        failureStage: "permission_check",
      }));
  }

  if (candidateAccountIds.length > MAX_ACTIVE_ACCOUNTS_FOR_TWO_POOLS) {
    return complete(failedResult({
        candidateAccountCount: candidateAccountIds.length,
        failureCategory: "configuration",
        failureStage: "capacity_check",
      }));
  }

  const configuration = getConfiguration();

  if (!configuration) {
    return complete(failedResult({
        candidateAccountCount: candidateAccountIds.length,
        failureCategory: "configuration",
        failureStage: "pool_configuration",
      }));
  }

  const poolOneCandidates = candidateAccountIds.slice(0, MAX_ACTIVE_ACCOUNTS_PER_POOL);
  const poolTwoCandidates = candidateAccountIds.slice(MAX_ACTIVE_ACCOUNTS_PER_POOL);
  let failureStage: ProvisioningFailureStage = "capacity_check";

  try {
    if (poolOneCandidates.length > MAX_ACTIVE_ACCOUNTS_PER_POOL || poolTwoCandidates.length > MAX_ACTIVE_ACCOUNTS_PER_POOL) {
      return complete(failedResult({
          candidateAccountCount: candidateAccountIds.length,
          failureCategory: "configuration",
          failureStage: "capacity_check",
      }));
    }

    // Business Suite was read-only verified immediately before this approved
    // one-time migration: both explicit Employee pools had zero assigned
    // assets. Meta's user token does not expose system-user read edges, so the
    // first provider-side validation is the bounded assigned_users mutation.
    // Any invalid pool ID or missing right is returned as a failed batch and
    // prevents progress beyond that pool.
    failureStage = "pool_one_assignment";
    const poolOne = await assignAccounts({
      systemUserId: configuration.pools[0].systemUserId,
      accountIds: poolOneCandidates,
      existingAccountIds: new Set(),
      accessToken: input.accessToken,
      appSecret: input.appSecret,
    });

    if (poolOne.failureCategory) {
      return complete({
          ...failedResult({
            candidateAccountCount: candidateAccountIds.length,
            poolOneAssignedAccountCount: poolOne.assignedCount,
            failureCategory: poolOne.failureCategory,
            failureStage: "pool_one_assignment",
            providerErrorCode: poolOne.providerErrorCode,
          }),
          status: "partial",
        });
    }

    failureStage = "pool_two_assignment";
    const poolTwo = await assignAccounts({
      systemUserId: configuration.pools[1].systemUserId,
      accountIds: poolTwoCandidates,
      existingAccountIds: new Set(),
      accessToken: input.accessToken,
      appSecret: input.appSecret,
    });

    if (poolTwo.failureCategory) {
      return complete({
          ...failedResult({
            candidateAccountCount: candidateAccountIds.length,
            poolOneAssignedAccountCount: poolOne.assignedCount,
            poolTwoAssignedAccountCount: poolTwo.assignedCount,
            failureCategory: poolTwo.failureCategory,
            failureStage: "pool_two_assignment",
            providerErrorCode: poolTwo.providerErrorCode,
          }),
          status: "partial",
        });
    }

    return complete({
        status: "completed",
        candidateAccountCount: candidateAccountIds.length,
        poolOneAssignedAccountCount: poolOne.assignedCount,
        poolTwoAssignedAccountCount: poolTwo.assignedCount,
      });
  } catch (error) {
    return complete(failedResult({
        candidateAccountCount: candidateAccountIds.length,
        failureCategory: error instanceof MetaSystemUserProvisioningError ? error.category : "upstream",
        failureStage,
      }));
  }
}

export const metaSystemUserProvisioningInternals = {
  normalizeAccountId,
  uniqueNormalizedAccountIds,
};
