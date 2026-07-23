type AccountFiltersProps = {
  query: string;
  status: string;
  business: string;
  statuses: string[];
  businesses: string[];
  count: number;
  isLoading: boolean;
  fetchedAt: string | null;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onBusinessChange: (value: string) => void;
  onRefresh: () => void;
};

export function AccountFilters({
  query,
  status,
  business,
  statuses,
  businesses,
  count,
  isLoading,
  fetchedAt,
  onQueryChange,
  onStatusChange,
  onBusinessChange,
  onRefresh,
}: AccountFiltersProps) {
  const formattedFetchedAt = fetchedAt
    ? new Intl.DateTimeFormat("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(fetchedAt))
    : "-";

  return (
    <section className="filter-panel" aria-label="광고계정 필터">
      <div className="filter-fields">
        <label className="search-field">
          <span className="sr-only">계정명 또는 ID 검색</span>
          <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="계정명 또는 ID 검색" />
        </label>
        <label>
          <span className="filter-label">상태</span>
          <select value={status} onChange={(event) => onStatusChange(event.target.value)}>
            <option value="">전체 상태</option>
            {statuses.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span className="filter-label">비즈니스</span>
          <select value={business} onChange={(event) => onBusinessChange(event.target.value)}>
            <option value="">전체 비즈니스</option>
            {businesses.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <div className="filter-meta">
        <p><strong>{count.toLocaleString("ko-KR")}</strong>개 계정</p>
        <span>마지막 조회 {formattedFetchedAt}</span>
        <button className="refresh-button" type="button" onClick={onRefresh} disabled={isLoading}>
          {isLoading ? "불러오는 중" : "새로고침"}
        </button>
      </div>
    </section>
  );
}
