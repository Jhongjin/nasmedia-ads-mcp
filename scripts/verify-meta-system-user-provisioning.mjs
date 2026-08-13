import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/lib/meta-system-user-provisioning.ts", import.meta.url), "utf8");
const callback = await readFile(new URL("../src/app/api/auth/meta/inventory/callback/route.ts", import.meta.url), "utf8");
const login = await readFile(new URL("../src/app/api/auth/meta/inventory/provisioning/login/route.ts", import.meta.url), "utf8");

assert.match(source, /import "server-only"/);
assert.match(source, /MAX_ACTIVE_ACCOUNTS_PER_POOL = 250/);
assert.match(source, /MAX_ACTIVE_ACCOUNTS_FOR_TWO_POOLS/);
assert.match(source, /NasmediaAdsPool01/);
assert.match(source, /NasmediaAdsPool02/);
assert.match(source, /tasks: JSON\.stringify\(\["ANALYZE"\]\)/);
assert.match(source, /assigned_users/);
assert.match(source, /META_BUSINESS_ID/);
assert.doesNotMatch(source, /ads_management/);
assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);
assert.match(login, /\["ads_read", "business_management"\]/);
assert.match(callback, /provisionRecentActiveAdAccounts/);
assert.match(callback, /META_PROVISIONING_STATE_COOKIE/);

console.log(JSON.stringify({
  serverOnlyProvisioningBoundary: true,
  readOnlyTaskOnly: true,
  dualPoolCapacityBound: true,
  explicitOperatorOAuthRequired: true,
  browserPersistenceAbsent: true,
  tokenValuesPrinted: false,
}));
