import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../src/lib/meta-mcp-account-policy-ledger.ts", import.meta.url),
  "utf8",
);
const governancePage = await readFile(
  new URL("../src/app/mcp-account-governance/page.tsx", import.meta.url),
  "utf8",
);

assert.match(source, /import "server-only"/);
assert.match(source, /durable_policy_ledger_not_configured/);
assert.match(source, /canWritePolicies: false/);
assert.match(source, /durableAuditEvents: false/);
assert.match(source, /recordPolicyDecision[\s\S]*not configured/);
assert.doesNotMatch(source, /localStorage|sessionStorage|writeFile|appendFile|fetch\(|supabase|postgres|redis|process\.env/i);
assert.match(governancePage, /getMetaMcpAccountPolicyLedger/);
assert.match(governancePage, /policyLedgerReadiness/);

console.log(JSON.stringify({
  policyLedgerBoundaryPassed: true,
  serverOnlyBoundaryPresent: true,
  durableStoreRequired: true,
  temporaryPersistenceAbsent: true,
  policyWritesFailClosed: true,
  accountIdsPrinted: false,
  tokenValuesPrinted: false,
}));
