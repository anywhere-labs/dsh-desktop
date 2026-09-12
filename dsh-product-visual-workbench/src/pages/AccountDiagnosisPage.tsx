import { postJson } from "../api/client";

export function AccountDiagnosisPage({ state, setResult }: any) {
  async function run() {
    if (!state.accountId) return setResult({ status: "blocked", missing_inputs: ["account_id"], next_action: ["先导入账号"] });
    setResult(await postJson(`/api/account/${state.accountId}/diagnose`, {}));
  }
  return <button onClick={run}>生成账号诊断</button>;
}

