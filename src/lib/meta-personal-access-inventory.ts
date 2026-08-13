import "server-only";

import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";

export const META_GRAPH_VERSION = "v25.0";
const META_OAUTH_STATE_SECONDS = 10 * 60;
const META_INVENTORY_RESULT_SECONDS = 15 * 60;
const META_TIMEOUT_MS = 15_000;
const META_INVENTORY_PAGE_SIZE = 100;
const MAX_META_INVENTORY_PAGES = 50;
const META_INVENTORY_ISSUER = "nasmedia-ads-mcp";
const META_INVENTORY_RESULT_AUDIENCE = "nasmedia-meta-inventory-result";

export const META_INVENTORY_STATE_COOKIE = "nasmedia_meta_inventory_state";
export const META_INVENTORY_RESULT_COOKIE = "nasmedia_meta_inventory_result";
export const META_PROVISIONING_STATE_COOKIE = "nasmedia_meta_provisioning_state";

export type MetaProvisioningResult = {
  status: "completed" | "failed" | "partial";
  candidateAccountCount: number;
  poolOneAssignedAccountCount: number;
  poolTwoAssignedAccountCount: number;
  failureCategory?: "configuration" | "permission" | "network" | "upstream";
  failureStage?:
    | "active_account_scan"
    | "permission_check"
    | "pool_configuration"
    | "pool_validation"
    | "assignment_inventory"
    | "capacity_check"
    | "pool_one_assignment"
    | "pool_two_assignment";
};

export type MetaInventoryConfiguration = {
  appId: string;
  appSecret: string;
  loginConfigId: string;
  redirectUri: string;
  stateSecret: string;
  sessionSecret: string;
};

type MetaTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: unknown;
};

type MetaPermissionsResponse = {
  data?: Array<{
    permission?: string;
    status?: string;
  }>;
  error?: unknown;
};

type MetaAdAccountsResponse = {
  data?: Array<{
    id?: string;
  }>;
  paging?: {
    cursors?: {
      after?: string;
    };
    next?: string;
  };
  error?: unknown;
};

type MetaInventoryPayload = JWTPayload & {
  result?: MetaPersonalAccessInventory;
};

export type MetaPersonalAccessInventory = {
  status: "completed" | "failed";
  category?: "configuration" | "authentication" | "permission" | "network" | "upstream";
  accessibleAdAccountCount?: number;
  accountListTruncated?: boolean;
  grantedPermissions?: {
    adsRead: boolean;
    adsManagement: boolean;
    businessManagement: boolean;
  };
  tokenExpiry: "under_one_day" | "under_seven_days" | "seven_days_or_more" | "unknown";
  recentSpendFilter?: {
    status: "completed" | "failed";
    windowStart: string;
    windowEnd: string;
    totalAccountCount: number;
    activeAccountCount: number;
    inactiveAccountCount: number;
    unknownAccountCount: number;
    failureCategory?: "configuration" | "permission" | "network" | "upstream" | "storage";
  };
  provisioning?: MetaProvisioningResult;
};

export class MetaPersonalAccessInventoryError extends Error {
  constructor(
    public readonly category:
      | "configuration"
      | "authentication"
      | "permission"
      | "network"
      | "upstream",
  ) {
    super(category);
    this.name = "MetaPersonalAccessInventoryError";
  }
}

function getConfiguration(): MetaInventoryConfiguration | null {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  const loginConfigId = process.env.META_LOGIN_CONFIG_ID?.trim();
  const redirectUri = (
    process.env.META_OAUTH_REDIRECT_URI ??
    process.env.META_REDIRECT_URI
  )?.trim();
  const stateSecret = process.env.META_OAUTH_STATE_SECRET;
  const sessionSecret = process.env.NASMEDIA_SESSION_SECRET;

  if (!appId || !appSecret || !loginConfigId || !redirectUri || !stateSecret || !sessionSecret) {
    return null;
  }

  try {
    const parsedRedirectUri = new URL(redirectUri);
    const allowedProtocol =
      parsedRedirectUri.protocol === "https:" ||
      (process.env.NODE_ENV !== "production" && parsedRedirectUri.protocol === "http:");

    if (!allowedProtocol || parsedRedirectUri.pathname !== "/api/auth/meta/inventory/callback") {
      return null;
    }
  } catch {
    return null;
  }

  return {
    appId,
    appSecret,
    loginConfigId,
    redirectUri,
    stateSecret,
    sessionSecret,
  };
}

