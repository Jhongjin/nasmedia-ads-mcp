"use client";

import { useActionState } from "react";

import { askAssistant, type AssistantActionState } from "@/app/assistant/actions";

const initialState: AssistantActionState = {};

const examples = [
  "현재 접근 가능한 광고계정 현황을 요약해 주세요.",
  "지난주 A 광고계정의 광고비와 CTR을 알려 주세요.",
  "이번 달 성과를 보려면 어떤 계정과 기간 정보가 필요한가요?",
];

export function AssistantClient() {
  const [state, formAction, isPending] = useActionState(askAssistant, initialState);

  return (
    <div className="assistant-layout">
      <section className="assistant-card">
        <div className="assistant-eyebrow">READ-ONLY ANALYSIS</div>
        <h1>Meta Ads AI 어시스턴트</h1>
        <p>OpenRouter를 통해 Meta Marketing API의 조회 전용 도구를 사용합니다. 캠페인 생성, 수정, 중지는 지원하지 않습니다.</p>
        <form action={formAction} className="assistant-form">
          <label htmlFor="assistant-prompt">분석 질문</label>
          <textarea id="assistant-prompt" name="prompt" required maxLength={2000} placeholder="예: 2026-07-01부터 2026-07-07까지 A 계정의 광고비와 CTR을 알려 주세요." rows={6} />
          <button type="submit" className="primary-button" disabled={isPending}>{isPending ? "Meta 데이터를 조회하는 중…" : "질문하기"}</button>
        </form>
        <section className="example-prompts" aria-labelledby="example-prompts-heading">
          <h2 id="example-prompts-heading">예시 질문</h2>
          <ul>{examples.map((example) => <li key={example}>{example}</li>)}</ul>
        </section>
      </section>
      <section className="answer-card" aria-live="polite" aria-busy={isPending}>
        <p className="answer-label">응답</p>
        {isPending ? <div className="answer-loading"><span className="loading-dot" />도구 결과를 확인하고 있습니다.</div> : null}
        {state.error ? <div className="assistant-error" role="alert">{state.error}</div> : null}
        {state.answer ? <div className="assistant-answer">{state.answer}</div> : null}
        {!isPending && !state.answer && !state.error ? <p className="answer-placeholder">질문을 입력하면 계정 및 기간 정보를 확인한 뒤, 검증 가능한 Meta 조회 결과만으로 답변합니다.</p> : null}
      </section>
    </div>
  );
}
