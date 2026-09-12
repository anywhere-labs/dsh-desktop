import { postJson } from "../api/client";

export function HotspotPage({ state, setResult }: any) {
  async function run() {
    if (!state.accountId) return setResult({ status: "blocked", missing_inputs: ["account_id"], next_action: ["先导入账号"] });
    setResult(await postJson("/api/hotspot/optimize", { account_id: state.accountId, keywords: ["团建", "开工季"] }));
  }
  return <button onClick={run}>生成热点优化建议</button>;
}