function requireConfiguration(): MetaInventoryConfiguration {
  const configuration = getConfiguration();

  if (!configuration) {
    throw new MetaPersonalAccessInventoryError("configuration");
  }

  return configuration;
}

function safelyEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function createStateValue(operatorSubject: string, stateSecret: string): string {
  const nonce = randomBytes(32).toString("base64url");
  const signature = createHmac("sha256", stateSecret)
    .update(`${nonce}.${operatorSubject}`)
    .digest("base64url");

  return `${nonce}.${signature}`;
}

function validateStateValue(
  receivedState: string,
  storedState: string,
  operatorSubject: string,
  stateSecret: string,
): boolean {
  if (!safelyEquals(receivedState, storedState)) {
    return false;
  }

  const [nonce, signature, unexpectedPart] = receivedState.split(".");

  if (!nonce || !signature || unexpectedPart) {
    return false;
  }

  const expectedSignature = createHmac("sha256", stateSecret)
    .update(`${nonce}.${operatorSubject}`)
    .digest("base64url");

  return safelyEquals(signature, expectedSignature);
}

function getCookieOptions(maxAge: number, path: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path,
    maxAge,
  };
}

export function createMetaAppSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret)
    .update(accessToken)
    .digest("hex");
}

function toTokenExpiry(expiresIn: number | undefined): MetaPersonalAccessInventory["tokenExpiry"] {
  if (!Number.isFinite(expiresIn) || !expiresIn || expiresIn <= 0) {
    return "unknown";
  }

  if (expiresIn < 24 * 60 * 60) {
    return "under_one_day";
  }

  if (expiresIn < 7 * 24 * 60 * 60) {
    return "under_seven_days";
  }

  return "seven_days_or_more";
}

function toErrorCategory(response: Response): MetaPersonalAccessInventoryError["category"] {
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    return "permission";
  }

  return "upstream";
}

async function exchangeAuthorizationCode(code: string, configuration: MetaInventoryConfiguration): Promise<{
  accessToken: string;
  expiresIn?: number;
}> {
  let response: Response;
  let payload: MetaTokenResponse;

  try {
    response = await fetch(
      `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: configuration.appId,
          client_secret: configuration.appSecret,
          redirect_uri: configuration.redirectUri,
          code,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(META_TIMEOUT_MS),
      },
    );
    payload = (await response.json()) as MetaTokenResponse;
  } catch {
    throw new MetaPersonalAccessInventoryError("network");
  }

  if (!response.ok || !payload.access_token || payload.error) {
    throw new MetaPersonalAccessInventoryError(toErrorCategory(response));
  }

  return {
    accessToken: payload.access_token,
    expiresIn: payload.expires_in,
  };
}

async function metaGet<T>(
  path: string,
  accessToken: string,
  appSecret: string,
  parameters: Record<string, string>,
): Promise<T> {
  const url = new URL(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${path.replace(/^\/+/, "")}`,
  );

  for (const [name, value] of Object.entries(parameters)) {
    url.searchParams.set(name, value);
  }

  url.searchParams.set("appsecret_proof", createMetaAppSecretProof(accessToken, appSecret));

  let response: Response;
  let payload: T & { error?: unknown };

  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(META_TIMEOUT_MS),
    });
    payload = (await response.json()) as T & { error?: unknown };
  } catch {
    throw new MetaPersonalAccessInventoryError("network");
  }

  if (!response.ok || payload.error) {
    throw new MetaPersonalAccessInventoryError(toErrorCategory(response));
  }

  return payload;
}

