import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/lib/meta-system-user-provisioning.ts", import.meta.url), "utf8");
const callback = await readFile(new URL("../src/app/api/auth/meta/inventory/callback/route.ts", import.meta.url), "utf8");
const login = await readFile(new URL("../src/app/api/auth/meta/inventory/provisioning/login/route.ts", import.meta.url), "utf8");

assert.match(source, /import "server-only"/);
assert.match(source, /MAX_ACTIVE_ACCOUNTS_PER_POOL = 250/);
assert.match(source, /MAX_ACTIVE_ACCOUNTS_FOR_TWO_POOLS/);
assert.match(source, /chunkAccountIds/);
assert.match(source, /Promise\.all\(chunkAccountIds\(unassigned\)/);
assert.match(source, /NasmediaAdsPool01/);
assert.match(source, /NasmediaAdsPool02/);
assert.match(source, /tasks: JSON\.stringify\(\["ANALYZE"\]\)/);
assert.match(source, /assigned_users/);
assert.match(source, /business: input\.businessId/);
assert.match(source, /assigned_users\?\$\{parameters\.toString\(\)\}/);
assert.match(source, /resolveAppScopedPools/);
assert.match(source, /system_users/);
assert.match(source, /META_BUSINESS_ID/);
assert.match(source, /failureStage/);
assert.doesNotMatch(source, /pool_validation/);
assert.match(source, /pool_one_assignment/);
assert.match(source, /pool_two_assignment/);
assert.match(source, /recordMetaActiveAccountProvisioningOutcome/);
assert.match(source, /getGraphBatchProviderErrorCode/);
assert.match(source, /getGraphBatchProviderErrorReason/);
assert.match(source, /providerErrorCode/);
assert.match(source, /providerErrorReason/);
assert.match(source, /Graph requires this app's scoped IDs/);
assert.doesNotMatch(source, /ads_management/);
assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
assert.match(login, /META_PROVISIONING_LOGIN_CONFIG_ID/);
assert.match(login, /META_PROVISIONING_REDIRECT_URI/);
assert.match(login, /"token"/);
assert.match(login, /"ads_management"/);
assert.match(callback, /provisionRecentActiveAdAccounts/);
assert.match(callback, /META_PROVISIONING_STATE_COOKIE/);

const implicitCompletion = await readFile(
  new URL("../src/app/api/auth/meta/inventory/provisioning/complete/route.ts", import.meta.url),
  "utf8",
);
const implicitCallback = await readFile(
  new URL("../src/app/meta-active-account-connection/meta-provisioning-implicit-callback.tsx", import.meta.url),
  "utf8",
);

assert.match(implicitCompletion, /inspectMetaPersonalAccessTokenWithAccountIds/);
assert.match(implicitCompletion, /META_PROVISIONING_STATE_COOKIE/);
assert.doesNotMatch(implicitCompletion, /console\.(log|error)/);
assert.match(implicitCallback, /window\.history\.replaceState/);
assert.match(implicitCallback, /credentials: "same-origin"/);
assert.doesNotMatch(implicitCallback, /localStorage|sessionStorage|document\.cookie/);
assert.match(
  await readFile(new URL("../src/lib/meta-personal-access-inventory.ts", import.meta.url), "utf8"),
  /result\.status !== "partial"/,
);
assert.match(
  await readFile(new URL("../src/lib/meta-personal-access-inventory.ts", import.meta.url), "utf8"),
  /getCookieOptions\(META_OAUTH_STATE_SECONDS, "\/api\/auth\/meta\/inventory"\)/,
);

console.log(JSON.stringify({
  serverOnlyProvisioningBoundary: true,
  readOnlyTaskOnly: true,
  dualPoolCapacityBound: true,
  explicitOperatorOAuthRequired: true,
  browserPersistenceAbsent: true,
  tokenValuesPrinted: false,
}));
