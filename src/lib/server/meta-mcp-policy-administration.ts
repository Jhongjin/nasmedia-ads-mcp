import "server-only";

import type { OperatorSession } from "@/lib/operator-auth";

const SUBJECT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/;
const MAX_POLICY_ADMINS = 32;

export type MetaMcpPolicyAdministrationReadiness = Readonly<{
  status: "configured" | "unconfigured" | "invalid";
  canChangePolicy: boolean;
}>;

function parsePolicyAdminSubjects(
  environment: Readonly<Record<string, string | undefined>>,
): ReadonlySet<string> | null {
  const raw = environment.META_MCP_POLICY_ADMIN_SUBJECTS?.trim();

  if (!raw) return new Set();

  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);

  if (
    values.length === 0
    || values.length > MAX_POLICY_ADMINS
    || values.some((value) => !SUBJECT_PATTERN.test(value))
    || new Set(values).size !== values.length
  ) {
    return null;
  }

  return new Set(values);
}

/**
 * Future policy writes require an explicit Entra subject allowlist. A company
 * SSO session alone never grants account-policy administration rights.
 */
export function getMetaMcpPolicyAdministrationReadiness(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): MetaMcpPolicyAdministrationReadiness {
  const subjects = parsePolicyAdminSubjects(environment);

  if (subjects === null) {
    return Object.freeze({ status: "invalid", canChangePolicy: false });
  }

  if (subjects.size === 0) {
    return Object.freeze({ status: "unconfigured", canChangePolicy: false });
  }

  return Object.freeze({ status: "configured", canChangePolicy: true });
}

export function canAdministerMetaMcpPolicy(
  session: OperatorSession | null,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (!session || session.role !== "operator") return false;

  const subjects = parsePolicyAdminSubjects(environment);
  return Boolean(subjects && subjects.has(session.subject));
}

/**
 * Call this before every future ledger write. Do not use it to reveal the
 * configured subject list or as a substitute for account-scope authorization.
 */
export function requireMetaMcpPolicyAdministrator(
  session: OperatorSession | null,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (!canAdministerMetaMcpPolicy(session, environment)) {
    throw new Error("Meta MCP policy administration is not authorized.");
  }
}
