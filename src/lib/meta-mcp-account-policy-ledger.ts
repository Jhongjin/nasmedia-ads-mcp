import "server-only";

import type {
  MetaMcpAccountPolicyRecord,
  MetaMcpAccountPolicyState,
} from "@/lib/meta-mcp-account-governance";

/**
 * This boundary deliberately has no storage implementation yet. A policy
 * switch is a safety control for future MCP capability use, so a temporary
 * process, browser, file, or environment-backed implementation would make the
 * UI look durable when it is not.
 */
export const META_MCP_POLICY_LEDGER_HOLD_CODE = "durable_policy_ledger_not_configured";

export type MetaMcpAccountPolicyScope = "analysis_read";

export type MetaMcpAccountPolicyDecision = Readonly<{
  /** Server-internal inventory key. Never send this value to the browser. */
  accountId: string;
  state: MetaMcpAccountPolicyState;
  scope: MetaMcpAccountPolicyScope;
  reasonCode: "approved_account" | "revoked" | "review_required" | "incident_hold";
  reviewDueAt: string;
  expectedVersion: number | null;
  operatorSubject: string;
}>;

export type MetaMcpAccountPolicyLedgerReadiness = Readonly<{
  status: "unconfigured";
  code: typeof META_MCP_POLICY_LEDGER_HOLD_CODE;
  canReadPolicies: false;
  canWritePolicies: false;
  durableAuditEvents: false;
}>;

export type MetaMcpAccountPolicyLedger = Readonly<{
  getReadiness: () => MetaMcpAccountPolicyLedgerReadiness;
  listPoliciesForInventory: () => Promise<readonly MetaMcpAccountPolicyRecord[]>;
  recordPolicyDecision: (
    decision: MetaMcpAccountPolicyDecision,
  ) => Promise<never>;
}>;

const holdReadiness: MetaMcpAccountPolicyLedgerReadiness = Object.freeze({
  status: "unconfigured",
  code: META_MCP_POLICY_LEDGER_HOLD_CODE,
  canReadPolicies: false,
  canWritePolicies: false,
  durableAuditEvents: false,
});

/**
 * The application can read a Meta inventory without a policy ledger, but it
 * must treat every account as not configured for MCP use. The eventual adapter
 * must provide a transactionally durable policy table plus immutable audit
 * events before this function is replaced.
 */
export function getMetaMcpAccountPolicyLedger(): MetaMcpAccountPolicyLedger {
  return Object.freeze({
    getReadiness: () => holdReadiness,
    listPoliciesForInventory: async () => Object.freeze([]),
    recordPolicyDecision: async () => {
      throw new Error("Meta MCP policy ledger is not configured.");
    },
  });
}
