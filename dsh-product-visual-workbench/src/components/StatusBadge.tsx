export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${status || "idle"}`}>{status || "idle"}</span>;
}
