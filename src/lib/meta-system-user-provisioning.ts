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
    expectedName: (typeof POOLS)[number]["expectedName"];
  }>;
};

type GraphListResponse<T> = {
  data?: T[];
  error?: unknown;
};

type GraphBatchResponse = Array<{
  code?: number;
  body?: string;
}>;

type ProvisioningFailureCategory = NonNullable<MetaProvisioningResult["failureCategory"]>;
type ProvisioningFailureStage = NonNullable<MetaProvisioningResult["failureStage"]>;
type ProviderErrorReason = NonNullable<MetaProvisioningResult["providerErrorReason"]>;

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

    return { expectedName };
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

function getGraphBatchProviderErrorReason(entry: GraphBatchResponse[number]): ProviderErrorReason | undefined {
  if (entry.code === 200 || !entry.body) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(entry.body) as { error?: { message?: unknown } };
    const message = typeof parsed.error?.message === "string" ? parsed.error.message.toLowerCase() : "";

    if (/user.+valid|valid.+user|user.+id/.test(message)) {
      return "invalid_user";
    }

    if (/business.+(id|scope)|business.+permission/.test(message)) {
      return "business_scope";
    }

    if (/unsupported post|does not support this operation/.test(message)) {
      return "unsupported_edge";
    }

    return /invalid parameter/.test(message) ? "invalid_parameter" : "other";
  } catch {
    return "other";
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

async function resolveAppScopedPools(input: {
  configuration: ProvisioningConfiguration;
  accessToken: string;
  appSecret: string;
}): Promise<Array<{ systemUserId: string }>> {
  const response = await graphGet<GraphListResponse<{ id?: string; name?: string; role?: string }>>({
    path: `${input.configuration.businessId}/system_users`,
    accessToken: input.accessToken,
    appSecret: input.appSecret,
    parameters: { fields: "id,name,role", limit: "100" },
  });
  const eligibleUsers = new Map(
    (response.data ?? [])
      .filter((user): user is Required<typeof user> => Boolean(user.id && user.name && user.role === "EMPLOYEE"))
      .map((user) => [user.name, user.id]),
  );
  const pools = input.configuration.pools.map((pool) => ({ systemUserId: eligibleUsers.get(pool.expectedName) }));

  if (pools.some((pool) => !pool.systemUserId)) {
    throw new MetaSystemUserProvisioningError("configuration");
  }

  return pools as Array<{ systemUserId: string }>;
}

async function graphBatchPost(input: {
  accessToken: string;
  appSecret: string;
  batch: Array<{ method: "POST"; relative_url: string }>;
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
  businessId: string;
  systemUserId: string;
  accountIds: string[];
  existingAccountIds: Set<string>;
  accessToken: string;
  appSecret: string;
}): Promise<{
  assignedCount: number;
  failureCategory?: ProvisioningFailureCategory;
  providerErrorCode?: number;
  providerErrorReason?: ProviderErrorReason;
}> {
  const unassigned = input.accountIds.filter((accountId) => !input.existingAccountIds.has(accountId));

  for (let offset = 0; offset < unassigned.length; offset += META_BATCH_SIZE) {
    const accountBatch = unassigned.slice(offset, offset + META_BATCH_SIZE);
    const response = await graphBatchPost({
      accessToken: input.accessToken,
      appSecret: input.appSecret,
      batch: accountBatch.map((accountId) => {
        const parameters = new URLSearchParams({
          business: input.businessId,
          user: input.systemUserId,
          tasks: JSON.stringify(["ANALYZE"]),
        });

        return {
          method: "POST" as const,
          relative_url: `${accountId}/assigned_users?${parameters.toString()}`,
        };
      }),
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
        ...(failedEntry ? { providerErrorReason: getGraphBatchProviderErrorReason(failedEntry) } : {}),
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
  providerErrorReason?: ProviderErrorReason;
}): MetaProvisioningResult {
  return {
    status: "failed",
    candidateAccountCount: input.candidateAccountCount,
    poolOneAssignedAccountCount: input.poolOneAssignedAccountCount ?? 0,
    poolTwoAssignedAccountCount: input.poolTwoAssignedAccountCount ?? 0,
    failureCategory: input.failureCategory,
    failureStage: input.failureStage,
    ...(input.providerErrorCode !== undefined ? { providerErrorCode: input.providerErrorCode } : {}),
    ...(input.providerErrorReason ? { providerErrorReason: input.providerErrorReason } : {}),
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

  if (
    !input.inventory.grantedPermissions?.adsRead
    || !input.inventory.grantedPermissions.adsManagement
    || !input.inventory.grantedPermissions.businessManagement
  ) {
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
    // assets. The Business Suite displays canonical system-user IDs, while
    // Graph requires this app's scoped IDs for asset assignment. Resolve only
    // the two configured Employee pool names in the approved Business Portfolio.
    failureStage = "pool_configuration";
    const appScopedPools = await resolveAppScopedPools({
      configuration,
      accessToken: input.accessToken,
      appSecret: input.appSecret,
    });

    failureStage = "pool_one_assignment";
    const poolOne = await assignAccounts({
      businessId: configuration.businessId,
      systemUserId: appScopedPools[0].systemUserId,
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
            providerErrorReason: poolOne.providerErrorReason,
          }),
          status: "partial",
        });
    }

    failureStage = "pool_two_assignment";
    const poolTwo = await assignAccounts({
      businessId: configuration.businessId,
      systemUserId: appScopedPools[1].systemUserId,
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
            providerErrorReason: poolTwo.providerErrorReason,
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
