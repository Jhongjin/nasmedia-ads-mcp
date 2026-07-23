import { createHmac } from "node:crypto";

const META_GRAPH_VERSION = "v25.0";
const MAX_META_PAGES = 5;

export type MetaAdAccount = {
  id: string;
  account_id?: string;
  name?: string;
  account_status?: number;
  disable_reason?: number;
  currency?: string;
  timezone_name?: string;
};

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
  accountName: string;
  currency?: string;
  timezone?: string;
  dateStart: string;
  dateStop: string;
  metrics: {
    impressions: number;
    reach: number;
    clicks: number;
    spend: number;
    ctr: number;
    cpc: number;
    cpm: number;
    frequency: number;
  };
  actions: Record<string, number>;
  actionValues: Record<string, number>;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
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
  path: string,
  params: Record<string, string>,
): Promise<MetaApiResponse<T>> {
  const accessToken = getRequiredEnv(
    "META_SYSTEM_USER_ACCESS_TOKEN",
  );
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

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  const payload =
    (await response.json()) as MetaApiResponse<T>;

  if (!response.ok || payload.error) {
    const code = payload.error?.code ?? response.status;
    const message =
      payload.error?.message ??
      "Meta Marketing API 호출에 실패했습니다.";

    throw new Error(`Meta API 오류 ${code}: ${message}`);
  }

  return payload;
}

export async function listAssignedMetaAdAccounts(): Promise<
  MetaAdAccount[]
> {
  const accounts: MetaAdAccount[] = [];
  let after: string | undefined;

  for (
    let page = 0;
    page < MAX_META_PAGES;
    page += 1
  ) {
    const params: Record<string, string> = {
      fields: [
        "id",
        "account_id",
        "name",
        "account_status",
        "disable_reason",
        "currency",
        "timezone_name",
      ].join(","),
      limit: "100",
    };

    if (after) {
      params.after = after;
    }

    const payload = await metaGet<MetaAdAccount>(
      "me/adaccounts",
      params,
    );

    accounts.push(...(payload.data ?? []));

    const nextAfter = payload.paging?.cursors?.after;

    if (!payload.paging?.next || !nextAfter) {
      break;
    }

    after = nextAfter;
  }

  return accounts;
}

function normalizeAccountName(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "");
}

export async function findMetaAdAccount(
  accountQuery: string,
): Promise<MetaAdAccount> {
  const query = normalizeAccountName(accountQuery);

  if (!query) {
    throw new Error("광고계정 이름을 입력해 주세요.");
  }

  const accounts = await listAssignedMetaAdAccounts();

  const exactMatches = accounts.filter(
    (account) =>
      normalizeAccountName(account.name ?? "") === query ||
      account.account_id === accountQuery ||
      account.id === accountQuery,
  );

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  const partialMatches = accounts.filter((account) =>
    normalizeAccountName(account.name ?? "").includes(query),
  );

  if (partialMatches.length === 1) {
    return partialMatches[0];
  }

  if (partialMatches.length > 1) {
    const candidates = partialMatches
      .slice(0, 5)
      .map((account) => account.name ?? "이름 없는 광고계정")
      .join(", ");

    throw new Error(
      `광고계정 이름이 모호합니다. 다음 중 하나를 더 정확히 입력해 주세요: ${candidates}`,
    );
  }

  throw new Error(
    `"${accountQuery}"에 해당하는 광고계정을 찾지 못했습니다.`,
  );
}

function validateDate(value: string, label: string): void {
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

function toNumber(value: string | undefined): number {
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

    result[metric.action_type] = toNumber(metric.value);
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

  const account = await findMetaAdAccount(
    input.accountQuery,
  );

  const payload = await metaGet<MetaInsightRow>(
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

  return {
    accountName:
      row?.account_name ??
      account.name ??
      "이름 없는 광고계정",
    currency: account.currency,
    timezone: account.timezone_name,
    dateStart: row?.date_start ?? input.since,
    dateStop: row?.date_stop ?? input.until,
    metrics: {
      impressions: toNumber(row?.impressions),
      reach: toNumber(row?.reach),
      clicks: toNumber(row?.clicks),
      spend: toNumber(row?.spend),
      ctr: toNumber(row?.ctr),
      cpc: toNumber(row?.cpc),
      cpm: toNumber(row?.cpm),
      frequency: toNumber(row?.frequency),
    },
    actions: toMetricMap(row?.actions),
    actionValues: toMetricMap(row?.action_values),
  };
}