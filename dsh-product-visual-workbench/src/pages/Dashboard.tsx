import { useEffect, useState } from "react";
import { api } from "../api/client";
import { ResultCard } from "../components/ResultCard";

export function Dashboard() {
  const [result, setResult] = useState<any>({});
  useEffect(() => { api("/api/dashboard").then(setResult); }, []);
  return <ResultCard title="Dashboard 首页" result={result} />;
}

