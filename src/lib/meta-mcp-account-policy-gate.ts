import type {
  MetaMcpAccountPolicyState,
} from "@/lib/meta-mcp-account-governance";

/**
 * This is the capability check that a future account-scoped Meta MCP tool must
 * call before it resolves a Meta account or calls a provider. It is pure: it
 * neither reads an account, writes a policy, nor makes a Meta request.
 */
export type MetaMcpRequestedCapability = "analysis_read" | "campaign_write";

export type MetaMcpAccountPolicyGateInput = Readonly<{
  policyLedgerStatus: "unconfigured" | "available";
  policyLedgerCanRead: boolean;
  durableAuditEvents: boolean;
  accountPolicy: MetaMcpAccountPolicyState | null;
  requestedCapability: MetaMcpRequestedCapability;
}>;

export type MetaMcpAccountPolicyGateDecision =
  | Readonly<{
      status: "allow";
      capability: "analysis_read";
      providerCallAllowed: true;
      campaignMutationAllowed: false;
    }>
  | Readonly<{
      status: "deny";
      code:
        | "policy_ledger_not_configured"
        | "policy_audit_not_durable"
        | "account_policy_not_enabled"
        | "campaign_write_not_approved";
      providerCallAllowed: false;
      campaignMutationAllowed: false;
    }>;

export function evaluateMetaMcpAccountPolicyGate(
  input: MetaMcpAccountPolicyGateInput,
): MetaMcpAccountPolicyGateDecision {
  if (input.requestedCapability === "campaign_write") {
    return Object.freeze({
      status: "deny" as const,
      code: "campaign_write_not_approved" as const,
      providerCallAllowed: false,
      campaignMutationAllowed: false,
    });
  }

  if (input.policyLedgerStatus !== "available" || !input.policyLedgerCanRead) {
    return Object.freeze({
      status: "deny" as const,
      code: "policy_ledger_not_configured" as const,
      providerCallAllowed: false,
      campaignMutationAllowed: false,
    });
  }

  if (!input.durableAuditEvents) {
    return Object.freeze({
      status: "deny" as const,
      code: "policy_audit_not_durable" as const,
      providerCallAllowed: false,
      campaignMutationAllowed: false,
    });
  }

  if (input.accountPolicy !== "enabled") {
    return Object.freeze({
      status: "deny" as const,
      code: "account_policy_not_enabled" as const,
      providerCallAllowed: false,
      campaignMutationAllowed: false,
    });
  }

  return Object.freeze({
    status: "allow" as const,
    capability: "analysis_read" as const,
    providerCallAllowed: true,
    campaignMutationAllowed: false,
  });
}
