import React from "react";

export type TemplateRegistryItem = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  duration_range?: [number, number];
  overlay_count_range?: [number, number];
  sfx_count_range?: [number, number];
  hook_within_seconds?: number;
  benefit_conclusion_required?: boolean;
};

type TemplateRegistryPanelProps = {
  items: TemplateRegistryItem[];
  selectedId: string;
  onSelect: (id: string) => void;
};

type NormalizedTemplateRegistryItem = TemplateRegistryItem & {
  durationLabel: string;
  overlayLabel: string;
  sfxLabel: string;
  hookLabel: string;
};

function rangeLabel(range: number[] | undefined, suffix: string) {
  if (!range || range.length !== 2) return "";
  return `${range[0]}-${range[1]} ${suffix}`;
}

export function normalizeTemplateItems(items: TemplateRegistryItem[]): NormalizedTemplateRegistryItem[] {
  return items.map((item) => ({
    ...item,
    durationLabel: rangeLabel(item.duration_range, "秒"),
    overlayLabel: rangeLabel(item.overlay_count_range, "个花字"),
    sfxLabel: rangeLabel(item.sfx_count_range, "个轻音效"),
    hookLabel: item.hook_within_seconds ? `${item.hook_within_seconds} 秒内钩子` : "",
  }));
}

export function resolveSelectedTemplate(
  items: NormalizedTemplateRegistryItem[],
  selectedId: string,
) {
  return items.find((item) => item.id === selectedId) || items[0] || null;
}

export function TemplateRegistryPanel({
  items,
  selectedId,
  onSelect,
}: TemplateRegistryPanelProps) {
  const normalized = normalizeTemplateItems(items);
  const selected = resolveSelectedTemplate(normalized, selectedId);

  return (
    <section className="template-registry-panel">
      <div className="template-registry-head">
        <h4>包装模板中心</h4>
        <small>{normalized.length} 个首批模板</small>
      </div>
      <div className="template-registry-grid" role="list">
        {normalized.map((item) => (
          <button
            aria-pressed={item.id === selectedId}
            className={item.id === selectedId ? "active" : ""}
            key={item.id}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <strong>{item.name}</strong>
            <span>{item.version || "1.2.0"}</span>
            <small>{item.overlayLabel}</small>
          </button>
        ))}
      </div>
      {selected ? (
        <div className="template-registry-detail">
          <strong>{selected.name}</strong>
          <p>{selected.description || "用于直播切片包装成片的标准化模板。"}</p>
          <div>
            {selected.durationLabel ? <span>{selected.durationLabel}</span> : null}
            {selected.overlayLabel ? <span>{selected.overlayLabel}</span> : null}
            {selected.sfxLabel ? <span>{selected.sfxLabel}</span> : null}
            {selected.hookLabel ? <span>{selected.hookLabel}</span> : null}
            {selected.benefit_conclusion_required ? <span>利益结论</span> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
