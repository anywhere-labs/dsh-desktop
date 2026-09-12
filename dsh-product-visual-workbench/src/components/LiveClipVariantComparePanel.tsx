import React from "react";
import type { TemplateRegistryItem } from "./TemplateRegistryPanel";

type VariantSummary = {
  clip_count?: number;
  overlay_points?: number;
  sfx_points?: number;
  qa_status?: string;
  qa_score?: number;
};

export type LiveClipRenderVariant = {
  variant_id: string;
  template_id: string;
  template_name?: string;
  template_version?: string;
  review_status?: string;
  recommended_rank?: number | null;
  recommended_reason?: string;
  summary?: VariantSummary;
};

export type VariantCompareItem = TemplateRegistryItem & {
  variantId: string;
  isActive: boolean;
  reviewStatus: string;
  qaLabel: string;
  summaryChips: string[];
  recommendedLabel: string;
  recommendedReason: string;
};

function variantIdFromTemplate(templateId: string) {
  return `template::${templateId}`;
}

export function resolvePreviousVariantId(
  activeVariantId: string,
  variantHistory: string[] = [],
) {
  for (let index = variantHistory.length - 1; index >= 0; index -= 1) {
    const candidate = variantHistory[index];
    if (candidate && candidate !== activeVariantId) return candidate;
  }
  return "";
}

export function buildVariantCompareItems(
  items: TemplateRegistryItem[],
  variants: LiveClipRenderVariant[],
  activeVariantId: string,
): VariantCompareItem[] {
  const variantMap = new Map(
    variants.map((variant) => [variant.template_id, variant]),
  );
  return items.map((item) => {
    const variant = variantMap.get(item.id);
    const summary = variant?.summary || {};
    return {
      ...item,
      variantId: variant?.variant_id || variantIdFromTemplate(item.id),
      isActive: (variant?.variant_id || variantIdFromTemplate(item.id)) === activeVariantId,
      reviewStatus: variant?.review_status || "not_submitted",
      qaLabel: Number.isFinite(summary.qa_score) ? `QA ${summary.qa_score}` : "QA --",
      summaryChips: [
        Number.isFinite(summary.clip_count) ? `${summary.clip_count}条切片` : "",
        Number.isFinite(summary.overlay_points) ? `${summary.overlay_points}个花字` : "",
        Number.isFinite(summary.sfx_points) ? `${summary.sfx_points}个音效` : "",
      ].filter(Boolean),
      recommendedLabel: variant?.recommended_rank ? `推荐 ${variant.recommended_rank}` : "",
      recommendedReason: variant?.recommended_reason || "",
    };
  });
}

type LiveClipVariantComparePanelProps = {
  items: TemplateRegistryItem[];
  variants: LiveClipRenderVariant[];
  activeVariantId: string;
  variantHistory?: string[];
  busy?: boolean;
  rerunActive?: boolean;
  onActivate: (variantId: string) => void;
  onFallback: (variantId: string) => void;
};

export function LiveClipVariantComparePanel({
  items,
  variants,
  activeVariantId,
  variantHistory = [],
  busy = false,
  rerunActive = false,
  onActivate,
  onFallback,
}: LiveClipVariantComparePanelProps) {
  const compareItems = buildVariantCompareItems(items, variants, activeVariantId);
  const previousVariantId = resolvePreviousVariantId(activeVariantId, variantHistory);

  return (
    <section className="commerce-card template-variant-panel">
      <div className="template-registry-head">
        <div>
          <h3>多模板对比</h3>
          <small>{rerunActive ? "本轮包装生成中，当前仅展示上轮主版本状态" : "默认展示全部模板，支持切换主版本和回退查看"}</small>
        </div>
        {previousVariantId && !rerunActive ? (
          <button
            className="ghost-btn"
            disabled={busy}
            onClick={() => onFallback(previousVariantId)}
            type="button"
          >
            回退上一个版本
          </button>
        ) : null}
      </div>
      <div className="template-variant-grid">
        {compareItems.map((item) => (
          <article
            className={item.isActive ? "template-variant-card active" : "template-variant-card"}
            key={item.variantId}
          >
            <div className="template-variant-card-head">
              <strong>{item.name}</strong>
              <span>{item.version || "1.2.0"}</span>
            </div>
            <div className="template-variant-badges">
              <span>{item.qaLabel}</span>
              {item.reviewStatus ? <span>{item.reviewStatus}</span> : null}
              {item.recommendedLabel ? <span>{item.recommendedLabel}</span> : null}
            </div>
            <div className="template-variant-summary">
              {item.summaryChips.length
                ? item.summaryChips.map((chip) => <small key={chip}>{chip}</small>)
                : <small>等待重新包装生成对比数据</small>}
            </div>
            {item.recommendedReason ? <p>{item.recommendedReason}</p> : null}
            {rerunActive ? <small>本轮包装生成中，暂不切换主版本。</small> : null}
            <div className="template-variant-actions">
              {rerunActive ? (
                <button disabled type="button">本轮生成中</button>
              ) : item.isActive ? (
                <button disabled type="button">当前主版本</button>
              ) : (
                <button disabled={busy} onClick={() => onActivate(item.variantId)} type="button">
                  设为主版本
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