async function listMetaPersonalAdAccountIds(
  accessToken: string,
  configuration: MetaInventoryConfiguration,
): Promise<{ accountIds: string[]; accountListTruncated: boolean }> {
  const accessibleAdAccountIds = new Set<string>();
  let after: string | undefined;
  let accountListTruncated = false;

  for (let page = 0; page < MAX_META_INVENTORY_PAGES; page += 1) {
    const parameters: Record<string, string> = {
      fields: "id",
      limit: String(META_INVENTORY_PAGE_SIZE),
    };

    if (after) {
      parameters.after = after;
    }

    const accounts = await metaGet<MetaAdAccountsResponse>(
      "me/adaccounts",
      accessToken,
      configuration.appSecret,
      parameters,
    );

    for (const account of accounts.data ?? []) {
      if (account.id) {
        accessibleAdAccountIds.add(account.id);
      }
    }

    const nextAfter = accounts.paging?.cursors?.after;

    if (!accounts.paging?.next || !nextAfter) {
      break;
    }

    after = nextAfter;

    if (page === MAX_META_INVENTORY_PAGES - 1) {
      accountListTruncated = true;
    }
  }

  return {
    accountIds: [...accessibleAdAccountIds],
    accountListTruncated,
  };
}

async function collectMetaPersonalAccess(
  accessToken: string,
  expiresIn: number | undefined,
  configuration: MetaInventoryConfiguration,
): Promise<{ inventory: MetaPersonalAccessInventory; accountIds: string[] }> {
  const permissions = await metaGet<MetaPermissionsResponse>(
    "me/permissions",
    accessToken,
    configuration.appSecret,
    {},
  );
  const granted = new Set(
    (permissions.data ?? [])
      .filter((permission) => permission.status === "granted")
      .map((permission) => permission.permission),
  );
  const { accountIds, accountListTruncated } = await listMetaPersonalAdAccountIds(accessToken, configuration);

  return {
    inventory: {
      status: "completed",
      accessibleAdAccountCount: accountIds.length,
      accountListTruncated,
      grantedPermissions: {
        adsRead: granted.has("ads_read"),
        adsManagement: granted.has("ads_management"),
        businessManagement: granted.has("business_management"),
      },
      tokenExpiry: toTokenExpiry(expiresIn),
    },
    accountIds,
  };
}

export function getMetaInventoryStateCookieOptions() {
  return getCookieOptions(META_OAUTH_STATE_SECONDS, "/api/auth/meta/inventory/callback");
}

export function getMetaProvisioningStateCookieOptions() {
  return getCookieOptions(META_OAUTH_STATE_SECONDS, "/api/auth/meta/inventory/callback");
}

export function getMetaInventoryResultCookieOptions() {
  return getCookieOptions(META_INVENTORY_RESULT_SECONDS, "/");
}

export function getExpiredMetaInventoryStateCookieOptions() {
  return { ...getMetaInventoryStateCookieOptions(), maxAge: 0, expires: new Date(0) };
}

export function getExpiredMetaProvisioningStateCookieOptions() {
  return { ...getMetaProvisioningStateCookieOptions(), maxAge: 0, expires: new Date(0) };
}

export async function createMetaInventoryAuthorizationRequest(
  operatorSubject: string,
  requestedScopes: readonly ("ads_read" | "business_management")[] = [],
  loginConfigIdOverride?: string,
  redirectUriOverride?: string,
  responseType: "code" | "token" = "code",
): Promise<{
  authorizationUrl: URL;
  state: string;
}> {
  const configuration = requireConfiguration();
  const redirectUri = redirectUriOverride?.trim() || configuration.redirectUri;

  try {
    const parsedRedirectUri = new URL(redirectUri);

    if (parsedRedirectUri.protocol !== "https:") {
      throw new Error("invalid redirect URI");
    }
  } catch {
    throw new MetaPersonalAccessInventoryError("configuration");
  }

  const state = createStateValue(operatorSubject, configuration.stateSecret);
  const authorizationUrl = new URL(`https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`);

  authorizationUrl.searchParams.set("client_id", configuration.appId);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  authorizationUrl.searchParams.set("config_id", loginConfigIdOverride?.trim() || configuration.loginConfigId);
  authorizationUrl.searchParams.set("response_type", responseType);

  if (responseType === "code") {
    authorizationUrl.searchParams.set("override_default_response_type", "true");
  }

  authorizationUrl.searchParams.set("state", state);

  const scopes = [...new Set(requestedScopes)].sort();

  if (scopes.length > 0) {
    authorizationUrl.searchParams.set("scope", scopes.join(","));
  }

  return { authorizationUrl, state };
}

