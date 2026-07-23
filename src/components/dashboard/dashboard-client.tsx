"use client";

import { useCallback, useMemo, useState } from "react";

import { AccountFilters } from "./account-filters";
import { AccountTable, type DashboardAccount } from "./account-table";
import { KpiCard } from "./kpi-card";

const PAGE_SIZE = 25;

type DashboardResponse =
  | { ok: true; accounts: DashboardAccount[]; fetchedAt: string; truncated: boolean }
  | { ok: false; category: "configuration" | "permission" | "network" | "upstream"; error: string };

export function DashboardClient({ initialData }: { initialData: DashboardResponse }) {
  const [accounts, setAccounts] = useState<DashboardAccount[]>(initialData.ok ? initialData.accounts : []);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [business, setBusiness] = useState("");
  const [page, setPage] = useState(1);
  const [fetchedAt, setFetchedAt] = useState<string | null>(initialData.ok ? initialData.fetchedAt : null);
  const [truncated, setTruncated] = useState(initialData.ok ? initialData.truncated : false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Extract<DashboardResponse, { ok: false }> | null>(initialData.ok ? null : initialData);

  const loadAccounts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/dashboard/accounts", { cache: "no-store" });
      const payload = (await response.json()) as DashboardResponse;
      if (!response.ok || !payload.ok) {
        setError(payload.ok ? { ok: false, category: "upstream", error: "계정 목록을 불러오지 못했습니다." } : payload);
        return;
      }
      setAccounts(payload.accounts);
      setFetchedAt(payload.fetchedAt);
      setTruncated(payload.truncated);
    } catch {
      setError({ ok: false, category: "network", error: "네트워크 연결을 확인한 뒤 다시 시도해 주세요." });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const statuses = useMemo(() => [...new Set(accounts.map((account) => account.status.label))].sort(), [accounts]);
  const businesses = useMemo(() => [...new Set(accounts.map((account) => account.business.name))].sort((a, b) => a.localeCompare(b, "ko-KR")), [accounts]);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return accounts.filter((account) => (
      (!normalizedQuery || account.name.toLocaleLowerCase("ko-KR").includes(normalizedQuery) || account.id.includes(normalizedQuery)) &&
      (!status || account.status.label === status) &&
      (!business || account.business.name === business)
    ));
  }, [accounts, business, query, status]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const activeCount = accounts.filter((account) => account.status.code === 1).length;
  const businessCount = new Set(accounts.map((account) => account.business.id ?? account.business.name)).size;

  function changeFilter(update: (value: string) => void) {
    return (value: string) => { update(value); setPage(1); };
  }

  return (
    <div className="dashboard-client">
      <section className="kpi-grid" aria-label="계정 요약">
        <KpiCard label="전체 계정" value={accounts.length.toLocaleString("ko-KR")} detail="접근 가능한 광고계정" />
        <KpiCard label="활성 계정" value={activeCount.toLocaleString("ko-KR")} detail="ACTIVE 상태 기준" tone="green" />
        <KpiCard label="고유 비즈니스 수" value={businessCount.toLocaleString("ko-KR")} detail="계정에 연결된 비즈니스" tone="slate" />
      </section>
      <AccountFilters query={query} status={status} business={business} statuses={statuses} businesses={businesses} count={filtered.length} isLoading={isLoading} fetchedAt={fetchedAt} onQueryChange={changeFilter(setQuery)} onStatusChange={changeFilter(setStatus)} onBusinessChange={changeFilter(setBusiness)} onRefresh={() => void loadAccounts()} />
      {error ? <section className={`feedback-panel feedback-${error.category}`} role="alert"><strong>{error.category === "permission" ? "권한 확인 필요" : error.category === "network" ? "네트워크 오류" : "조회 오류"}</strong><p>{error.error}</p><button type="button" onClick={() => void loadAccounts()}>다시 시도</button></section> : null}
      {!isLoading && !error && filtered.length === 0 ? <section className="empty-panel"><strong>조건에 맞는 광고계정이 없습니다.</strong><p>검색어와 상태 또는 비즈니스 필터를 조정해 보세요.</p></section> : null}
      {!error && (isLoading || filtered.length > 0) ? <section className="table-panel"><AccountTable accounts={paginated} isLoading={isLoading} />{truncated ? <p className="truncation-note">안전 상한에 도달해 일부 계정이 표시되지 않을 수 있습니다. 운영자에게 페이지 상한 조정을 요청하세요.</p> : null}</section> : null}
      {!isLoading && !error && filtered.length > PAGE_SIZE ? <nav className="pagination" aria-label="계정 목록 페이지"><button type="button" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>이전</button><span>{page} / {pageCount}</span><button type="button" disabled={page === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>다음</button></nav> : null}
    </div>
  );
}
