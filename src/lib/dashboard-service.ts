import { getMetaAccountStatus } from "@/lib/meta-account-status";
import { getAssignedMetaAdAccounts, MetaMarketingError } from "@/lib/meta-marketing";

export type DashboardApiError = {
  ok: false;
  category:
    | "configuration"
    | "permission"
    | "network"
    | "upstream"
    | "topology";
  error: string;
};

export type DashboardApiSuccess = {
  ok: true;
  accounts: Array<{
    id: string;
    name: string;
    business: { id: string | null; name: string };
    status: ReturnType<typeof getMetaAccountStatus>;
    currency: string | null;
    amountSpent?: string;
  }>;
  fetchedAt: string;
  truncated: boolean;
};

export type DashboardApiResponse = DashboardApiSuccess | DashboardApiError;

export async function getDashboardAccounts(): Promise<DashboardApiResponse> {
  try {
    const { accounts, truncated } = await getAssignedMetaAdAccounts();
    return {
      ok: true,
      accounts: accounts.map((account) => ({
        id: account.account_id ?? account.id.replace(/^act_/, ""),
        name: account.name ?? "이름 없는 광고계정",
        business: {
          id: account.business?.id ?? null,
          name: account.business?.name ?? "비즈니스 정보 없음",
        },
        status: getMetaAccountStatus(account.account_status),
        currency: account.currency ?? null,
        amountSpent: account.amount_spent,
      })),
      fetchedAt: new Date().toISOString(),
      truncated,
    };
  } catch (error) {
    const category = error instanceof MetaMarketingError ? error.category : "upstream";
    const messages = {
      configuration: "Meta 연결 설정이 완료되지 않았습니다.",
      permission: "광고계정 조회 권한이 없거나 토큰을 확인할 수 없습니다.",
      network: "Meta API에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      upstream: "Meta API가 계정 목록을 반환하지 못했습니다.",
      topology: "광고계정 연결 구성이 안전 기준을 충족하지 않습니다. 운영자에게 시스템 사용자 자산 배정을 확인해 달라고 요청해 주세요.",
    } as const;
    if (category === "upstream") {
      console.error("Meta dashboard account list failed.");
    }
    return { ok: false, category, error: messages[category] };
  }
}
