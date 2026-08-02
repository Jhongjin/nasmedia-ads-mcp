import "server-only";

import { createHmac } from "node:crypto";

import {
  MAX_META_ASSET_ASSIGNMENTS_PER_SYSTEM_USER,
  MetaConnectionConfigurationError,
  type MetaSystemUserConnection,
  resolveMetaSystemUserConnections,
} from "@/lib/meta-connection-registry";

export const META_GRAPH_VERSION = "v25.0";
const META_PAGE_SIZE = 100;
const META_TIMEOUT_MS = 15_000;
const MAX_META_PAGES_PER_SYSTEM_USER =
  Math.ceil(
    (MAX_META_ASSET_ASSIGNMENTS_PER_SYSTEM_USER + 1) /
      META_PAGE_SIZE,
  );
/**
 * Multi-pool reads must not make one request per system user at a time, but an
 * unbounded fan-out can create a provider-rate-limit or timeout failure at
 * company-wide account scale. Each connection still paginates serially.
 */
export const MAX_CONCURRENT_META_SYSTEM_USER_READS = 4;

export type MetaAdAccount = {
  id: string;
  account_id?: string;
  name?: string;
  account_status?: number;
  disable_reason?: number;
  currency?: string;
  timezone_name?: string;
  amount_spent?: string;
  business?: {
    id?: string;
    name?: string;
  };
};

export type MetaAdAccountListResult = {
  accounts: MetaAdAccount[];
  /** True means the safety page cap was reached before Meta's cursor ended. */
  truncated: boolean;
};

type MetaRoutedAdAccount = MetaAdAccount & {
  readonly connectionId: string;
};

type MetaRoutedAdAccountListResult = {
  accounts: MetaRoutedAdAccount[];
  truncated: boolean;
};

export class MetaMarketingError extends Error {
  constructor(
    public readonly category:
      | "configuration"
      | "permission"
      | "network"
      | "upstream"
      | "topology",
  ) {
    super(category);
    this.name = "MetaMarketingError";
  }
}

type MetaPaging = {
  cursors?: {
    after?: string;
  };
  next?: string;
};

type MetaApiError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
};

type MetaApiResponse<T> = {
  data?: T[];
  paging?: MetaPaging;
  error?: MetaApiError;
};

type MetaActionMetric = {
  action_type?: string;
  value?: string;
};

type MetaInsightRow = {
  date_start?: string;
  date_stop?: string;
  account_id?: string;
  account_name?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  cpc?: string;
  cpm?: string;
  frequency?: string;
  actions?: MetaActionMetric[];
  action_values?: MetaActionMetric[];
};

export type MetaAccountInsights = {
  /**
   * Meta가 해당 기간에 실제 인사이트 행을 반환했는지 여부입니다.
   *
   * false이면 성과가 모두 0이라는 의미가 아니라,
   * 조회 기간에 Meta가 반환한 데이터 행이 없다는 의미입니다.
   */
  hasData: boolean;

  accountName: string;
  currency?: string;
  timezone?: string;
  dateStart: string;
  dateStop: string;

  /**
   * hasData가 false이면 null입니다.
   */
  metrics: {
    impressions: number;
    reach: number;
    clicks: number;
    spend: number;
    ctr: number;
    cpc: number;
    cpm: number;
    frequency: number;
  } | null;

  actions: Record<string, number>;
  actionValues: Record<string, number>;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new MetaMarketingError("configuration");
  }

  return value;
}

function createAppSecretProof(
  accessToken: string,
  appSecret: string,
): string {
  return createHmac("sha256", appSecret)
    .update(accessToken)
    .digest("hex");
}

