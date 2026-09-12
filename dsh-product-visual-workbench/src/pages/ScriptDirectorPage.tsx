import { postJson } from "../api/client";

export function ScriptDirectorPage({ state, setState, setResult }: any) {
  async function run() {
    if (!state.topicId) return setResult({ status: "blocked", missing_inputs: ["topic_id"], next_action: ["先生成选题"] });
    const res = await postJson(`/api/topic/${state.topicId}/generate-script`, {});
    setResult(res);
    if (res.data?.script_id) setState((s: any) => ({ ...s, scriptId: res.data.script_id }));
  }
  return <button onClick={run}>生成分镜脚本</button>;
}

