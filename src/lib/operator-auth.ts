import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import {
  createRemoteJWKSet,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";
import { cookies } from "next/headers";

import { OPERATOR_SESSION_COOKIE } from "@/lib/operator-auth-constants";

const SESSION_ISSUER = "nasmedia-ads-mcp";
const SESSION_AUDIENCE = "nasmedia-ads-mcp";
const OAUTH_STATE_AUDIENCE = "nasmedia-ads-mcp-entra-state";
const OPERATOR_SESSION_SECONDS = 8 * 60 * 60;
const OAUTH_STATE_SECONDS = 10 * 60;

type EntraConfiguration = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  appOrigin: string;
  allowedEmailDomain: string | null;
  allowedSubjectIds: ReadonlySet<string>;
  sessionSecret: string;
};

type OAuthState = {
  state: string;
  nonce: string;
  codeVerifier: string;
};

export type OperatorSession = {
  subject: string;
  tenantId: string;
  role: "operator";
};

export class OperatorAuthError extends Error {
  constructor(
    public readonly category: "configuration" | "authentication" | "authorization" | "upstream",
  ) {
    super(category);
    this.name = "OperatorAuthError";
  }
}

function getEntraConfiguration(): EntraConfiguration | null {
  const tenantId = process.env.NASMEDIA_ENTRA_TENANT_ID?.trim();
  const clientId = process.env.NASMEDIA_ENTRA_CLIENT_ID?.trim();
  const clientSecret = process.env.NASMEDIA_ENTRA_CLIENT_SECRET?.trim();
  const appOrigin = process.env.NASMEDIA_APP_ORIGIN?.trim();
  const allowedEmailDomain = process.env.NASMEDIA_ALLOWED_EMAIL_DOMAIN
    ?.trim()
    .toLocaleLowerCase("en-US");
  const allowedSubjectIds = parseAllowedSubjectIds(process.env.NASMEDIA_ALLOWED_ENTRA_SUBJECTS);
  const sessionSecret = process.env.NASMEDIA_SESSION_SECRET;

  if (
    !tenantId ||
    !clientId ||
    !clientSecret ||
    !appOrigin ||
    !allowedSubjectIds ||
    (!allowedEmailDomain && allowedSubjectIds.size === 0) ||
    !sessionSecret
  ) {
    return null;
  }

  try {
    const parsedOrigin = new URL(appOrigin);
    const isAllowedProtocol =
      parsedOrigin.protocol === "https:" ||
      (process.env.NODE_ENV !== "production" && parsedOrigin.protocol === "http:");

    if (!isAllowedProtocol || parsedOrigin.origin !== appOrigin) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    appOrigin,
    allowedEmailDomain: allowedEmailDomain || null,
    allowedSubjectIds,
    sessionSecret,
  };
}

function parseAllowedSubjectIds(value: string | undefined): ReadonlySet<string> | null {
  if (!value?.trim()) {
    return new Set();
  }

  const subjectIds = value
    .split(",")
    .map((subjectId) => subjectId.trim().toLocaleLowerCase("en-US"))
    .filter(Boolean);

  if (
    subjectIds.length === 0 ||
    subjectIds.some((subjectId) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId))
  ) {
    return null;
  }

  return new Set(subjectIds);
}

function getSessionKey(configuration: EntraConfiguration): Uint8Array {
  return new TextEncoder().encode(configuration.sessionSecret);
}

function getCallbackUrl(configuration: EntraConfiguration): string {
  return new URL("/api/auth/entra/callback", configuration.appOrigin).toString();
}

function getCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function getStateCookieOptions(maxAge: number) {
  return {
    ...getCookieOptions(maxAge),
    path: "/api/auth/entra/callback",
  };
}

function createRandomUrlValue(): string {
  return randomBytes(32).toString("base64url");
}

function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

