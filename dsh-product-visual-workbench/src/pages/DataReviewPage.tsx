import { postJson } from "../api/client";

export function DataReviewPage({ state, setState, setResult }: any) {
  async function run() {
    const videoId = state.videoId || "demo-video-" + Date.now();
    setState((s: any) => ({ ...s, videoId }));
    try {
      const seven = await postJson("/api/report/import", { video_id: videoId, day_type: "7d", views: 3200, likes: 120, comments: 18, completion_rate: 0.36 });
      if (seven.status !== "ok") return setResult(seven);
      const fourteen = await postJson("/api/report/import", { video_id: videoId, day_type: "14d", views: 5800, likes: 260, comments: 37, completion_rate: 0.41 });
      if (fourteen.status !== "ok") return setResult(fourteen);
      setResult(await postJson(`/api/report/${videoId}/review-7d`, {}));
    } catch (error) {
      setResult({ status: "failed", message: String(error), next_action: ["检查后端服务状态"] });
    }
  }
  return <button onClick={run}>导入 7天/14天数据并复盘</button>;
}
