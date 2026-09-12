from __future__ import annotations

from typing import Any

from backend.app.services.brand_content_listing_bridge import build_brand_content_listing
from backend.app.services.marketing_intelligence_service import analyze_marketing_intelligence
from backend.app.services.marketing_framework_service import build_marketing_planning_brief, build_reverse_acquisition
from backend.app.services.brand_simulation_service import simulate_campaign
from backend.app.services.brand_strategy_service import generate_strategy


BUSINESS_FLOW = [
    {"id": "intake", "label": "品牌基础信息", "description": "品牌、品类、人群、经营目标和资料入口"},
    {"id": "evidence", "label": "品牌数据与证据", "description": "公开数据、授权平台数据、客户资料和视觉素材"},
    {"id": "catalog", "label": "Product / Catalog", "description": "商品事实、SKU、价格、库存和资产"},
    {"id": "listing", "label": "Listing Domain", "description": "平台化商品呈现、关键词、卖点、合规和优化"},
    {"id": "strategy", "label": "Marketing Domain", "description": "定位、人群、内容、渠道、AIPL/FAST 和节点策略"},
    {"id": "campaign", "label": "Campaign / Conversion", "description": "预算、ROAS、库存、转化和会员飞轮模拟"},
    {"id": "review", "label": "Review / Optimization", "description": "数据质量、归因、复盘和下一轮优化动作"},
]

TECHNICAL_FLOW = [
    {"id": "api", "label": "Brand Strategy API", "component": "routes_brand_strategy.py / routes_brand_data.py", "kind": "entry"},
    {"id": "orchestrator", "label": "Workflow Orchestrator", "component": "brand_workflow_service.py", "kind": "orchestration"},
    {"id": "dag", "label": "DAG Engine", "component": "core/dag_engine.py", "kind": "runtime"},
    {"id": "agents", "label": "Agent Registry", "component": "brand_data_collection_agent + brand_strategy_workflow_agent", "kind": "decision"},
    {"id": "skills", "label": "Skill Runtime", "component": "data / listing / strategy / simulation skills", "kind": "execution"},
    {"id": "evidence", "label": "Evidence Snapshot", "component": "storage/brand_data/*.json", "kind": "persistence"},
    {"id": "output", "label": "Report + Trace", "component": "strategy JSON / node outputs / trace", "kind": "observability"},
]


