import { redirect } from "next/navigation";

import { AssistantClient } from "@/components/assistant/assistant-client";
import { getOperatorSession } from "@/lib/operator-auth";

export const dynamic = "force-dynamic";

export default async function AssistantPage() {
  const session = await getOperatorSession();

  if (!session) {
    redirect("/sign-in");
  }

  return (
    <main className="app-shell page-content">
      <div className="page-heading compact-heading">
        <p className="eyebrow">AI ANALYSIS WORKSPACE</p>
        <h1>광고 성과를 검증 가능한 데이터로 질문하세요.</h1>
      </div>
      <AssistantClient />
    </main>
  );
}
