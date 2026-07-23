import type { MetaAccountStatus } from "@/lib/meta-account-status";

export function StatusBadge({ status }: { status: MetaAccountStatus }) {
  return <span className={`status-badge status-${status.tone}`}>{status.label}</span>;
}
