import "server-only";

import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import {
  createMetaAppSecretProof,
  META_GRAPH_VERSION,
  type MetaPersonalAccessInventory,
} from "@/lib/meta-personal-access-inventory";

const META_TIMEOUT_MS = 20_000;
const META_BATCH_SIZE = 50;
const META_BATCH_CONCURRENCY = 4;
const DATA_CORE_SCHEMA = "openclaw";
const DATA_CORE_RETENTION_DAYS = 30;

type ScanFailureCategory = "configuration" | "permission" | "network" | "upstream" | "storage";
type ScanOutcome = "active" | "inactive" | "unknown";

type DataCoreConfiguration = {
  url: string;
  serviceRoleKey: string;
  accountIdentifierKey: Buffer;
};

type MetaBatchResponse = Array<{
  code?: number;
  body?: string;
}>;

type MetaBatchOutcome = {
  outcome: ScanOutcome;
  failureCategory: Exclude<ScanFailureCategory, "configuration" | "storage"> | null;
};

export type MetaActiveAccountScanSummary = {
  status: "completed" | "failed";
  windowStart: string;
  windowEnd: string;
  totalAccountCount: number;
  activeAccountCount: number;
  inactiveAccountCount: number;
  unknownAccountCount: number;
  failureCategory?: ScanFailureCategory;
};

export class MetaActiveAccountScanError extends Error {
  readonly category: ScanFailureCategory;

  constructor(category: ScanFailureCategory) {
    super(category);
    this.name = "MetaActiveAccountScanError";
    this.category = category;
  }
}

function getDataCoreConfiguration(): DataCoreConfiguration | null {
  const url = process.env.META_CONTROL_PLANE_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.META_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY?.trim();
  const accountIdentifierKey = decodeKey(process.env.META_ACCOUNT_IDENTIFIER_ENCRYPTION_KEY);

  if (!url || !serviceRoleKey || !accountIdentifierKey) {
    return null;
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co") || parsed.pathname !== "/") {
      return null;
    }
  } catch {
    return null;
  }

  return { url, serviceRoleKey, accountIdentifierKey };
}

function decodeKey(value: string | undefined): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  try {
    const key = Buffer.from(value, "base64url");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function createOperatorSubjectHash(operatorSubject: string): string {
  return createHash("sha256").update(operatorSubject).digest("hex");
}

function createAccountReferenceHash(accountId: string, key: Buffer): string {
  const derivedKey = createHmac("sha256", key)
    .update("nasmedia-meta-account-reference-hash.v1")
    .digest();

  return createHmac("sha256", derivedKey).update(accountId).digest("hex");
}

function encryptAccountReference(accountId: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(accountId, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function spendWindow(now = new Date()): { windowStart: string; windowEnd: string } {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - 6);

  return {
    windowStart: start.toISOString().slice(0, 10),
    windowEnd: end.toISOString().slice(0, 10),
  };
}

function toRetentionExpiry(now = new Date()): string {
  const expiry = new Date(now);
  expiry.setUTCDate(expiry.getUTCDate() + DATA_CORE_RETENTION_DAYS);
  return expiry.toISOString();
}

function toFailureCategory(response: Response): Exclude<ScanFailureCategory, "configuration" | "storage"> {
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    return "permission";
  }

  return "upstream";
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let offset = 0; offset < values.length; offset += size) {
    chunks.push(values.slice(offset, offset + size));
  }

  return chunks;
}

async function requestDataCore<T>(
  configuration: DataCoreConfiguration,
  path: string,
  init: RequestInit,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(new URL(`/rest/v1/${path.replace(/^\/+/, "")}`, configuration.url), {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
      headers: {
        apikey: configuration.serviceRoleKey,
        Authorization: `Bearer ${configuration.serviceRoleKey}`,
        "Content-Type": "application/json",
        "Accept-Profile": DATA_CORE_SCHEMA,
        "Content-Profile": DATA_CORE_SCHEMA,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    console.error("Meta selection ledger request could not reach Data-Core", {
      method: init.method ?? "GET",
      resource: path.split("?", 1)[0],
    });
    throw new MetaActiveAccountScanError("storage");
  }

  if (!response.ok) {
    console.error("Meta selection ledger request was rejected by Data-Core", {
      method: init.method ?? "GET",
      resource: path.split("?", 1)[0],
      status: response.status,
    });
    throw new MetaActiveAccountScanError("storage");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    const responseBody = await response.text();

    if (!responseBody) {
      return undefined as T;
    }

    return JSON.parse(responseBody) as T;
  } catch {
    throw new MetaActiveAccountScanError("storage");
  }
}

async function createRun(input: {
  configuration: DataCoreConfiguration;
  operatorSubjectHash: string;
  windowStart: string;
  windowEnd: string;
}): Promise<string> {
  const rows = await requestDataCore<Array<{ id?: string }>>(
    input.configuration,
    "meta_active_account_scan_runs",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        operator_subject_hash: input.operatorSubjectHash,
        window_start: input.windowStart,
        window_end: input.windowEnd,
        retention_expires_at: toRetentionExpiry(),
      }),
    },
  );
  const id = rows[0]?.id;

  if (!id) {
    throw new MetaActiveAccountScanError("storage");
  }

  return id;
}

