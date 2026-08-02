import assert from "node:assert/strict";

import { evaluateMetaMcpAccountPolicyGate } from "../src/lib/meta-mcp-account-policy-gate.ts";

const unconfigured = evaluateMetaMcpAccountPolicyGate({
  policyLedgerStatus: "unconfigured",
  policyLedgerCanRead: false,
  durableAuditEvents: false,
  accountPolicy: "enabled",
  requestedCapability: "analysis_read",
});
assert.deepEqual(unconfigured, {
  status: "deny",
  code: "policy_ledger_not_configured",
  providerCallAllowed: false,
  campaignMutationAllowed: false,
});

const disabled = evaluateMetaMcpAccountPolicyGate({
  policyLedgerStatus: "available",
  policyLedgerCanRead: true,
  durableAuditEvents: true,
  accountPolicy: "disabled",
  requestedCapability: "analysis_read",
});
assert.equal(disabled.status, "deny");
assert.equal(disabled.code, "account_policy_not_enabled");

const noAudit = evaluateMetaMcpAccountPolicyGate({
  policyLedgerStatus: "available",
  policyLedgerCanRead: true,
  durableAuditEvents: false,
  accountPolicy: "enabled",
  requestedCapability: "analysis_read",
});
assert.equal(noAudit.status, "deny");
assert.equal(noAudit.code, "policy_audit_not_durable");

const readOnly = evaluateMetaMcpAccountPolicyGate({
  policyLedgerStatus: "available",
  policyLedgerCanRead: true,
  durableAuditEvents: true,
  accountPolicy: "enabled",
  requestedCapability: "analysis_read",
});
assert.deepEqual(readOnly, {
  status: "allow",
  capability: "analysis_read",
  providerCallAllowed: true,
  campaignMutationAllowed: false,
});

const campaignWrite = evaluateMetaMcpAccountPolicyGate({
  policyLedgerStatus: "available",
  policyLedgerCanRead: true,
  durableAuditEvents: true,
  accountPolicy: "enabled",
  requestedCapability: "campaign_write",
});
assert.equal(campaignWrite.status, "deny");
assert.equal(campaignWrite.code, "campaign_write_not_approved");

console.log(JSON.stringify({
  policyGatePassed: true,
  noLedgerFailsClosed: true,
  disabledAccountBlocked: true,
  auditRequirementBlocked: true,
  enabledReadOnlyCapabilityAllowed: true,
  campaignWriteBlocked: true,
  providerCallsExecuted: 0,
  accountIdsPrinted: false,
  tokenValuesPrinted: false,
}));
