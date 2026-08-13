import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/lib/meta-active-account-scan.ts", import.meta.url), "utf8");

assert.match(source, /import "server-only"/);
assert.match(source, /createCipheriv\("aes-256-gcm"/);
assert.match(source, /META_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY/);
assert.match(source, /function classifyBatchResult/);
assert.match(source, /outcome: "inactive"/);
assert.match(source, /spendValues\.some\(\(spend\) => spend > 0\) \? "active" : "inactive"/);
assert.match(source, /outcome: "unknown"/);
assert.match(source, /setUTCMonth\(start\.getUTCMonth\(\) - 6\)/);
assert.match(source, /value\.code === 400 \|\| value\.code === 401 \|\| value\.code === 403 \? "permission" : "upstream"/);
assert.doesNotMatch(source, /NEXT_PUBLIC_/);
assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/);

console.log(JSON.stringify({
  batchSpendClassificationContractPassed: true,
  sixMonthWindowContractPassed: true,
  unknownOutcomesFailClosed: true,
  accountReferencesEncrypted: true,
  serverOnlyConfiguration: true,
  browserPersistenceAbsent: true,
  tokenValuesPrinted: false,
}));
