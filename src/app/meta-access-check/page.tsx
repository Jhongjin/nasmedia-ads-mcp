import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  META_INVENTORY_RESULT_COOKIE,
  readMetaInventoryResultCookieValue,
  type MetaPersonalAccessInventory,
} from "@/lib/meta-personal-access-inventory";
import { getOperatorSession } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

function statusLabel(result: MetaPersonalAccessInventory | null): string {
  if (!result) {
    return "아직 점검 결과가 없습니다.";
  }

  return result.status === "completed" ? "읽기 전용 점검이 완료되었습니다." : "점검을 완료하지 못했습니다.";
}

function categoryLabel(category: MetaPersonalAccessInventory["category"]): string {
  switch (category) {
    case "authentication":
      return "Meta 로그인 또는 세션 확인이 필요합니다.";
    case "permission":
      return "필요한 Meta 권한을 확인할 수 없습니다.";
    case "network":
      return "Meta 연결을 확인하지 못했습니다.";
    case "upstream":
      return "Meta 응답을 확인하지 못했습니다.";
    case "configuration":
      return "점검 연결 설정이 아직 완료되지 않았습니다.";
    default:
      return "다시 점검을 시작해 주세요.";
  }
}

function expiryLabel(value: MetaPersonalAccessInventory["tokenExpiry"]): string {
  switch (value) {
    case "under_one_day":
      return "1일 미만";
    case "under_seven_days":
      return "1일 이상 7일 미만";
    case "seven_days_or_more":
      return "7일 이상";
    default:
      return "확인 불가";
  }
}

export default async function MetaAccessCheckPage() {
  const session = await getOperatorSession();

  if (!session) {
    redirect("/sign-in");
  }

  const resultCookie = (await cookies()).get(META_INVENTORY_RESULT_COOKIE)?.value;
  const result = await readMetaInventoryResultCookieValue(resultCookie, session.subject);

  return (
    <main className="app-shell page-content">
      <section className="page-heading">
        <p className="eyebrow">PERSONAL ADMIN ACCESS · READ ONLY</p>
        <h1>개인 관리자 계정 접근 범위 점검</h1>
        <p>
          개인 Meta 관리자 계정은 여기서 장기 서비스 자격증명으로 저장하지 않습니다. 이 점검은 접근 가능한 광고계정 수와 권한 충족 여부만 확인합니다.
        </p>
      </section>

      <section className="access-check-card" aria-live="polite">
        <div className="access-check-heading">
          <div>
            <p className="access-check-label">현재 상태</p>
            <h2>{statusLabel(result)}</h2>
          </div>
          <a className="primary-button access-check-button" href="/api/auth/meta/inventory/login">
            개인 관리자 계정으로 읽기 전용 점검 시작
          </a>
        </div>

        {result?.status === "completed" ? (
          <div className="access-check-grid">
            <article>
              <p>접근 가능한 광고계정</p>
              <strong>{result.accessibleAdAccountCount?.toLocaleString("ko-KR") ?? "확인 불가"}</strong>
              <span>{result.accountListTruncated ? "5,000개 안전 상한에 도달해 전체 수가 아닐 수 있습니다." : "계정 이름·ID는 저장하거나 표시하지 않습니다."}</span>
            </article>
            <article>
              <p>필수 읽기 권한</p>
              <strong>{result.grantedPermissions?.adsRead ? "충족" : "미충족"}</strong>
              <span>ads_read 권한 기준</span>
            </article>
            <article>
              <p>운영 권한</p>
              <strong>{result.grantedPermissions?.adsManagement ? "확인됨" : "미확인"}</strong>
              <span>ads_management 권한 기준</span>
            </article>
            <article>
              <p>권한 관리 범위</p>
              <strong>{result.grantedPermissions?.businessManagement ? "확인됨" : "미확인"}</strong>
              <span>business_management 권한 기준</span>
            </article>
            <article>
              <p>이번 OAuth 토큰 만료 구간</p>
              <strong>{expiryLabel(result.tokenExpiry)}</strong>
              <span>토큰 값과 만료 시각은 저장하거나 표시하지 않습니다.</span>
            </article>
          </div>
        ) : result ? (
          <p className="access-check-message">{categoryLabel(result.category)}</p>
        ) : (
          <p className="access-check-message">
            시작하면 Meta가 발급한 일회성 코드로 읽기 요청만 수행합니다. 광고계정 목록, 토큰, 성과 데이터는 이 화면에 남기지 않습니다.
          </p>
        )}
      </section>

      <section className="access-check-guardrails">
        <h2>이 점검에서 하지 않는 일</h2>
        <ul>
          <li>캠페인·광고·예산·권한·자산을 생성하거나 변경하지 않습니다.</li>
          <li>개인 관리자 계정의 토큰, 광고계정 이름 또는 광고계정 ID를 저장하거나 화면에 표시하지 않습니다.</li>
          <li>결과는 현재 회사 SSO 사용자에게만 15분 동안 표시됩니다.</li>
        </ul>
      </section>
    </main>
  );
}
