type KpiCardProps = {
  label: string;
  value: string;
  detail: string;
  tone?: "blue" | "green" | "slate";
};

export function KpiCard({ label, value, detail, tone = "blue" }: KpiCardProps) {
  return (
    <section className={`kpi-card kpi-${tone}`} aria-label={label}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </section>
  );
}
