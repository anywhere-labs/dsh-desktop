import { postJson } from "../api/client";

export function ImportPage({ setResult, setState }: any) {
  async function run() {
    const res = await postJson("/api/account/import", { name: "阿乐服装定制 Demo", platform: "douyin", industry: "服装定制 / 真人口播 / 电商成交" });
    setResult(res);
    if (res.data?.account_id) setState((s: any) => ({ ...s, accountId: res.data.account_id }));
  }
  return <button onClick={run}>导入 Demo 账号</button>;
}

