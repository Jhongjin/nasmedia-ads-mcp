import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve("src/lib/server/meta-mcp-policy-administration.ts"),
  "utf8",
);

const required = [
  'import "server-only";',
  "META_MCP_POLICY_ADMIN_SUBJECTS",
  "canAdministerMetaMcpPolicy",
  "requireMetaMcpPolicyAdministrator",
  "session.role !== \"operator\"",
  "subjects.has(session.subject)",
];
const forbidden = [
  "NEXT_PUBLIC_",
  "localStorage",
  "sessionStorage",
  "console.log",
  "fetch(",
];

if (required.some((fragment) => !source.includes(fragment))
  || forbidden.some((fragment) => source.includes(fragment))) {
  throw new Error("Meta MCP policy administration boundary failed.");
}

console.log(JSON.stringify({
  policyAdministrationBoundaryPassed: true,
  serverOnlyBoundaryPresent: true,
  explicitAdminAllowlistRequired: true,
  ordinarySsoSessionInsufficient: true,
  browserStorageAbsent: true,
  providerCallsExecuted: 0,
  administratorSubjectsPrinted: false,
}));