function isSameValue(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);

  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function getStringClaim(payload: JWTPayload, key: string): string | null {
  const value = payload[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

function isAllowedEmail(value: string, allowedDomain: string): boolean {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  const separator = normalized.lastIndexOf("@");

  return separator > 0 && normalized.slice(separator + 1) === allowedDomain;
}

function isAllowedSubject(value: string, allowedSubjectIds: ReadonlySet<string>): boolean {
  const normalized = value.trim().toLocaleLowerCase("en-US");

  return [...allowedSubjectIds].some((allowedSubjectId) => isSameValue(normalized, allowedSubjectId));
}

export function isEntraAuthConfigured(): boolean {
  return getEntraConfiguration() !== null;
}

export function getOperatorSessionCookieName(): string {
  return OPERATOR_SESSION_COOKIE;
}

export async function createEntraAuthorizationRequest(): Promise<{
  authorizationUrl: URL;
  stateCookieValue: string;
}> {
  const configuration = getEntraConfiguration();

  if (!configuration) {
    throw new OperatorAuthError("configuration");
  }

  const state: OAuthState = {
    state: createRandomUrlValue(),
    nonce: createRandomUrlValue(),
    codeVerifier: createRandomUrlValue(),
  };
  const stateCookieValue = await new SignJWT(state)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(OAUTH_STATE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_STATE_SECONDS}s`)
    .sign(getSessionKey(configuration));
  const authorizationUrl = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(configuration.tenantId)}/oauth2/v2.0/authorize`,
  );

  authorizationUrl.searchParams.set("client_id", configuration.clientId);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("redirect_uri", getCallbackUrl(configuration));
  authorizationUrl.searchParams.set("response_mode", "query");
  authorizationUrl.searchParams.set("scope", "openid profile email");
  authorizationUrl.searchParams.set("state", state.state);
  authorizationUrl.searchParams.set("nonce", state.nonce);
  authorizationUrl.searchParams.set("code_challenge", createCodeChallenge(state.codeVerifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return { authorizationUrl, stateCookieValue };
}

export function getEntraStateCookieOptions() {
  return getStateCookieOptions(OAUTH_STATE_SECONDS);
}

export async function exchangeEntraAuthorizationCode(input: {
  code: string;
  returnedState: string | null;
  stateCookieValue: string | undefined;
}): Promise<string> {
  const configuration = getEntraConfiguration();

  if (!configuration) {
    throw new OperatorAuthError("configuration");
  }

  if (!input.returnedState || !input.stateCookieValue) {
    throw new OperatorAuthError("authentication");
  }

  let statePayload: JWTPayload;

  try {
    ({ payload: statePayload } = await jwtVerify(input.stateCookieValue, getSessionKey(configuration), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: OAUTH_STATE_AUDIENCE,
    }));
  } catch {
    throw new OperatorAuthError("authentication");
  }

  const expectedState = getStringClaim(statePayload, "state");
  const nonce = getStringClaim(statePayload, "nonce");
  const codeVerifier = getStringClaim(statePayload, "codeVerifier");

  if (!expectedState || !nonce || !codeVerifier || !isSameValue(expectedState, input.returnedState)) {
    throw new OperatorAuthError("authentication");
  }

  const tokenUrl = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(configuration.tenantId)}/oauth2/v2.0/token`,
  );
  const body = new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: getCallbackUrl(configuration),
    code_verifier: codeVerifier,
  });

  let response: Response;
  let payload: unknown;

  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    payload = await response.json();
  } catch {
    throw new OperatorAuthError("upstream");
  }

  if (!response.ok || !payload || typeof payload !== "object" || !("id_token" in payload) || typeof payload.id_token !== "string") {
    throw new OperatorAuthError("authentication");
  }

  const issuer = `https://login.microsoftonline.com/${configuration.tenantId}/v2.0`;
  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${encodeURIComponent(configuration.tenantId)}/discovery/v2.0/keys`),
  );
  let idTokenPayload: JWTPayload;

  try {
    ({ payload: idTokenPayload } = await jwtVerify(payload.id_token, jwks, {
      algorithms: ["RS256"],
      audience: configuration.clientId,
      issuer,
    }));
  } catch {
    throw new OperatorAuthError("authentication");
  }

  const tokenNonce = getStringClaim(idTokenPayload, "nonce");
  const tenantId = getStringClaim(idTokenPayload, "tid");
  const subject = getStringClaim(idTokenPayload, "oid") ?? getStringClaim(idTokenPayload, "sub");
  const accountName = getStringClaim(idTokenPayload, "preferred_username") ?? getStringClaim(idTokenPayload, "email");
  const isSubjectAllowlistMode = configuration.allowedSubjectIds.size > 0;
  const isAuthorizedOperator = isSubjectAllowlistMode
    ? subject && isAllowedSubject(subject, configuration.allowedSubjectIds)
    : accountName && configuration.allowedEmailDomain && isAllowedEmail(accountName, configuration.allowedEmailDomain);

  if (
    !tokenNonce ||
    !tenantId ||
    !subject ||
    !isSameValue(tokenNonce, nonce) ||
    !isSameValue(tenantId, configuration.tenantId) ||
    !isAuthorizedOperator
  ) {
    throw new OperatorAuthError("authorization");
  }

  return new SignJWT({ tid: tenantId, role: "operator" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime(`${OPERATOR_SESSION_SECONDS}s`)
    .sign(getSessionKey(configuration));
}

export function getOperatorSessionCookieOptions() {
  return getCookieOptions(OPERATOR_SESSION_SECONDS);
}

export function getExpiredOperatorSessionCookieOptions() {
  return { ...getCookieOptions(0), expires: new Date(0) };
}

export async function getOperatorSession(): Promise<OperatorSession | null> {
  const configuration = getEntraConfiguration();

  if (!configuration) {
    return null;
  }

  const sessionToken = (await cookies()).get(OPERATOR_SESSION_COOKIE)?.value;

  if (!sessionToken) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(sessionToken, getSessionKey(configuration), {
      algorithms: ["HS256"],
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
    const subject = payload.sub;
    const tenantId = getStringClaim(payload, "tid");
    const role = getStringClaim(payload, "role");

    if (!subject || !tenantId || role !== "operator" || !isSameValue(tenantId, configuration.tenantId)) {
      return null;
    }

    return { subject, tenantId, role: "operator" };
  } catch {
    return null;
  }
}
