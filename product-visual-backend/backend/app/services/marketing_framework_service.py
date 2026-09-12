"""Structured marketing-planning and reverse-acquisition framework nodes."""

from __future__ import annotations

from typing import Any


KEYWORD_FAMILIES = [
    "行业词", "品类词", "产品词", "功能词", "场景词", "问题词", "痛点词",
    "结果词", "人群词", "决策词", "对比词", "品牌词", "替代方案词", "长尾自然语言",
]


def build_marketing_planning_brief(payload: dict[str, Any], intelligence: dict[str, Any] | None = None) -> dict[str, Any]:
    intelligence = intelligence or {}
    dataset = intelligence.get("dataset") or {}
    quality = intelligence.get("quality") or {}
    audience = str(payload.get("audience") or "待通过真实用户数据确认")
    category = str(payload.get("category") or "目标品类")
    objective = str(payload.get("objective") or "提升品牌认知并带动转化")
    gaps = list(quality.get("missing_fields") or [])
    opportunities = list(intelligence.get("opportunities") or [])
    brief_qa = _brief_qa(payload, intelligence)
    return {
        "brief_id": f"brief-{str(payload.get('brand_name') or 'brand').strip().lower().replace(' ', '-')}",
        "version": "marketing-planning-brief.v1",
        "status": "ready" if brief_qa["score"] >= 75 else "limited",
        "business": {
            "company_name": str(payload.get("company_name") or "待补充"),
            "brand_name": str(payload.get("brand_name") or "未命名品牌"),
            "product_or_service": category,
            "business_stage": "待通过经营数据确认",
            "business_model": "待补充",
            "core_product": (dataset.get("products") or [{}])[0] if dataset.get("products") else None,
            "current_channels": payload.get("platforms") or payload.get("target_platform") or [],
            "constraints": ["公开数据不能替代内部经营事实", "预算和利润需以真实成本口径校验"],
        },
        "objectives": {
            "business_goal": objective,
            "marketing_goal": "获得更多高意向用户进入商品/直播/咨询承接",
            "communication_goal": f"建立 {category} 的可识别差异化认知",
            "channel_goal": "内容/搜索 → 商品页或直播间 → 成交",
            "conversion_goal": "待定义有效支付、留资或咨询事件",
            "retention_goal": "首购后复购、评价、推荐或会员活跃",
        },
        "market": {
            "decision_questions": ["市场发生了什么变化？", "变化是否影响该品牌的目标人群、商品和渠道？", "下一步需要什么数据验证？"],
            "insights": payload.get("market_insights") or [],
            "missing_information": gaps,
        },
        "competitors": [],
        "audiences": [{"name": audience, "status": "initial_input", "needs_validation": True}],
        "customer_insights": [{"who": audience, "scene": "待从真实评论、搜索词和订单场景提取", "job": "待验证", "pain": "待验证", "barrier": "待验证", "trigger": "待验证"}],
        "brand": {"brand_truth": "待补充品牌资产和公开事实", "strengths": [], "weaknesses": [], "proof": []},
        "products": dataset.get("products") or [],
        "positioning": {"target": audience, "category": category, "value_proposition": "待由 Brand Truth × Customer Truth × Market Opportunity 共同验证", "reason_to_believe": []},
        "marketing_proposition": f"不是只卖 {category}，而是帮助 {audience} 在具体场景中解决可验证的问题。",
        "content_pillars": ["场景解决方案", "用户问题与痛点", "产品证据", "案例/评价", "主理人或品牌观点"],
        "channel_strategy": [{"channel": "内容/搜索", "role": "发现需求与承接高意向", "path": "内容 → CTA → 商品/直播/留资"}],
        "growth_opportunities": opportunities[:3],
        "action_plan": {"30_days": ["补齐核心经营数据与真实 VOC", "建立关键词和内容证据库"], "60_days": ["围绕最高优先级机会做小规模内容/承接实验"], "90_days": ["用成交、复购和边际 ROI 反馈更新用户与策略模型"]},
        "kpis": ["曝光/品牌搜索", "内容互动/商品点击", "CVR/GMV/CAC/ROAS", "复购率/LTV/会员增长"],
        "risks": ["目标人群只是输入假设", "公开信号不能推导真实经营指标", "没有增量实验时不能把平台归因当作增量"],
        "assumptions": ["当前品牌品类和目标人群来自用户输入", "缺少竞品和完整 VOC 时，定位与内容方向为候选"],
        "missing_information": gaps,
        "qa": brief_qa,
    }