async function appendEvent(input: {
  configuration: DataCoreConfiguration;
  runId: string;
  operatorSubjectHash: string;
  eventType: "scan_started" | "scan_completed" | "scan_failed";
  summary: Record<string, string | number | boolean>;
}) {
  await requestDataCore<void>(input.configuration, "meta_active_account_scan_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      run_id: input.runId,
      event_type: input.eventType,
      actor_subject_hash: input.operatorSubjectHash,
      event_summary: input.summary,
    }),
  });
}

async function updateRun(input: {
  configuration: DataCoreConfiguration;
  runId: string;
  body: Record<string, string | number | null>;
}) {
  await requestDataCore<void>(input.configuration, `meta_active_account_scan_runs?id=eq.${encodeURIComponent(input.runId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...input.body, updated_at: new Date().toISOString() }),
  });
}

async function insertItems(input: {
  configuration: DataCoreConfiguration;
  runId: string;
  accountIds: string[];
  outcomes: MetaBatchOutcome[];
}) {
  const rows = input.accountIds.map((accountId, index) => {
    const result = input.outcomes[index];

    return {
      run_id: input.runId,
      account_ref_hash: createAccountReferenceHash(accountId, input.configuration.accountIdentifierKey),
      account_ref_ciphertext: encryptAccountReference(accountId, input.configuration.accountIdentifierKey),
      outcome: result.outcome,
      has_recent_spend: result.outcome === "unknown" ? null : result.outcome === "active",
      failure_category: result.failureCategory,
    };
  });

  for (const itemBatch of chunk(rows, 250)) {
    await requestDataCore<void>(input.configuration, "meta_active_account_scan_items", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(itemBatch),
    });
  }
}

async function scanBatch(input: {
  accountIds: string[];
  accessToken: string;
  appSecret: string;
  windowStart: string;
  windowEnd: string;
}): Promise<MetaBatchOutcome[]> {
  const batch = input.accountIds.map((accountId) => ({
    method: "GET",
    relative_url: `${accountId}/insights?fields=spend&time_range=${encodeURIComponent(JSON.stringify({ since: input.windowStart, until: input.windowEnd }))}&limit=1`,
  }));
  const body = new URLSearchParams({
    access_token: input.accessToken,
    appsecret_proof: createMetaAppSecretProof(input.accessToken, input.appSecret),
    batch: JSON.stringify(batch),
  });
  let response: Response;

  try {
    response = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
  } catch {
    return input.accountIds.map(() => ({ outcome: "unknown", failureCategory: "network" }));
  }

  if (!response.ok) {
    const failureCategory = toFailureCategory(response);
    return input.accountIds.map(() => ({ outcome: "unknown", failureCategory }));
  }

  let payload: MetaBatchResponse;

  try {
    payload = (await response.json()) as MetaBatchResponse;
  } catch {
    return input.accountIds.map(() => ({ outcome: "unknown", failureCategory: "upstream" }));
  }

  return input.accountIds.map((_, index) => classifyBatchResult(payload[index]));
}

function classifyBatchResult(value: MetaBatchResponse[number] | undefined): MetaBatchOutcome {
  if (!value || typeof value.code !== "number" || typeof value.body !== "string") {
    return { outcome: "unknown", failureCategory: "upstream" };
  }

  if (value.code !== 200) {
    return {
      outcome: "unknown",
      failureCategory: value.code === 400 || value.code === 401 || value.code === 403 ? "permission" : "upstream",
    };
  }

  try {
    const payload = JSON.parse(value.body) as { data?: Array<{ spend?: unknown }>; error?: unknown };

    if (payload.error || !Array.isArray(payload.data)) {
      return { outcome: "unknown", failureCategory: "upstream" };
    }

    if (payload.data.length === 0) {
      return { outcome: "inactive", failureCategory: null };
    }

    const spendValues = payload.data.map((row) => Number(row.spend));

    if (spendValues.some((spend) => !Number.isFinite(spend))) {
      return { outcome: "unknown", failureCategory: "upstream" };
    }

    return {
      outcome: spendValues.some((spend) => spend > 0) ? "active" : "inactive",
      failureCategory: null,
    };
  } catch {
    return { outcome: "unknown", failureCategory: "upstream" };
  }
}

export async function runMetaRecentSpendFilter(input: {
  accessToken: string;
  appSecret: string;
  operatorSubject: string;
  accountIds: string[];
  inventory: MetaPersonalAccessInventory;
}): Promise<MetaActiveAccountScanSummary> {
  const { windowStart, windowEnd } = spendWindow();
  const configuration = getDataCoreConfiguration();

  if (!configuration || !input.inventory.grantedPermissions?.adsRead || input.inventory.accountListTruncated) {
    return {
      status: "failed",
      windowStart,
      windowEnd,
      totalAccountCount: input.accountIds.length,
      activeAccountCount: 0,
      inactiveAccountCount: 0,
      unknownAccountCount: input.accountIds.length,
      failureCategory: "configuration",
    };
  }

  const operatorSubjectHash = createOperatorSubjectHash(input.operatorSubject);
  let runId: string | null = null;

  try {
    runId = await createRun({ configuration, operatorSubjectHash, windowStart, windowEnd });
    await appendEvent({
      configuration,
      runId,
      operatorSubjectHash,
      eventType: "scan_started",
      summary: { totalAccountCount: input.accountIds.length, windowStart, windowEnd },
    });

    const outcomes: MetaBatchOutcome[] = [];
    const accountBatches = chunk(input.accountIds, META_BATCH_SIZE);

    for (const batchGroup of chunk(accountBatches, META_BATCH_CONCURRENCY)) {
      const groupedOutcomes = await Promise.all(batchGroup.map((accountBatch) => scanBatch({
        accountIds: accountBatch,
        accessToken: input.accessToken,
        appSecret: input.appSecret,
        windowStart,
        windowEnd,
      })));
      outcomes.push(...groupedOutcomes.flat());
    }

    await insertItems({ configuration, runId, accountIds: input.accountIds, outcomes });

    const activeAccountCount = outcomes.filter((outcome) => outcome.outcome === "active").length;
    const inactiveAccountCount = outcomes.filter((outcome) => outcome.outcome === "inactive").length;
    const unknownAccountCount = outcomes.filter((outcome) => outcome.outcome === "unknown").length;
    const completedAt = new Date().toISOString();

    await updateRun({
      configuration,
      runId,
      body: {
        status: "completed",
        total_account_count: input.accountIds.length,
        processed_account_count: input.accountIds.length,
        active_account_count: activeAccountCount,
        inactive_account_count: inactiveAccountCount,
        unknown_account_count: unknownAccountCount,
        completed_at: completedAt,
      },
    });
    await appendEvent({
      configuration,
      runId,
      operatorSubjectHash,
      eventType: "scan_completed",
      summary: { totalAccountCount: input.accountIds.length, activeAccountCount, inactiveAccountCount, unknownAccountCount },
    });

    return {
      status: "completed",
      windowStart,
      windowEnd,
      totalAccountCount: input.accountIds.length,
      activeAccountCount,
      inactiveAccountCount,
      unknownAccountCount,
    };
  } catch (error) {
    const failureCategory = error instanceof MetaActiveAccountScanError ? error.category : "upstream";

    if (runId) {
      try {
        await updateRun({
          configuration,
          runId,
          body: {
            status: "failed",
            failure_category: failureCategory,
            completed_at: new Date().toISOString(),
          },
        });
        await appendEvent({
          configuration,
          runId,
          operatorSubjectHash,
          eventType: "scan_failed",
          summary: { failureCategory },
        });
      } catch {
        // Preserve the original normalized failure category without exposing storage details.
      }
    }

    return {
      status: "failed",
      windowStart,
      windowEnd,
      totalAccountCount: input.accountIds.length,
      activeAccountCount: 0,
      inactiveAccountCount: 0,
      unknownAccountCount: input.accountIds.length,
      failureCategory,
    };
  }
}

export const metaActiveAccountScanInternals = {
  classifyBatchResult,
  spendWindow,
};