async function metaGet<T>(
  connection: MetaSystemUserConnection,
  path: string,
  params: Record<string, string>,
): Promise<MetaApiResponse<T>> {
  const accessToken = connection.accessToken;
  const appSecret = getRequiredEnv("META_APP_SECRET");

  const url = new URL(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${path.replace(/^\/+/, "")}`,
  );

  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  url.searchParams.set(
    "appsecret_proof",
    createAppSecretProof(accessToken, appSecret),
  );

  let response: Response;
  let payload: MetaApiResponse<T>;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
    payload = (await response.json()) as MetaApiResponse<T>;
  } catch {
    throw new MetaMarketingError("network");
  }

  if (!response.ok || payload.error) {
    const code = payload.error?.code ?? response.status;
    const isPermissionFailure =
      response.status === 401 ||
      response.status === 403 ||
      code === 10 ||
      code === 190 ||
      code === 200;

    throw new MetaMarketingError(
      isPermissionFailure ? "permission" : "upstream",
    );
  }

  return payload;
}

function publicAccount(account: MetaRoutedAdAccount): MetaAdAccount {
  const { connectionId, ...safeAccount } = account;
  void connectionId;
  return safeAccount;
}

async function mapWithBoundedConcurrency<TInput, TOutput>(
  inputs: readonly TInput[],
  maximumConcurrency: number,
  mapper: (input: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results = new Array<TOutput>(inputs.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= inputs.length) {
        return;
      }

      results[currentIndex] = await mapper(inputs[currentIndex]!);
    }
  }

  const workerCount = Math.min(maximumConcurrency, inputs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function getRoutedMetaAdAccountsForConnection(
  connection: MetaSystemUserConnection,
): Promise<MetaRoutedAdAccountListResult> {
  const accounts: MetaRoutedAdAccount[] = [];
  let after: string | undefined;
  let connectionAccountCount = 0;
  let truncated = false;

  for (let page = 0; page < MAX_META_PAGES_PER_SYSTEM_USER; page += 1) {
    const params: Record<string, string> = {
      fields: [
        "id",
        "account_id",
        "name",
        "account_status",
        "disable_reason",
        "currency",
        "timezone_name",
        "amount_spent",
        "business{id,name}",
      ].join(","),
      limit: String(META_PAGE_SIZE),
    };

    if (after) {
      params.after = after;
    }

    const payload = await metaGet<MetaAdAccount>(
      connection,
      "me/adaccounts",
      params,
    );
    const pageAccounts = payload.data ?? [];

    connectionAccountCount += pageAccounts.length;

    if (connectionAccountCount > MAX_META_ASSET_ASSIGNMENTS_PER_SYSTEM_USER) {
      throw new MetaMarketingError("topology");
    }

    for (const account of pageAccounts) {
      if (!account.id) {
        throw new MetaMarketingError("topology");
      }

      accounts.push({ ...account, connectionId: connection.id });
    }

    const nextAfter = payload.paging?.cursors?.after;

    if (!payload.paging?.next || !nextAfter) {
      break;
    }

    after = nextAfter;

    if (page === MAX_META_PAGES_PER_SYSTEM_USER - 1) {
      truncated = true;
    }
  }

  return { accounts, truncated };
}

async function getRoutedMetaAdAccounts(): Promise<MetaRoutedAdAccountListResult> {
  let registry;

  try {
    registry = resolveMetaSystemUserConnections();
  } catch (error) {
    if (error instanceof MetaConnectionConfigurationError) {
      throw new MetaMarketingError("configuration");
    }

    throw error;
  }

  const connectionResults = await mapWithBoundedConcurrency(
    registry.connections,
    MAX_CONCURRENT_META_SYSTEM_USER_READS,
    getRoutedMetaAdAccountsForConnection,
  );

  const accounts: MetaRoutedAdAccount[] = [];
  const assignedAccountIds = new Set<string>();
  let truncated = false;

  for (const connectionResult of connectionResults) {
    truncated ||= connectionResult.truncated;

    for (const account of connectionResult.accounts) {
      if (assignedAccountIds.has(account.id)) {
        throw new MetaMarketingError("topology");
      }

      assignedAccountIds.add(account.id);
      accounts.push(account);
    }
  }

  return { accounts, truncated };
}

export async function getAssignedMetaAdAccounts(): Promise<MetaAdAccountListResult> {
  const { accounts, truncated } = await getRoutedMetaAdAccounts();

  return {
    accounts: accounts.map(publicAccount),
    truncated,
  };
}

export async function listAssignedMetaAdAccounts(): Promise<MetaAdAccount[]> {
  const { accounts } = await getAssignedMetaAdAccounts();
  return accounts;
}

function normalizeAccountName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "");
}

async function findRoutedMetaAdAccount(
  accountQuery: string,
): Promise<MetaRoutedAdAccount> {
  const trimmedQuery = accountQuery.trim();
  const normalizedQuery =
    normalizeAccountName(trimmedQuery);

  if (!normalizedQuery) {
    throw new Error("광고계정 이름을 입력해 주세요.");
  }

  const { accounts } = await getRoutedMetaAdAccounts();

  const exactMatches = accounts.filter(
    (account) =>
      normalizeAccountName(account.name ?? "") ===
        normalizedQuery ||
      account.account_id === trimmedQuery ||
      account.id === trimmedQuery ||
      account.id === `act_${trimmedQuery}`,
  );

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  if (exactMatches.length > 1) {
    const candidates = exactMatches
      .slice(0, 5)
      .map(
        (account) =>
          account.name ?? "이름 없는 광고계정",
      )
      .join(", ");

    throw new Error(
      `광고계정 정보가 중복됩니다. 다음 중 하나를 더 정확히 입력해 주세요: ${candidates}`,
    );
  }

  const partialMatches = accounts.filter((account) =>
    normalizeAccountName(account.name ?? "").includes(
      normalizedQuery,
    ),
  );

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  if (partialMatches.length > 1) {
    const candidates = partialMatches
      .slice(0, 5)
      .map(
        (account) =>
          account.name ?? "이름 없는 광고계정",
      )
      .join(", ");

    throw new Error(
      `광고계정 이름이 모호합니다. 다음 중 하나를 더 정확히 입력해 주세요: ${candidates}`,
    );
  }

  throw new Error(
    `"${accountQuery}"에 해당하는 광고계정을 찾지 못했습니다.`,
  );
}

export async function findMetaAdAccount(
  accountQuery: string,
): Promise<MetaAdAccount> {
  return publicAccount(await findRoutedMetaAdAccount(accountQuery));
}

function validateDate(
  value: string,
  label: string,
): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `${label}은 YYYY-MM-DD 형식이어야 합니다.`,
    );
  }

  const parsed = new Date(`${value}T00:00:00Z`);

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${label}이 올바른 날짜가 아닙니다.`);
  }
}

