import { postJson } from "../api/client";

export function BenchmarkAnalysisPage({ state, setResult }: any) {
  async function run() {
    if (!state.accountId) return setResult({ status: "blocked", missing_inputs: ["account_id"], next_action: ["先导入账号"] });
    setResult(await postJson("/api/benchmark/analyze", { account_id: state.accountId, title: "服装定制对标视频" }));
  }
  return <button onClick={run}>生成对标分析</button>;
}
