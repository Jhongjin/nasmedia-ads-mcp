import { formatMetaAmountSpent } from "@/lib/meta-money";
import type { MetaAccountStatus } from "@/lib/meta-account-status";

import { StatusBadge } from "./status-badge";

export type DashboardAccount = {
  id: string;
  name: string;
  business: { id: string | null; name: string };
  status: MetaAccountStatus;
  currency: string | null;
  amountSpent?: string;
};

export function AccountTable({ accounts, isLoading }: { accounts: DashboardAccount[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="table-skeleton" role="status" aria-label="광고계정 목록을 불러오는 중">
        <span /><span /><span /><span />
      </div>
    );
  }

  return (
    <div className="table-scroll" tabIndex={0} aria-label="광고계정 목록 가로 스크롤 영역">
      <table className="accounts-table">
        <caption className="sr-only">Meta Marketing API에서 조회한 접근 가능한 광고계정</caption>
        <thead>
          <tr><th scope="col">계정명</th><th scope="col">계정 ID</th><th scope="col">비즈니스</th><th scope="col">상태</th><th scope="col">통화</th><th scope="col">누적 지출</th></tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id}>
              <th scope="row">{account.name}</th>
              <td className="account-id">{account.id}</td>
              <td>{account.business.name}</td>
              <td><StatusBadge status={account.status} /></td>
              <td>{account.currency ?? "-"}</td>
              <td className="amount-cell">{formatMetaAmountSpent(account.amountSpent, account.currency ?? undefined)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
