"""Evidence-first marketing intelligence vertical slice.

This module deliberately keeps arithmetic deterministic and marks semantic
conclusions as hypotheses when the input does not contain supporting data.
It is the first runtime slice for STP, JTBD and funnel diagnosis.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any


def analyze_marketing_intelligence(payload: dict[str, Any]) -> dict[str, Any]:
    dataset = _canonical_dataset(payload)
    quality = _quality(dataset)
    features = _features(dataset)
    diagnosis = _diagnose(dataset, features)
    stp = _stp(dataset, features)
    jtbd = _jtbd(dataset)
    funnel = _funnel(dataset)
    opportunities = _opportunities(diagnosis, quality)
    experiments = _experiments(opportunities, diagnosis)

    facts = [f"品牌基础信息：{dataset['brand_name']} / {dataset['category']}"]
    if dataset["source_count"]:
        facts.append(f"已登记 {dataset['source_count']} 个资料入口")
    if dataset["provided_fields"]:
        facts.append("用户提供的经营数据已进入待校验数据集")
    derived = [f"{item['name']} = {item['value']}" for item in features if item.get("value") is not None]
    claims = [
        {"statement": item, "type": "fact", "evidence_ids": ["brand_input"], "confidence": 0.95}
        for item in facts
    ]
    claims.extend(
        {"statement": item, "type": "derived", "evidence_ids": ["provided_metrics"], "confidence": 0.9}
        for item in derived
    )

    return {
        "runtime": "marketing_intelligence_runtime.v1",
        "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_mode": "private_business" if dataset["provided_fields"] else "public_intelligence_preflight",
        "quality": quality,
        "dataset": dataset,
        "features": features,
        "diagnosis": diagnosis,
        "models": {"stp": stp, "jtbd": jtbd, "funnel": funnel},
        "claims": claims,
        "opportunities": opportunities,
        "experiments": experiments,
        "limits": [
            "公开互动、标价和内容表现不能推导真实 GMV、广告费、毛利、退款或复购。",
            "缺少用户评论、订单或分群数据时，STP/JTBD 只能输出待验证假设。",
        ],
    }


def _canonical_dataset(payload: dict[str, Any]) -> dict[str, Any]:
    marketing_data = payload.get("marketing_data") or {}
    raw_notes = str(payload.get("data_notes") or "").strip()
    if not marketing_data and raw_notes.startswith("{"):
        try:
            parsed_notes = json.loads(raw_notes)
            if isinstance(parsed_notes, dict):
                marketing_data = parsed_notes
        except json.JSONDecodeError:
            pass
    if not isinstance(marketing_data, dict):
        marketing_data = {}
    source_urls = list(payload.get("source_urls") or [])
    notes = raw_notes
    return {
        "brand_name": str(payload.get("brand_name") or "未命名品牌").strip(),
        "category": str(payload.get("category") or "目标品类").strip(),
        "audience": str(payload.get("audience") or "核心目标人群").strip(),
        "objective": str(payload.get("objective") or "提升品牌认知并带动转化").strip(),
        "source_count": len(source_urls),
        "source_urls": source_urls,
        "provided_fields": sorted(set(marketing_data.keys()) | ({"data_notes"} if notes else set())),
        "transactions": _dict(marketing_data.get("transactions")),
        "traffic": _dict(marketing_data.get("traffic")),
        "customers": _dict(marketing_data.get("customers")),
        "content": _dict(marketing_data.get("content")),
        "products": _list(marketing_data.get("products")),
        "reviews": _list(marketing_data.get("reviews")),
        "segments": _list(marketing_data.get("segments")),
        "funnel": _dict(marketing_data.get("funnel")),
    }


def _quality(dataset: dict[str, Any]) -> dict[str, Any]:
    available = sum(bool(dataset[key]) for key in ("transactions", "traffic", "customers", "content", "products", "reviews"))
    completeness = min(1.0, 0.25 + available / 8)
    issues: list[str] = []
    missing: list[str] = []
    if not dataset["transactions"]:
        missing.append("transactions")
    if not dataset["customers"]:
        missing.append("customers_or_segments")
    if not dataset["reviews"]:
        missing.append("reviews_or_comments")
    if not dataset["products"]:
        missing.append("products_or_sku")
    if not dataset["source_count"] and not dataset["provided_fields"]:
        issues.append("没有公开资料链接或内部经营数据")
    overall = round(completeness * 0.55 + (0.8 if dataset["source_count"] else 0.35) * 0.2 + (0.8 if dataset["provided_fields"] else 0.3) * 0.25, 3)
    status = "PASS" if overall >= 0.75 else "LIMITED" if overall >= 0.5 else "FAIL"
    return {"completeness": round(completeness, 3), "freshness": None, "sample_quality": None, "consistency": None, "reliability": 0.8 if dataset["provided_fields"] else 0.35, "overall_score": overall, "status": status, "issues": issues, "missing_fields": missing, "recommendation": "补充订单、用户、商品、评论和时间范围后再输出确定性结论。"}


def _features(dataset: dict[str, Any]) -> list[dict[str, Any]]:
    tx, traffic, customers, content = dataset["transactions"], dataset["traffic"], dataset["customers"], dataset["content"]
    pairs = [
        ("GMV", tx.get("gmv"), "transactions.gmv"),
        ("订单量", tx.get("orders"), "transactions.orders"),
        ("AOV", _ratio(tx.get("gmv"), tx.get("orders")), "GMV / orders"),
        ("CTR", _ratio(traffic.get("clicks"), traffic.get("impressions")), "clicks / impressions"),
        ("CVR", _ratio(tx.get("orders"), traffic.get("clicks")), "orders / clicks"),
        ("复购率", customers.get("repeat_rate"), "customers.repeat_rate"),
        ("ROAS", _ratio(tx.get("gmv"), traffic.get("ad_spend")), "GMV / ad_spend"),
        ("内容互动率", _ratio(content.get("engagements"), content.get("views")), "engagements / views"),
    ]
    return [{"feature_id": name.lower(), "name": name, "value": value, "formula": formula, "source_records": [formula.split(".")[0]], "confidence": 0.9 if value is not None else 0.0} for name, value, formula in pairs]


def _diagnose(dataset: dict[str, Any], features: list[dict[str, Any]]) -> dict[str, Any]:
    funnel = dataset["funnel"]
    stages = [("traffic", funnel.get("traffic")), ("engagement", funnel.get("engagement")), ("product_click", funnel.get("product_click")), ("add_to_cart", funnel.get("add_to_cart")), ("checkout", funnel.get("checkout")), ("order", funnel.get("order")), ("repeat", funnel.get("repeat"))]
    observed = [(stage, value) for stage, value in stages if isinstance(value, (int, float))]
    leak = min(observed, key=lambda item: item[1]) if observed else None
    problem = "数据不足以定位漏损节点" if not leak else f"当前可观察的最小漏斗量级为 {leak[0]}"
    return {"root_question": dataset["objective"], "largest_leak": leak[0] if leak else None, "problem_nodes": [{"node_id": "funnel_root", "problem_type": "conversion", "question": problem, "required_features": ["CTR", "CVR", "AOV"], "status": "needs_data" if not observed else "candidate", "score": 0.5 if leak else 0.0, "evidence_ids": ["provided_metrics"] if observed else []}], "trace": ["canonical_data", "feature_engine", "funnel_diagnosis"]}


def _stp(dataset: dict[str, Any], features: list[dict[str, Any]]) -> dict[str, Any]:
    segments = dataset["segments"]
    if not segments:
        return {"status": "needs_data", "segments": [], "target": None, "positioning_candidates": [], "reason": "需要客户分群、订单或行为数据；不能仅凭年龄和品类猜测目标人群。"}
    ranked = sorted(segments, key=lambda item: float(item.get("commercial_value", 0)) * float(item.get("brand_fit", 0.5)), reverse=True)
    target = ranked[0] if ranked else None
    return {"status": "ready", "segments": ranked, "target": target, "positioning_candidates": [{"statement": f"围绕 {target.get('name', '目标分群')} 的核心场景建立差异化主张", "confidence": 0.65, "status": "candidate"}] if target else []}


def _jtbd(dataset: dict[str, Any]) -> dict[str, Any]:
    reviews = [str(item.get("text") or item) for item in dataset["reviews"]]
    if not reviews:
        return {"status": "needs_data", "context": [], "functional_jobs": [], "emotional_jobs": [], "social_jobs": [], "evidence": [], "confidence": 0.0}
    return {"status": "candidate", "context": [], "functional_jobs": [{"statement": "从评论/反馈中提取购买任务", "evidence_count": len(reviews)}], "emotional_jobs": [], "social_jobs": [], "evidence": [{"text": item[:160], "source": "provided_reviews"} for item in reviews[:10]], "confidence": 0.55}


def _funnel(dataset: dict[str, Any]) -> dict[str, Any]:
    values = dataset["funnel"]
    order = ["traffic", "engagement", "product_click", "add_to_cart", "checkout", "order", "repeat"]
    stages = []
    previous = None
    for name in order:
        value = values.get(name)
        rate = _ratio(value, previous) if value is not None and previous else None
        stages.append({"stage": name, "volume": value, "rate": rate, "status": "observed" if value is not None else "missing"})
        if value is not None:
            previous = value
    return {"stages": stages, "largest_leak": next((item["stage"] for item in stages if item["status"] == "missing"), None), "status": "ready" if any(item["status"] == "observed" for item in stages) else "needs_data"}


def _opportunities(diagnosis: dict[str, Any], quality: dict[str, Any]) -> list[dict[str, Any]]:
    if diagnosis["largest_leak"]:
        return [{"opportunity_id": "opp-funnel-01", "priority": "P0", "dimension": "funnel", "statement": f"围绕 {diagnosis['largest_leak']} 补齐数据并做承接实验", "evidence": diagnosis["problem_nodes"], "confidence": 0.58, "status": "candidate"}]
    return [{"opportunity_id": "opp-data-01", "priority": "P0", "dimension": "data", "statement": "先建立可追踪的数据证据底座，再输出经营结论", "evidence": quality["missing_fields"], "confidence": 0.92, "status": "recommended"}]


def _experiments(opportunities: list[dict[str, Any]], diagnosis: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"experiment_id": f"exp-{item['opportunity_id']}", "hypothesis": item["statement"], "target_segment": "待数据分群", "primary_metric": "CVR", "secondary_metrics": ["CTR", "AOV", "贡献毛利 ROI"], "status": "draft", "success_criteria": {"requires_baseline": True}} for item in opportunities]


def _ratio(numerator: Any, denominator: Any) -> float | None:
    try:
        if numerator is None or denominator in (None, 0):
            return None
        return round(float(numerator) / float(denominator), 4)
    except (TypeError, ValueError):
        return None


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []
