import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";

import { SignJWT } from "jose";

const port = 3105;
const origin = `http://127.0.0.1:${port}`;
const testSessionSecret = "test-only-session-secret-for-local-auth-boundary-check-20260729";
const environment = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  NASMEDIA_SESSION_SECRET: testSessionSecret,
  NASMEDIA_ENTRA_TENANT_ID: "test-tenant",
  NASMEDIA_ENTRA_CLIENT_ID: "test-client",
  NASMEDIA_ENTRA_CLIENT_SECRET: "test-client-secret",
  NASMEDIA_APP_ORIGIN: origin,
  NASMEDIA_ALLOWED_ENTRA_SUBJECTS: "11111111-2222-3333-4444-555555555555",
};

delete environment.NASMEDIA_ALLOWED_EMAIL_DOMAIN;

delete environment.META_SYSTEM_USER_ACCESS_TOKEN;
delete environment.META_APP_ID;
delete environment.META_APP_SECRET;
delete environment.META_LOGIN_CONFIG_ID;
delete environment.META_REDIRECT_URI;
delete environment.META_OAUTH_REDIRECT_URI;
delete environment.META_OAUTH_STATE_SECRET;
delete environment.OPENROUTER_API_KEY;
delete environment.OPENROUTER_MODEL;

const server = spawn(process.execPath, [
  resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next"),
  "dev",
  "--hostname",
  "127.0.0.1",
  "--port",
  String(port),
], {
  cwd: process.cwd(),
  env: environment,
  stdio: "ignore",
  windowsHide: true,
});

async function waitForServer() {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    try {
      const response = await fetch(`${origin}/sign-in`, { redirect: "manual" });

      if (response.status === 200) {
        return;
      }
    } catch {
      // The development server is still compiling.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Local authentication verification server did not become ready.");
}

async function createTestSession() {
  const key = new TextEncoder().encode(testSessionSecret);

  return new SignJWT({ tid: "test-tenant", role: "operator" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("nasmedia-ads-mcp")
    .setAudience("nasmedia-ads-mcp")
    .setSubject("test-subject")
    .setIssuedAt()
    .setExpirationTime("8h")
    .sign(key);
}

try {
  await waitForServer();

  const anonymousApi = await fetch(`${origin}/api/dashboard/accounts`, {
    redirect: "manual",
  });
  const anonymousPage = await fetch(`${origin}/`, { redirect: "manual" });
  const anonymousInventoryPage = await fetch(`${origin}/meta-access-check`, { redirect: "manual" });
  const anonymousInventoryLogin = await fetch(`${origin}/api/auth/meta/inventory/login`, { redirect: "manual" });
  const sessionToken = await createTestSession();
  const authenticatedApi = await fetch(`${origin}/api/dashboard/accounts`, {
    headers: { Cookie: `nasmedia_operator_session=${sessionToken}` },
    redirect: "manual",
  });
  const authenticatedInventoryLogin = await fetch(`${origin}/api/auth/meta/inventory/login`, {
    headers: { Cookie: `nasmedia_operator_session=${sessionToken}` },
    redirect: "manual",
  });

  if (anonymousApi.status !== 401) {
    throw new Error("Anonymous dashboard API request was not rejected.");
  }

  if (anonymousPage.status < 300 || anonymousPage.status >= 400 || !anonymousPage.headers.get("location")?.startsWith("/sign-in")) {
    throw new Error("Anonymous dashboard page request was not redirected to sign-in.");
  }

  if (anonymousInventoryPage.status < 300 || anonymousInventoryPage.status >= 400 || !anonymousInventoryPage.headers.get("location")?.startsWith("/sign-in")) {
    throw new Error("Anonymous Meta access-check page request was not redirected to sign-in.");
  }

  if (anonymousInventoryLogin.status !== 401) {
    throw new Error("Anonymous Meta access-check initializer was not rejected.");
  }

  if (authenticatedApi.status !== 503) {
    throw new Error("A valid test session did not reach the expected Meta configuration boundary.");
  }

  if (authenticatedInventoryLogin.status !== 503) {
    throw new Error("A valid test session did not reach the expected Meta inventory configuration boundary.");
  }

  console.log(JSON.stringify({
    anonymousApiHttpStatus: anonymousApi.status,
    anonymousApiMetaReadExecuted: false,
    anonymousPageRedirectedToSignIn: true,
    anonymousInventoryPageRedirectedToSignIn: true,
    anonymousInventoryLoginHttpStatus: anonymousInventoryLogin.status,
    signedSessionApiHttpStatus: authenticatedApi.status,
    signedSessionReachedMetaConfigurationBoundary: true,
    signedSessionInventoryLoginHttpStatus: authenticatedInventoryLogin.status,
    signedSessionInventoryReachedMetaConfigurationBoundary: true,
    rawProviderDataPrinted: false,
    sessionValuePrinted: false,
  }));
} finally {
  if (!server.killed) {
    server.kill();
    await once(server, "close");
  }
}
