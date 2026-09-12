from fastapi import APIRouter

from backend.app.core.response import api_response
from backend.app.services.brand_strategy_service import build_template, generate_strategy, new_trace_id
from backend.app.services.brand_simulation_service import simulate_campaign
from backend.app.services.marketing_intelligence_service import analyze_marketing_intelligence
from backend.app.services.marketing_framework_service import build_marketing_planning_brief, build_reverse_acquisition
from backend.app.services.brand_workflow_service import run_brand_workflow, workflow_contract

router = APIRouter()


@router.post("/api/brand-strategy/template")
def template_api(payload: dict):
    return api_response("ok", "品牌营销全案内置模板已生成", build_template(payload), new_trace_id())


@router.post("/api/brand-strategy/generate")
def generate_api(payload: dict):
    data, warnings = generate_strategy(payload)
    status = "ok" if not warnings or data.get("generated") else "partial"
    return api_response(status, "品牌营销分析已生成" if data.get("generated") else "已返回内置模板；真实模型暂未完成", data, new_trace_id(), warnings=warnings, next_action=["检查模型路由配置后可再次生成"] if warnings else [])


@router.post("/api/brand-strategy/simulate")
def simulate_api(payload: dict):
    return api_response("ok", "大促经营模拟完成", simulate_campaign(payload), new_trace_id())


@router.post("/api/brand-strategy/intelligence/analyze")
def intelligence_analyze_api(payload: dict):
    return api_response("ok", "品牌营销智能分析完成", analyze_marketing_intelligence(payload), new_trace_id())


@router.post("/api/brand-strategy/brief/analyze")
def brief_analyze_api(payload: dict):
    intelligence = analyze_marketing_intelligence(payload)
    brief = build_marketing_planning_brief(payload, intelligence)
    reverse_acquisition = build_reverse_acquisition(payload, intelligence, brief)
    return api_response("ok", "营销规划 Brief 与用户逆向获客分析完成", {"intelligence": intelligence, "brief": brief, "reverse_acquisition": reverse_acquisition}, new_trace_id())


@router.get("/api/brand-strategy/workflow/contract")
def workflow_contract_api():
    return api_response("ok", "品牌营销业务与技术架构合同", workflow_contract())


@router.post("/api/brand-strategy/workflow/run")
def workflow_run_api(payload: dict):
    result = run_brand_workflow(payload)
    status = "ok" if result.get("status") == "ok" else result.get("status", "failed")
    return api_response(status, "品牌营销全链路执行完成" if status == "ok" else "品牌营销全链路执行未完成", result, new_trace_id(), warnings=[result.get("error", "")] if result.get("error") else [], next_action=["查看失败节点并补充输入后重试"] if status != "ok" else [])
