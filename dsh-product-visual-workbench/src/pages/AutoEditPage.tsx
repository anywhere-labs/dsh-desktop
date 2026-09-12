import { postJson } from "../api/client";

export function AutoEditPage({ state, setState, setResult }: any) {
  const skillCapabilities = [
    "basic_ffmpeg 自动剪辑预览",
    "flycut-caption 字幕增强",
    "ASS 花字字幕",
    "关键词高亮",
    "字幕烧录 MP4",
    "字幕 QC 报告",
  ];

  async function createAndExport() {
    if (!state.accountId || !state.materialId) return setResult({ status: "blocked", missing_inputs: ["account_id", "material_id"], next_action: ["先导入账号并上传素材"] });
    const created = await postJson("/api/edit/create", { account_id: state.accountId, script_id: state.scriptId || "", material_id: state.materialId });
    if (created.data?.edit_project_id) {
      setState((s: any) => ({ ...s, editProjectId: created.data.edit_project_id }));
      const exported = await postJson(`/api/edit/${created.data.edit_project_id}/export`, {});
      setResult(exported);
    } else {
      setResult(created);
    }
  }
  return (
    <section className="card auto-edit-panel">
      <div>
        <p className="eyebrow">AUTO EDIT / SKILL ENABLED</p>
        <h2>自动剪辑</h2>
        <p>启用 basic_ffmpeg 生成预览，并调用 flycut-caption 输出花字字幕、ASS、样式 JSON、特效点位和字幕 QC。</p>
      </div>
      <div className="platform-row">
        {skillCapabilities.map((item) => <span key={item}>{item}</span>)}
      </div>
      <button onClick={createAndExport}>生成剪辑计划并导出带字幕预览</button>
    </section>
  );
}