export async function inspectMetaPersonalAccess(input: {
  code: string;
  returnedState: string;
  storedState: string;
  operatorSubject: string;
}): Promise<MetaPersonalAccessInventory> {
  const configuration = requireConfiguration();

  if (!validateStateValue(input.returnedState, input.storedState, input.operatorSubject, configuration.stateSecret)) {
    throw new MetaPersonalAccessInventoryError("authentication");
  }

  const { accessToken, expiresIn } = await exchangeAuthorizationCode(input.code, configuration);

  const collected = await collectMetaPersonalAccess(accessToken, expiresIn, configuration);

  return collected.inventory;
}

export async function inspectMetaPersonalAccessWithAccountIds(input: {
  code: string;
  returnedState: string;
  storedState: string;
  operatorSubject: string;
}): Promise<{ inventory: MetaPersonalAccessInventory; accountIds: string[]; accessToken: string; appSecret: string }> {
  const configuration = requireConfiguration();

  if (!validateStateValue(input.returnedState, input.storedState, input.operatorSubject, configuration.stateSecret)) {
    throw new MetaPersonalAccessInventoryError("authentication");
  }

  const { accessToken, expiresIn } = await exchangeAuthorizationCode(input.code, configuration);
  const collected = await collectMetaPersonalAccess(accessToken, expiresIn, configuration);

  return {
    inventory: collected.inventory,
    accountIds: collected.accountIds,
    accessToken,
    appSecret: configuration.appSecret,
  };
}

/**
 * Completes the user-token Business Login variation used only for a one-time
 * asset-assignment request. The token is accepted by a server route, kept in
 * memory for the request, and is never added to a cookie, log, or response.
 */
export async function inspectMetaPersonalAccessTokenWithAccountIds(input: {
  accessToken: string;
  expiresIn?: number;
  returnedState: string;
  storedState: string;
  operatorSubject: string;
}): Promise<{ inventory: MetaPersonalAccessInventory; accountIds: string[]; accessToken: string; appSecret: string }> {
  const configuration = requireConfiguration();
  const accessToken = input.accessToken.trim();

  if (!accessToken || accessToken.length > 4_096) {
    throw new MetaPersonalAccessInventoryError("authentication");
  }

  if (!validateStateValue(input.returnedState, input.storedState, input.operatorSubject, configuration.stateSecret)) {
    throw new MetaPersonalAccessInventoryError("authentication");
  }

  const collected = await collectMetaPersonalAccess(accessToken, input.expiresIn, configuration);

  return {
    inventory: collected.inventory,
    accountIds: collected.accountIds,
    accessToken,
    appSecret: configuration.appSecret,
  };
}

export async function createMetaInventoryResultCookieValue(
  result: MetaPersonalAccessInventory,
  operatorSubject: string,
): Promise<string> {
  const configuration = requireConfiguration();

  return new SignJWT({ result })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(META_INVENTORY_ISSUER)
    .setAudience(META_INVENTORY_RESULT_AUDIENCE)
    .setSubject(operatorSubject)
    .setIssuedAt()
    .setExpirationTime(`${META_INVENTORY_RESULT_SECONDS}s`)
    .sign(new TextEncoder().encode(configuration.sessionSecret));
}

export async function readMetaInventoryResultCookieValue(
  value: string | undefined,
  operatorSubject: string,
): Promise<MetaPersonalAccessInventory | null> {
  if (!value) {
    return null;
  }

  const configuration = getConfiguration();

  if (!configuration) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(value, new TextEncoder().encode(configuration.sessionSecret), {
      algorithms: ["HS256"],
      issuer: META_INVENTORY_ISSUER,
      audience: META_INVENTORY_RESULT_AUDIENCE,
    });
    const result = (payload as MetaInventoryPayload).result;

    if (
      !result ||
      !payload.sub ||
      !safelyEquals(payload.sub, operatorSubject) ||
      (result.status !== "completed" && result.status !== "failed")
    ) {
      return null;
    }

    return result;
  } catch {
    return null;
  }
}

export function failedMetaInventoryResult(
  category: MetaPersonalAccessInventoryError["category"],
): MetaPersonalAccessInventory {
  return {
    status: "failed",
    category,
    tokenExpiry: "unknown",
  };
}
