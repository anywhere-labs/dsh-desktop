import { postJson } from "../api/client";

export function AttributionTracePage({ state, setResult }: any) {
  async function run() {
    if (!state.videoId) return setResult({ status: "blocked", missing_inputs: ["video_id"], next_action: ["先导入发布数据"] });
    setResult(await postJson("/api/attribution/analyze", { video_id: state.videoId }));
  }
  return <button onClick={run}>生成因果归因报告</button>;
}

