import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const pagePath = fileURLToPath(new URL(
  "../src/app/mcp-account-governance/readiness/page.tsx",
  import.meta.url,
));
const source = await readFile(pagePath, "utf8");

const requiredSnippets = [
  "getOperatorSession",
  "getMetaSystemUserTopologySummary",
  "getMetaMcpAccountPolicyLedger",
  "getMetaMcpPolicyAdministrationReadiness",
  "MetaConnectionConfigurationError",
  'export const dynamic = "force-dynamic"',
];

for (const snippet of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(`Readiness page must include ${snippet}.`);
  }
}

const prohibitedSnippets = [
  "getDashboardAccounts",
  "getAssignedMetaAdAccounts",
  "fetch(",
  "META_SYSTEM_USER_CONNECTIONS_JSON",
  "META_SYSTEM_USER_ACCESS_TOKEN",
  "accessToken",
  "accountId",
];

for (const snippet of prohibitedSnippets) {
  if (source.includes(snippet)) {
    throw new Error(`Readiness page must not expose or query ${snippet}.`);
  }
}

console.log("Meta MCP readiness page boundary verified.");
