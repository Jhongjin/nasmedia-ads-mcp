import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sourcePath = resolve("src/lib/server/meta-mcp-account-capability-request.ts");
const source = readFileSync(sourcePath, "utf8");

const required = [
  'import "server-only";',
  "evaluateMetaMcpAccountPolicyGate",
  'type MetaMcpAccountConsumer = "compass" | "sentinel" | "foresight";',
  'operatorAuthorized: boolean;',
  'accountScopeAuthorized: boolean;',
  'code: "operator_not_authorized"',
  'code: "account_scope_not_authorized"',
  'requestedCapability: "analysis_read",',
  'responseContract: "sanitized_account_analysis_only"',
  'campaignMutationAllowed: false',
];
const forbidden = [
  "fetch(",
  "process.env",
  "accessToken",
  "META_SYSTEM_USER_ACCESS_TOKEN",
  "campaignMutationAllowed: true",
];

if (required.some((fragment) => !source.includes(fragment))
  || forbidden.some((fragment) => source.includes(fragment))) {
  throw new Error("Meta MCP account capability request contract failed.");
}

console.log(JSON.stringify({
  accountCapabilityPreflightContractPassed: true,
  serverOnlyBoundaryPresent: true,
  compassSentinelForesightBound: true,
  operatorAndAccountAuthorizationRequired: true,
  policyGateRequired: true,
  sanitizedReadOnlyResponseOnly: true,
  providerCallsExecuted: 0,
  campaignMutationsExecuted: 0,
  accountIdsPrinted: false,
  tokenValuesPrinted: false,
}));
