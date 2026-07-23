export type MetaAccountStatus = {
  code: number | null;
  label: string;
  tone: "active" | "warning" | "neutral" | "danger";
};

const STATUS_BY_CODE: Record<number, Omit<MetaAccountStatus, "code">> = {
  1: { label: "ACTIVE", tone: "active" },
  2: { label: "DISABLED", tone: "danger" },
  3: { label: "UNSETTLED", tone: "warning" },
  7: { label: "PENDING_RISK_REVIEW", tone: "warning" },
  8: { label: "PENDING_SETTLEMENT", tone: "warning" },
  9: { label: "IN_GRACE_PERIOD", tone: "warning" },
  100: { label: "PENDING_CLOSURE", tone: "neutral" },
  101: { label: "CLOSED", tone: "danger" },
  201: { label: "ANY_ACTIVE", tone: "active" },
  202: { label: "ANY_CLOSED", tone: "neutral" },
};

export function getMetaAccountStatus(
  code: number | undefined,
): MetaAccountStatus {
  if (typeof code !== "number") {
    return { code: null, label: "UNKNOWN", tone: "neutral" };
  }

  const known = STATUS_BY_CODE[code];

  return known
    ? { code, ...known }
    : { code, label: `UNKNOWN(${code})`, tone: "neutral" };
}