def brand_workflow_handler(node_input: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    operation = str(node_input.get("operation") or "")
    payload = dict(context.get("request") or {})
    dependency_outputs = node_input.get("dependency_outputs") or {}
    if operation == "propose":
        role = str(node_input.get("role") or "agent")
        objective = str(payload.get("objective") or "提升经营质量")
        constraints = ["不得把模拟值当作平台实绩", "不得突破未授权数据边界", "需要说明证据与缺口"]
        proposals = {
            "strategy": "围绕目标缺口确定阶段、北极星指标和优先级。",
            "growth": "比较渠道边际 ROI、CAC 和增量贡献，提出预算方向。",
            "product": "按引流款、爆款、利润款、复购款和库存约束提出货品组合。",
            "content": "按认知、兴趣、考虑、转化、忠诚拆分内容资产和指标。",
            "live": "按时段、SKU、库存和投流约束提出直播执行方案。",
            "customer": "按新客、会员、RFM 和复购窗口提出用户经营方案。",
            "supply": "校验库存、补货周期、缺货风险和活动承接能力。",
            "fulfillment": "校验发货、售后、退款和服务 SLA 风险。",
            "finance": "以贡献毛利、现金流、CAC 和最低 ROI 作为否决条件。",
        }
        return {"status": "proposal", "agent_role": role, "objective": objective, "proposal": proposals.get(role, "提交一份可审计的经营方案。"), "constraints": constraints, "evidence_status": "provided_or_missing"}
    if operation == "arbitrate":
        proposals = [value for key, value in dependency_outputs.items() if value.get("status") == "proposal"]
        finance = next((value for value in proposals if value.get("agent_role") == "finance"), {})
        return {"status": "arbitrated", "proposal_count": len(proposals), "finance_veto_enabled": True, "decision": "保留证据充分且不突破贡献毛利/现金流/库存红线的方案；其余进入待验证队列。", "finance_constraints": finance.get("constraints", []), "selected_roles": [item.get("agent_role") for item in proposals if item.get("agent_role") not in {"finance", "fulfillment"}]}
    if operation == "allocate":
        arbitration = next(iter(dependency_outputs.values()), {})
        return {"status": "allocated", "allocation_mode": "dynamic_by_gap_margin_cash_inventory", "selected_roles": arbitration.get("selected_roles", []), "budget_rule": "预算随目标缺口、边际贡献 ROI、库存和现金流反馈调整，不按固定部门预算自动放量。", "blocked_without_authorized_metrics": "authorized_platform_metrics" in (payload.get("missing_data") or []) or not payload.get("authorized_metrics")}
    if operation == "feedback":
        return {"status": "feedback_ready", "loop": "observe → compare target gap → re-score proposals → arbitrate → reallocate", "required_signals": ["GMV", "贡献毛利", "现金流", "库存", "退款率", "边际ROI", "复购率"], "next_decision": "补齐真实平台指标后再执行预算重分配"}
    if operation == "validate":
        missing = [key for key in ("brand_name", "category") if not str(payload.get(key) or "").strip()]
        return {"status": "ok" if not missing else "blocked", "missing_inputs": missing, "message": "品牌基础信息已通过" if not missing else "缺少品牌基础信息"}
    if operation == "collect":
        return {"status": "partial", "collection_mode": "workflow_preflight", "evidence_sources": list(payload.get("source_urls") or []), "authorized_metrics": bool(payload.get("oceanengine") or payload.get("qianchuan")), "provided_data": bool(str(payload.get("data_notes") or "").strip()), "note": "正式采集任务通过 /api/brand-data/collections 执行；此节点先登记证据入口。"}
    if operation == "normalize":
        collected = dependency_outputs.get("collect_evidence", {})
        facts = ["品牌基础信息已登记"]
        if collected.get("provided_data"):
            facts.append("用户经营数据摘要已登记，等待字段级校验")
        if collected.get("evidence_sources"):
            facts.append(f"已登记 {len(collected['evidence_sources'])} 个公开资料入口")
        gaps = [] if payload.get("oceanengine") or payload.get("qianchuan") else ["authorized_platform_metrics"]
        if not collected.get("provided_data") and not collected.get("evidence_sources"):
            gaps.append("product_order_review_evidence")
        return {"status": "ok", "facts": facts, "inferences": [], "missing_data": gaps, "source_count": len(collected.get("evidence_sources", [])), "provided_data": bool(collected.get("provided_data"))}
    if operation == "listing":
        strategy = dependency_outputs.get("normalize_evidence", {})
        listing = build_brand_content_listing({**payload, "executive_summary": "Listing 作为 Product/Catalog 与 Marketing Domain 之间的业务能力层。", "recommendations": ["根据平台、市场、人群和商品事实生成 Listing 草案。"]}, strategy_id=str(payload.get("strategy_id") or "brand-workflow"), source_refs=list(payload.get("source_urls") or []))
        return {"status": "ok", "listing": listing.model_dump(mode="json")}
    if operation == "intelligence":
        return {"status": "ok", "intelligence": analyze_marketing_intelligence(payload)}
    if operation == "brief":
        intelligence = (dependency_outputs.get("marketing_intelligence") or {}).get("intelligence") or {}
        return {"status": "ok", "brief": build_marketing_planning_brief(payload, intelligence)}
    if operation == "reverse_acquisition":
        intelligence = (dependency_outputs.get("marketing_intelligence") or {}).get("intelligence") or {}
        brief = (dependency_outputs.get("marketing_brief") or {}).get("brief") or {}
        return {"status": "ok", "reverse_acquisition": build_reverse_acquisition(payload, intelligence, brief)}
    if operation == "simulate":
        return {"status": "ok", "simulation": simulate_campaign(payload)}
    if operation == "strategy":
        strategy, warnings = generate_strategy({**payload, "use_model": bool(payload.get("use_model"))})
        gaps = [] if payload.get("oceanengine") or payload.get("qianchuan") else ["authorized_platform_metrics"]
        return {"status": "ok" if not warnings else "partial", "strategy": strategy, "warnings": warnings, "data_gaps": gaps}
    if operation == "quality":
        gaps = dependency_outputs.get("generate_strategy", {}).get("data_gaps", [])
        return {"status": "passed" if not gaps else "partial", "verified": ["workflow nodes executed", "outputs traceable by node"], "data_gaps": gaps, "next_action": ["补充授权平台数据后重新运行"] if gaps else []}
    return {"status": "blocked", "error": f"unsupported workflow operation: {operation}"}


def workflow_contract() -> dict[str, Any]:
    return {"business_flow": BUSINESS_FLOW, "technical_flow": TECHNICAL_FLOW, "boundary": ["Product/Catalog 负责商品事实", "Listing 负责平台化呈现和优化", "Marketing 负责增长策略与转化", "Performance 负责反馈和归因"]}


def run_brand_workflow(payload: dict[str, Any]) -> dict[str, Any]:
    from backend.app.core.dag_engine import DAGEngine
    from backend.app.core.agent_registry import default_agent_registry

    proposal_nodes = [{"node": f"{role}_proposal", "agent": f"{role}_agent", "input": {"operation": "propose", "role": role}} for role in ["strategy", "growth", "product", "content", "live", "customer", "supply", "fulfillment", "finance"]]
    dag = [
        {"node": "validate_input", "agent": "brand_strategy_workflow_agent", "input": {"operation": "validate"}},
        {"node": "collect_evidence", "agent": "brand_strategy_workflow_agent", "depends_on": ["validate_input"], "input": {"operation": "collect"}},
        {"node": "normalize_evidence", "agent": "brand_strategy_workflow_agent", "depends_on": ["collect_evidence"], "input": {"operation": "normalize"}},
        {"node": "marketing_intelligence", "agent": "brand_strategy_workflow_agent", "depends_on": ["normalize_evidence"], "input": {"operation": "intelligence"}},
        {"node": "marketing_brief", "agent": "brand_strategy_workflow_agent", "depends_on": ["marketing_intelligence"], "input": {"operation": "brief"}},
        {"node": "reverse_acquisition", "agent": "brand_strategy_workflow_agent", "depends_on": ["marketing_brief"], "input": {"operation": "reverse_acquisition"}},
        {"node": "build_listing_context", "agent": "brand_strategy_workflow_agent", "depends_on": ["reverse_acquisition"], "input": {"operation": "listing"}},
        {"node": "simulate_campaign", "agent": "brand_strategy_workflow_agent", "depends_on": ["build_listing_context"], "input": {"operation": "simulate"}},
        {"node": "generate_strategy", "agent": "brand_strategy_workflow_agent", "depends_on": ["simulate_campaign"], "input": {"operation": "strategy"}},
        {"node": "quality_gate", "agent": "brand_strategy_workflow_agent", "depends_on": ["generate_strategy"], "input": {"operation": "quality"}},
        *proposal_nodes,
        {"node": "finance_arbitration", "agent": "finance_agent", "depends_on": [f"{role}_proposal" for role in ["strategy", "growth", "product", "content", "live", "customer", "supply", "fulfillment", "finance"]], "input": {"operation": "arbitrate"}},
        {"node": "dynamic_resource_allocation", "agent": "growth_agent", "depends_on": ["finance_arbitration"], "input": {"operation": "allocate"}},
        {"node": "feedback_replan", "agent": "strategy_agent", "depends_on": ["dynamic_resource_allocation"], "input": {"operation": "feedback"}},
    ]
    result = DAGEngine(agent_registry=default_agent_registry, max_retries=0).execute(
        task_id=str(payload.get("workflow_id") or "brand-workflow"),
        dag=dag,
        context={"request": payload},
        dag_id="brand_strategy_full_flow",
    )
    outputs = result.get("outputs") or {}
    strategy_output = outputs.get("generate_strategy") or {}
    strategy = strategy_output.get("strategy") or {}
    simulation = (outputs.get("simulate_campaign") or {}).get("simulation") or {}
    listing = (outputs.get("build_listing_context") or {}).get("listing") or {}
    quality = outputs.get("quality_gate") or {}
    intelligence = (outputs.get("marketing_intelligence") or {}).get("intelligence") or {}
    brief = (outputs.get("marketing_brief") or {}).get("brief") or {}
    reverse_acquisition = (outputs.get("reverse_acquisition") or {}).get("reverse_acquisition") or {}
    # A stable report envelope lets the frontend render the same sections for
    # template, model, and partial-evidence runs without knowing DAG internals.
    result["report"] = {
        "title": f"{payload.get('brand_name') or '未命名品牌'} 品牌营销经营策略报告",
        "source": strategy.get("source") or "品牌营销全链路工作流",
        "generated": bool(strategy.get("generated")),
        "sections": [
            {"id": "overview", "title": "全案总览", "status": "ready"},
            {"id": "brief", "title": "营销规划 Brief", "status": "ready"},
            {"id": "acquisition", "title": "用户逆向获客", "status": "ready"},
            {"id": "market", "title": "市场洞察与营销趋势", "status": "ready"},
            {"id": "audience", "title": "AIPL / FAST / AARRR 人群增长", "status": "ready"},
            {"id": "listing", "title": "商品与 Listing 承接", "status": "ready"},
            {"id": "campaign", "title": "年度节点与渠道内容", "status": "ready"},
            {"id": "profit", "title": "预算、ROI 与贡献毛利", "status": "ready"},
            {"id": "operations", "title": "组织、供应链与风险", "status": "ready"},
            {"id": "data", "title": "数据归因与复盘飞轮", "status": "ready"},
        ],
        "strategy": strategy,
        "simulation": simulation,
        "listing": listing,
        "quality": quality,
        "evidence": outputs.get("normalize_evidence") or {},
        "intelligence": intelligence,
        "brief": brief,
        "reverse_acquisition": reverse_acquisition,
    }
    return result
