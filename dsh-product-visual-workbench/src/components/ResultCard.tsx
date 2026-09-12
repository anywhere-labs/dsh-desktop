import { StatusBadge } from "./StatusBadge";

export function ResultCard({ title, result }: { title: string; result: any }) {
  return (
    <section className="card result-card">
      <div className="card-title-row">
        <h3>{title}</h3>
        <StatusBadge status={result?.status || "idle"} />
      </div>
      <pre>{JSON.stringify(result || {}, null, 2)}</pre>
    </section>
  );
}
