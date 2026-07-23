import Link from "next/link";

type AppHeaderProps = {
  operatorName?: string;
};

export function AppHeader({ operatorName }: AppHeaderProps) {
  const hasSession = Boolean(operatorName);

  return (
    <header className="app-header">
      <div className="app-shell header-content">
        <Link className="brand" href="/" aria-label="Meta Ads Service 대시보드">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>Meta Ads Service</span>
          <span className="nasmedia-badge">Nasmedia</span>
        </Link>
        <nav className="main-nav" aria-label="주요 메뉴">
          <Link href="/">대시보드</Link>
          <Link href="/assistant">AI 어시스턴트</Link>
        </nav>
        <div className="operator-area">
          <span className="operator-name">{operatorName ?? "운영자 인증 연동 필요"}</span>
          <button className="logout-button" type="button" disabled={!hasSession} title={hasSession ? "세션 로그아웃 연동 필요" : "인증 세션이 연결되지 않았습니다."}>
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}
