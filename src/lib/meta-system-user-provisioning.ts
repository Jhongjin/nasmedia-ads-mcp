import "server-only";

import {
  createMetaAppSecretProof,
  META_GRAPH_VERSION,
  type MetaPersonalAccessInventory,
  type MetaProvisioningResult,
} from "@/lib/meta-personal-access-inventory";
import {
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
    expectedName: (typeof POOLS)[number]["expectedName"];
  }>;
};

type GraphListResponse<T> = {
  data?: T[];
  paging?: {
    cursors?: { after?: string };
    next?: string;
  };
  error?: unknown;
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

  const pools = POOLS.map(({ environmentName, expectedName }) => {
    const systemUserId = process.env[environmentName]?.trim();

    if (!systemUserId || !/^\d{10,20}$/.test(systemUserId)) {
      return null;
    }

    return { systemUserId, expectedName };
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

async function graphGet<T>(input: {
  path: string;
  accessToken: string;
  appSecret: string;
  parameters: Record<string, string>;
}): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${META_GRAPH_VERSION}/${input.path.replace(/^\/+/, "")}`);

  for (const [name, value] of Object.entries(input.parameters)) {
    url.searchParams.set(name, value);
  }

  url.searchParams.set("appsecret_proof", createMetaAppSecretProof(input.accessToken, input.appSecret));

  let response: Response;
  let payload: T & { error?: unknown };

  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${input.accessToken}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
    payload = (await response.json()) as T & { error?: unknown };
  } catch {
    throw new MetaSystemUserProvisioningError("network");
  }

  if (!response.ok || payload.error) {
    throw new MetaSystemUserProvisioningError(toFailureCategory(response));
  }

  return payload;
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

async function verifyPools(input: {
  configuration: ProvisioningConfiguration;
  accessToken: string;
  appSecret: string;
}) {
  const response = await graphGet<GraphListResponse<{ id?: string; name?: string; role?: string }>>({
    path: `${input.configuration.businessId}/system_users`,
    accessToken: input.accessToken,
    appSecret: input.appSecret,
    parameters: { fields: "id,name,role", limit: "100" },
  });
  const users = new Map(
    (response.data ?? [])
      .filter((user): user is Required<typeof user> => Boolean(user.id && user.name && user.role))
      .map((user) => [user.id, user]),
  );

  for (const pool of input.configuration.pools) {
    const user = users.get(pool.systemUserId);

    if (!user || user.name !== pool.expectedName || user.role !== "EMPLOYEE") {
      throw new MetaSystemUserProvisioningError("configuration");
    }
  }
}

async function listAssignedAdAccountIds(input: {
  systemUserId: string;
  accessToken: string;
  appSecret: string;
}): Promise<Set<string>> {
  const accountIds = new Set<string>();
  let after: string | undefined;

  while (accountIds.size <= MAX_ACTIVE_ACCOUNTS_PER_POOL) {
    const response = await graphGet<GraphListResponse<{ id?: string }>>({
      path: `${input.systemUserId}/assigned_ad_accounts`,
      accessToken: input.accessToken,
      appSecret: input.appSecret,
      parameters: {
        fields: "id",
        limit: "100",
        ...(after ? { after } : {}),
      },
    });

    for (const account of response.data ?? []) {
      const normalized = typeof account.id === "string" ? normalizeAccountId(account.id) : null;

      if (!normalized) {
        throw new MetaSystemUserProvisioningError("upstream");
      }

      accountIds.add(normalized);
    }

    const nextAfter = response.paging?.cursors?.after;

    if (!response.paging?.next || !nextAfter) {
      break;
    }

    after = nextAfter;
  }

  if (accountIds.size > MAX_ACTIVE_ACCOUNTS_PER_POOL) {
    throw new MetaSystemUserProvisioningError("configuration");
  }

  return accountIds;
}

async function assignAccounts(input: {
  systemUserId: string;
  accountIds: string[];
  existingAccountIds: Set<string>;
  accessToken: string;
  appSecret: string;
}): Promise<{ assignedCount: number; failureCategory?: ProvisioningFailureCategory }> {
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
      return {
        assignedCount: offset + successful,
        failureCategory: response.some((entry) => entry.code === 400 || entry.code === 401 || entry.code === 403)
          ? "permission"
          : "upstream",
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
}): MetaProvisioningResult {
  return {
    status: "failed",
    candidateAccountCount: input.candidateAccountCount,
    poolOneAssignedAccountCount: input.poolOneAssignedAccountCount ?? 0,
    poolTwoAssignedAccountCount: input.poolTwoAssignedAccountCount ?? 0,
    failureCategory: input.failureCategory,
    failureStage: input.failureStage,
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

  if (scan.summary.status !== "completed" || !candidateAccountIds) {
    return {
      recentSpendFilter: scan.summary,
      provisioning: failedResult({
        candidateAccountCount: 0,
        failureCategory: "configuration",
        failureStage: "active_account_scan",
      }),
    };
  }

  if (!input.inventory.grantedPermissions?.adsRead || !input.inventory.grantedPermissions.businessManagement) {
    return {
      recentSpendFilter: scan.summary,
      provisioning: failedResult({
        candidateAccountCount: candidateAccountIds.length,
        failureCategory: "permission",
        failureStage: "permission_check",
      }),
    };
  }

  if (candidateAccountIds.length > MAX_ACTIVE_ACCOUNTS_FOR_TWO_POOLS) {
    return {
      recentSpendFilter: scan.summary,
      provisioning: failedResult({
        candidateAccountCount: candidateAccountIds.length,
        failureCategory: "configuration",
        failureStage: "capacity_check",
      }),
    };
  }

  const configuration = getConfiguration();

  if (!configuration) {
    return {
      recentSpendFilter: scan.summary,
      provisioning: failedResult({
        candidateAccountCount: candidateAccountIds.length,
        failureCategory: "configuration",
        failureStage: "pool_configuration",
      }),
    };
  }

  const poolOneCandidates = candidateAccountIds.slice(0, MAX_ACTIVE_ACCOUNTS_PER_POOL);
  const poolTwoCandidates = candidateAccountIds.slice(MAX_ACTIVE_ACCOUNTS_PER_POOL);
  let failureStage: ProvisioningFailureStage = "pool_validation";

  try {
    await verifyPools({ configuration, accessToken: input.accessToken, appSecret: input.appSecret });
    failureStage = "assignment_inventory";
    const [poolOneExisting, poolTwoExisting] = await Promise.all(
      configuration.pools.map((pool) => listAssignedAdAccountIds({
        systemUserId: pool.systemUserId,
        accessToken: input.accessToken,
        appSecret: input.appSecret,
      })),
    );

    if (
      poolOneCandidates.length > MAX_ACTIVE_ACCOUNTS_PER_POOL
      || poolTwoCandidates.length > MAX_ACTIVE_ACCOUNTS_PER_POOL
      || poolOneExisting.size + poolOneCandidates.filter((id) => !poolOneExisting.has(id)).length > MAX_ACTIVE_ACCOUNTS_PER_POOL
      || poolTwoExisting.size + poolTwoCandidates.filter((id) => !poolTwoExisting.has(id)).length > MAX_ACTIVE_ACCOUNTS_PER_POOL
    ) {
      return {
        recentSpendFilter: scan.summary,
        provisioning: failedResult({
          candidateAccountCount: candidateAccountIds.length,
          failureCategory: "configuration",
          failureStage: "capacity_check",
        }),
      };
    }

    failureStage = "pool_one_assignment";
    const poolOne = await assignAccounts({
      systemUserId: configuration.pools[0].systemUserId,
      accountIds: poolOneCandidates,
      existingAccountIds: poolOneExisting,
      accessToken: input.accessToken,
      appSecret: input.appSecret,
    });

    if (poolOne.failureCategory) {
      return {
        recentSpendFilter: scan.summary,
        provisioning: {
          ...failedResult({
            candidateAccountCount: candidateAccountIds.length,
            poolOneAssignedAccountCount: poolOneExisting.size + poolOne.assignedCount,
            failureCategory: poolOne.failureCategory,
            failureStage: "pool_one_assignment",
          }),
          status: "partial",
        },
      };
    }

    failureStage = "pool_two_assignment";
    const poolTwo = await assignAccounts({
      systemUserId: configuration.pools[1].systemUserId,
      accountIds: poolTwoCandidates,
      existingAccountIds: poolTwoExisting,
      accessToken: input.accessToken,
      appSecret: input.appSecret,
    });

    if (poolTwo.failureCategory) {
      return {
        recentSpendFilter: scan.summary,
        provisioning: {
          ...failedResult({
            candidateAccountCount: candidateAccountIds.length,
            poolOneAssignedAccountCount: poolOneExisting.size + poolOne.assignedCount,
            poolTwoAssignedAccountCount: poolTwoExisting.size + poolTwo.assignedCount,
            failureCategory: poolTwo.failureCategory,
            failureStage: "pool_two_assignment",
          }),
          status: "partial",
        },
      };
    }

    return {
      recentSpendFilter: scan.summary,
      provisioning: {
        status: "completed",
        candidateAccountCount: candidateAccountIds.length,
        poolOneAssignedAccountCount: poolOneExisting.size + poolOne.assignedCount,
        poolTwoAssignedAccountCount: poolTwoExisting.size + poolTwo.assignedCount,
      },
    };
  } catch (error) {
    return {
      recentSpendFilter: scan.summary,
      provisioning: failedResult({
        candidateAccountCount: candidateAccountIds.length,
        failureCategory: error instanceof MetaSystemUserProvisioningError ? error.category : "upstream",
        failureStage,
      }),
    };
  }
}

export const metaSystemUserProvisioningInternals = {
  normalizeAccountId,
  uniqueNormalizedAccountIds,
};
