export function TraceBadge({ traceId }: { traceId?: string }) {
  if (!traceId) return <span className="muted">无 Trace</span>;
  return <code>{traceId}</code>;
}

