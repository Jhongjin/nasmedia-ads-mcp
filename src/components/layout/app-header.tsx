import Link from "next/link";

type AppHeaderProps = {
  isAuthenticated: boolean;
};

export function AppHeader({ isAuthenticated }: AppHeaderProps) {

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
          <Link href="/meta-access-check">권한 점검</Link>
          <Link href="/mcp-account-governance">MCP 계정 관리</Link>
        </nav>
        <div className="operator-area">
          <span className="operator-name">{isAuthenticated ? "운영자 인증됨" : "운영자 로그인 필요"}</span>
          {isAuthenticated ? (
            <form action="/api/auth/entra/logout" method="post">
              <button className="logout-button" type="submit">로그아웃</button>
            </form>
          ) : null}
        </div>
      </div>
    </header>
  );
}
