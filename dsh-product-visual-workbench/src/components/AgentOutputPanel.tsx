import { ResultCard } from "./ResultCard";

export function AgentOutputPanel({ result }: { result: any }) {
  return <ResultCard title="Agent 输出" result={result} />;
}

