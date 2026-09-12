import { postJson } from "../api/client";

export function TopicPlannerPage({ state, setState, setResult }: any) {
  async function run() {
    if (!state.accountId) return setResult({ status: "blocked", missing_inputs: ["account_id"], next_action: ["先导入账号"] });
    const res = await postJson("/api/topic/plan-week", { account_id: state.accountId });
    setResult(res);
    const firstTopic = res.data?.week_topics?.[0];
    if (firstTopic) {
      const list = await fetch(`/api/topic/${state.accountId}`).then((r) => r.json());
      setState((s: any) => ({ ...s, topicId: list.data.items[0]?.id }));
    }
  }
  return <button onClick={run}>生成 10 条周选题</button>;
}
