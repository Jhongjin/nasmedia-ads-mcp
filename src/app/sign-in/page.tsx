import Link from "next/link";

import { isEntraAuthConfigured } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

export default function SignInPage() {
  const isConfigured = isEntraAuthConfigured();

  return (
    <main className="app-shell page-content sign-in-page">
      <section className="sign-in-card" aria-labelledby="sign-in-title">
        <p className="eyebrow">INTERNAL ACCESS</p>
        <h1 id="sign-in-title">회사 계정으로 인증</h1>
        <p>Meta 광고계정과 분석 도구는 Nasmedia 회사 SSO 인증이 완료된 운영자만 사용할 수 있습니다.</p>
        {isConfigured ? (
          <Link className="primary-button sign-in-button" href="/api/auth/entra/login">
            Microsoft 회사 계정으로 계속
          </Link>
        ) : (
          <p className="feedback-panel feedback-configuration" role="alert">
            회사 SSO 설정이 아직 완료되지 않았습니다. 운영자에게 Entra 앱 설정을 요청해 주세요.
          </p>
        )}
      </section>
    </main>
  );
}