function toNumber(
  value: string | undefined,
): number {
  if (!value) {
    return 0;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : 0;
}

function toMetricMap(
  metrics: MetaActionMetric[] | undefined,
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const metric of metrics ?? []) {
    if (!metric.action_type) {
      continue;
    }

    result[metric.action_type] = toNumber(
      metric.value,
    );
  }

  return result;
}

export async function getMetaAdAccountInsights(input: {
  accountQuery: string;
  since: string;
  until: string;
}): Promise<MetaAccountInsights> {
  validateDate(input.since, "시작일");
  validateDate(input.until, "종료일");

  if (input.since > input.until) {
    throw new Error(
      "시작일은 종료일보다 늦을 수 없습니다.",
    );
  }

  const account = await findRoutedMetaAdAccount(
    input.accountQuery,
  );

  let registry;

  try {
    registry = resolveMetaSystemUserConnections();
  } catch (error) {
    if (error instanceof MetaConnectionConfigurationError) {
      throw new MetaMarketingError("configuration");
    }

    throw error;
  }

  const connection = registry.connections.find(
    (candidate) => candidate.id === account.connectionId,
  );

  if (!connection) {
    throw new MetaMarketingError("topology");
  }

  const payload = await metaGet<MetaInsightRow>(
    connection,
    `${account.id}/insights`,
    {
      fields: [
        "date_start",
        "date_stop",
        "account_id",
        "account_name",
        "impressions",
        "reach",
        "clicks",
        "spend",
        "ctr",
        "cpc",
        "cpm",
        "frequency",
        "actions",
        "action_values",
      ].join(","),
      level: "account",
      time_increment: "all_days",
      time_range: JSON.stringify({
        since: input.since,
        until: input.until,
      }),
      limit: "100",
    },
  );

  const row = payload.data?.[0];

  /**
   * Meta가 인사이트 행을 반환하지 않은 경우입니다.
   *
   * 이 경우 성과 수치가 0이라는 의미가 아니므로,
   * metrics를 null로 반환합니다.
   */
  if (!row) {
    return {
      hasData: false,
      accountName:
        account.name ?? "이름 없는 광고계정",
      currency: account.currency,
      timezone: account.timezone_name,
      dateStart: input.since,
      dateStop: input.until,
      metrics: null,
      actions: {},
      actionValues: {},
    };
  }

  return {
    hasData: true,
    accountName:
      row.account_name ??
      account.name ??
      "이름 없는 광고계정",
    currency: account.currency,
    timezone: account.timezone_name,
    dateStart: row.date_start ?? input.since,
    dateStop: row.date_stop ?? input.until,
    metrics: {
      impressions: toNumber(row.impressions),
      reach: toNumber(row.reach),
      clicks: toNumber(row.clicks),
      spend: toNumber(row.spend),
      ctr: toNumber(row.ctr),
      cpc: toNumber(row.cpc),
      cpm: toNumber(row.cpm),
      frequency: toNumber(row.frequency),
    },
    actions: toMetricMap(row.actions),
    actionValues: toMetricMap(
      row.action_values,
    ),
  };
}
