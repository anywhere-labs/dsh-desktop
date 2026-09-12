from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from backend.app.contracts.brand_content_listing_contract import BrandContentListing
from backend.app.contracts.content_listing_contract import ContentListingShadowSnapshot
from backend.app.contracts.data_evidence_snapshot_contract import DataEvidenceSnapshot
from backend.app.contracts.marketing_analysis_report_contract import MarketingAnalysisReport
from backend.app.services.content_listing_shadow_adapter import build_content_listing_shadow


def build_brand_content_listing(
    strategy: dict[str, Any],
    *,
    strategy_id: str = "",
    source_refs: list[str] | None = None,
) -> BrandContentListing:
    """Normalize existing brand strategy output into a reusable upstream listing."""

    brand = str(strategy.get("brand_name") or "未命名品牌").strip()
    return BrandContentListing(
        listing_id=f"BCL-{strategy_id or brand}",
        strategy_id=strategy_id,
        brand_name=brand,
        category=str(strategy.get("category") or ""),
        strategic_theme=strategy.get("content_theme") or strategy.get("objective") or "品牌内容主题待确认",
        brand_proposition=str(strategy.get("brand_proposition") or strategy.get("executive_summary") or ""),
        target_audience=_as_list(strategy.get("audience")),
        content_pillars=_extract_pillars(strategy),
        funnel_stage=str(strategy.get("funnel_stage") or "interest"),
        evidence_status="model_generated" if strategy.get("generated") else "template",
        forbidden_claims=_as_list(strategy.get("forbidden_claims")),
        source_refs=list(source_refs or []),
        warnings=list(strategy.get("warnings") or []),
    )


def attach_brand_context(
    shadow: ContentListingShadowSnapshot,
    brand_listing: BrandContentListing,
) -> ContentListingShadowSnapshot:
    """Return a copy enriched with brand context; never changes render inputs."""

    payload = shadow.model_dump(mode="python")
    for item in payload["listings"]:
        item["brand_context"] = {
            "brand_content_listing_id": brand_listing.listing_id,
            "brand_name": brand_listing.brand_name,
            "strategic_theme": brand_listing.strategic_theme,
            "brand_proposition": brand_listing.brand_proposition,
            "target_audience": brand_listing.target_audience,
            "content_pillars": brand_listing.content_pillars,
        }
        item["warnings"] = list(item.get("warnings") or [])
        item["warnings"].append("brand_context_shadow_only")
    payload["summary"]["brand_content_listing_id"] = brand_listing.listing_id
    payload["warnings"] = list(payload.get("warnings") or []) + ["brand_context_not_render_or_publish_input"]
    return ContentListingShadowSnapshot.model_validate(payload)


def build_marketing_analysis_report(
    brand_listing: BrandContentListing,
    *,
    evidence: list[DataEvidenceSnapshot] | None = None,
    report_id: str = "marketing-analysis-shadow",
) -> MarketingAnalysisReport:
    snapshots = list(evidence or [])
    gaps = sorted({gap for snapshot in snapshots for gap in snapshot.missing_data})
    authorized = [snapshot for snapshot in snapshots if snapshot.authorization_status == "authorized"]
    facts = [
        f"品牌为 {brand_listing.brand_name}",
        f"当前战略主题为：{brand_listing.strategic_theme}",
    ]
    if authorized:
        facts.append(f"已存在 {len(authorized)} 个授权数据证据快照")
    else:
        gaps.append("authorized_platform_metrics")
    return MarketingAnalysisReport(
        report_id=report_id,
        status="ready" if authorized and not gaps else "partial",
        brand_name=brand_listing.brand_name,
        strategy_id=brand_listing.strategy_id,
        evidence_snapshots=snapshots,
        verified_facts=facts,
        data_gaps=sorted(set(gaps)),
        inferences=[
            "品牌内容应优先围绕战略主题和目标人群组织；当前为策略推断，不代表已验证转化结果。",
        ],
        recommendations=[
            "先用 Content Listing Shadow 对照已有直播片段，再决定是否进入内容生产。",
            "补齐授权平台指标后再输出 ROI、转化和渠道效率结论。",
        ],
        limitations=[
            "本报告不执行抓取、不代表广告投放结果、不改变 LiveClip 渲染。",
        ],
    )


def build_brand_strategy_shadow(
    job_id: str,
    result_json: dict[str, Any],
    strategy: dict[str, Any],
    *,
    strategy_id: str = "",
    source_refs: list[str] | None = None,
) -> tuple[BrandContentListing, ContentListingShadowSnapshot, MarketingAnalysisReport]:
    brand_listing = build_brand_content_listing(strategy, strategy_id=strategy_id, source_refs=source_refs)
    shadow = build_content_listing_shadow(job_id, result_json)
    enriched = attach_brand_context(shadow, brand_listing)
    report = build_marketing_analysis_report(brand_listing)
    return brand_listing, enriched, report


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if value:
        return [str(value)]
    return []


def _extract_pillars(strategy: dict[str, Any]) -> list[str]:
    raw = strategy.get("content_pillars") or strategy.get("recommendations") or []
    return _as_list(raw)