def build_reverse_acquisition(payload: dict[str, Any], intelligence: dict[str, Any] | None = None, brief: dict[str, Any] | None = None) -> dict[str, Any]:
    intelligence = intelligence or {}
    brief = brief or {}
    dataset = intelligence.get("dataset") or {}
    audience = str(payload.get("audience") or "目标用户")
    category = str(payload.get("category") or "目标品类")
    objective = str(payload.get("objective") or "提升转化")
    reviews = dataset.get("reviews") or []
    voc = [{"text": str(item.get("text") or item)[:180], "type": "provided_review", "source": "provided_reviews"} for item in reviews[:20]]
    trigger_library = ["新品/活动节点", "转化下降", "价格或竞品变化", "用户遇到具体场景问题", "复购或服务需求"]
    keyword_seed = [
        f"{category}", f"{audience}{category}", f"{category}怎么选", f"{category}适合什么场景",
        f"{category}价格", f"{category}对比", f"{category}效果怎么样", f"{category}推荐",
    ]
    keywords = [{"keyword": word, "family": _keyword_family(word, category), "intent": _intent(index), "score": _keyword_score(index), "channel": "搜索/内容/商品页", "content_angle": f"围绕 {word} 回答用户问题", "cta": "查看商品/进入直播/领取清单", "offer": "商品、咨询或会员权益"} for index, word in enumerate(keyword_seed)]
    return {
        "framework_id": "user-reverse-engineering-acquisition.v1",
        "status": "candidate" if not reviews else "evidence_bound",
        "commercial_outcome": {"business_goal": objective, "conversion_event": "支付/留资/有效咨询（需业务确认）", "offer": "待补充", "acceptance_metric": "CVR、有效线索率或净销售额"},
        "user": {"who": [{"role": audience, "decision_role": "待确认"}], "scene": ["待从真实行为、评论和订单场景提取"], "trigger": trigger_library, "jtbd": f"当具体场景或问题发生时，{audience} 希望完成与 {category} 相关的任务，从而获得可衡量结果。", "pain": ["待由 VOC 验证"], "desired_outcome": ["解决问题并降低决策成本"], "barrier": ["价格、信任、适配、效果和使用风险待验证"], "decision_criteria": ["价格", "效果", "信任", "效率", "服务"]},
        "voc": voc,
        "keyword_families": KEYWORD_FAMILIES,
        "keywords": keywords,
        "intent_levels": [{"level": f"I{index}", "name": name, "use": use} for index, (name, use) in enumerate([("无意识", "内容教育"), ("问题意识", "问题内容"), ("方案意识", "解决方案"), ("产品意识", "商品/产品承接"), ("对比决策", "案例/对比/口碑"), ("购买意图", "价格/服务/成交")])],
        "acquisition_mapping": [{"keyword": item["keyword"], "question": f"用户为什么搜索：{item['keyword']}？", "content": item["content_angle"], "proof": "评价、案例、产品参数或真实经营数据", "cta": item["cta"], "lead_magnet": "选购清单/诊断表/对比表", "offer": item["offer"]} for item in keywords[:5]],
        "conversion_loop": ["流量入口", "内容", "CTA", "Lead Magnet", "留资/商品点击", "线索评分", "跟进/Offer", "成交", "VOC与成交数据反馈"],
        "feedback_metrics": ["keyword→visit", "content→engagement", "CTA→lead", "lead→sale", "keyword→revenue", "VOC→content/product update"],
        "dependencies": ["真实 VOC", "搜索/站内关键词数据", "内容到商品/线索归因", "成交用户与触点关联"],
        "missing_information": list((brief.get("missing_information") or []) + (["real_voc"] if not reviews else [])),
    }


def _brief_qa(payload: dict[str, Any], intelligence: dict[str, Any]) -> dict[str, Any]:
    quality = intelligence.get("quality") or {}
    score = 30
    score += 20 if payload.get("brand_name") and payload.get("category") else 0
    score += 20 if payload.get("objective") else 0
    score += 15 if intelligence.get("dataset", {}).get("provided_fields") else 0
    score += 15 if intelligence.get("dataset", {}).get("source_count") else 0
    return {"score": score, "status": "PASS" if score >= 75 else "LIMITED", "data_quality": quality.get("status", "LIMITED"), "reasons": ["用户输入已登记", "真实数据/来源越完整，Brief QA 越高"]}


def _intent(index: int) -> str:
    return ["I1 问题意识", "I2 方案意识", "I3 产品意识", "I4 对比决策", "I5 购买意图", "I3 产品意识", "I4 对比决策", "I5 购买意图"][index]


def _keyword_score(index: int) -> int:
    return [58, 65, 72, 78, 86, 74, 82, 88][index]


def _keyword_family(word: str, category: str) -> str:
    if "价格" in word:
        return "决策词"
    if "对比" in word or "推荐" in word:
        return "对比词"
    if "怎么" in word or "效果" in word:
        return "问题词"
    return "品类词" if word == category else "人群词"
