import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

function source(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function assertIncludes(path, value) {
  if (!source(path).includes(value)) {
    throw new Error(`${path} must include ${value}`);
  }
}

function assertBefore(path, first, second) {
  const content = source(path);
  const firstIndex = content.indexOf(first);
  const secondIndex = content.indexOf(second);

  if (firstIndex < 0 || secondIndex < 0 || firstIndex > secondIndex) {
    throw new Error(`${path} must check ${first} before ${second}`);
  }
}

const protectedPages = [
  "src/app/page.tsx",
  "src/app/assistant/page.tsx",
  "src/app/meta-access-check/page.tsx",
  "src/app/mcp-account-governance/page.tsx",
];

for (const path of protectedPages) {
  assertIncludes(path, "getOperatorSession");
  assertIncludes(path, 'redirect("/sign-in")');
}

assertBefore("src/app/page.tsx", "const session = await getOperatorSession()", "const initialData = await getDashboardAccounts()");
assertBefore("src/app/api/dashboard/accounts/route.ts", "const session = await getOperatorSession()", "const payload = await getDashboardAccounts()");
assertBefore("src/app/assistant/actions.ts", "const session = await getOperatorSession()", "const result = await runMetaAssistant");
assertBefore("src/app/api/auth/meta/login/route.ts", "const session = await getOperatorSession()", "const appId = getRequiredEnv");
assertBefore("src/app/api/auth/meta/inventory/login/route.ts", "const session = await getOperatorSession()", "const { authorizationUrl, state } = await createMetaInventoryAuthorizationRequest");
assertBefore("src/app/api/auth/meta/inventory/callback/route.ts", "const session = await getOperatorSession()", "const inspected = await inspectMetaPersonalAccessWithAccountIds");
assertIncludes("src/proxy.ts", "OPERATOR_SESSION_COOKIE");
assertIncludes("src/proxy.ts", '"/meta-access-check/:path*"');
assertIncludes("src/lib/operator-auth.ts", "timingSafeEqual");
assertIncludes("src/lib/operator-auth.ts", "code_challenge_method");
assertIncludes("src/lib/operator-auth.ts", "createRemoteJWKSet");
assertIncludes("src/lib/operator-auth.ts", "httpOnly: true");
assertIncludes("docs/META_ADS_INTEGRATION.md", "NASMEDIA_ENTRA_TENANT_ID");
assertIncludes("src/lib/meta-marketing.ts", 'import "server-only"');
assertIncludes("src/lib/meta-marketing.ts", "resolveMetaSystemUserConnections");
assertIncludes("src/lib/meta-marketing.ts", 'new MetaMarketingError("topology")');
assertIncludes("src/lib/meta-marketing.ts", "MAX_CONCURRENT_META_SYSTEM_USER_READS = 4");
assertIncludes("src/lib/meta-marketing.ts", "mapWithBoundedConcurrency");
assertIncludes("src/lib/meta-marketing.ts", "getRoutedMetaAdAccountsForConnection");
assertIncludes("src/lib/meta-connection-registry.ts", "MAX_META_ASSET_ASSIGNMENTS_PER_SYSTEM_USER = 300");
assertIncludes("src/lib/meta-connection-registry.ts", "META_SYSTEM_USER_CONNECTIONS_JSON");
assertIncludes("docs/META_ADS_INTEGRATION.md", "META_SYSTEM_USER_CONNECTIONS_JSON");
assertIncludes("src/lib/meta-personal-access-inventory.ts", '"me/adaccounts"');
assertIncludes("src/lib/meta-personal-access-inventory.ts", 'method: "GET"');
assertIncludes("src/lib/meta-personal-access-inventory.ts", "appsecret_proof");
assertIncludes("src/lib/meta-personal-access-inventory.ts", ".setSubject(operatorSubject)");

console.log("Operator authentication boundary contract passed.");
