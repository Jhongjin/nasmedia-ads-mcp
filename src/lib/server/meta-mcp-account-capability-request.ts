import "server-only";

import {
  evaluateMetaMcpAccountPolicyGate,
  type MetaMcpAccountPolicyGateInput,
} from "@/lib/meta-mcp-account-policy-gate";

/**
 * Shared preflight for the future account-aware Compass, Sentinel, and
 * Foresight surfaces. This is deliberately not a Meta client: it makes no
 * provider request and returns no account identifier, credential, or provider
 * payload.
 */
export type MetaMcpAccountConsumer = "compass" | "sentinel" | "foresight";

export type MetaMcpReadIntent =
  | "campaign_structure"
  | "delivery_and_performance"
  | "setup_and_troubleshooting";

export type MetaMcpAccountCapabilityRequest = Readonly<{
  /** Internal server routing key. It must never cross into a browser payload. */
  accountId: string;
  consumer: MetaMcpAccountConsumer;
  readIntent: MetaMcpReadIntent;
  operatorAuthorized: boolean;
  accountScopeAuthorized: boolean;
  policyGate: MetaMcpAccountPolicyGateInput;
}>;

export type MetaMcpAccountCapabilityPreflight =
  | Readonly<{
      status: "allow";
      consumer: MetaMcpAccountConsumer;
      readIntent: MetaMcpReadIntent;
      requestedCapability: "analysis_read";
      providerCallAllowed: true;
      campaignMutationAllowed: false;
      responseContract: "sanitized_account_analysis_only";
    }>
  | Readonly<{
      status: "deny";
      code:
        | "invalid_account_scope"
        | "operator_not_authorized"
        | "account_scope_not_authorized"
        | "policy_ledger_not_configured"
        | "policy_audit_not_durable"
        | "account_policy_not_enabled"
        | "campaign_write_not_approved";
      providerCallAllowed: false;
      campaignMutationAllowed: false;
    }>;

/**
 * Checks caller authorization and the central policy gate before a future
 * provider adapter resolves an account. It intentionally has no fallback to a
 * personal administrator session or an unconfigured system-user connection.
 */
export function preflightMetaMcpAccountCapability(
  request: MetaMcpAccountCapabilityRequest,
): MetaMcpAccountCapabilityPreflight {
  if (!request.accountId.trim()) {
    return Object.freeze({
      status: "deny" as const,
      code: "invalid_account_scope" as const,
      providerCallAllowed: false,
      campaignMutationAllowed: false,
    });
  }

  if (!request.operatorAuthorized) {
    return Object.freeze({
      status: "deny" as const,
      code: "operator_not_authorized" as const,
      providerCallAllowed: false,
      campaignMutationAllowed: false,
    });
  }

  if (!request.accountScopeAuthorized) {
    return Object.freeze({
      status: "deny" as const,
      code: "account_scope_not_authorized" as const,
      providerCallAllowed: false,
      campaignMutationAllowed: false,
    });
  }

  const policyDecision = evaluateMetaMcpAccountPolicyGate({
    ...request.policyGate,
    requestedCapability: "analysis_read",
  });

  if (policyDecision.status === "deny") {
    return Object.freeze({
      status: "deny" as const,
      code: policyDecision.code,
      providerCallAllowed: false,
      campaignMutationAllowed: false,
    });
  }

  return Object.freeze({
    status: "allow" as const,
    consumer: request.consumer,
    readIntent: request.readIntent,
    requestedCapability: "analysis_read" as const,
    providerCallAllowed: true,
    campaignMutationAllowed: false,
    responseContract: "sanitized_account_analysis_only" as const,
  });
}
