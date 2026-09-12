from fastapi import APIRouter

from backend.app.core.response import api_response
from backend.app.registries.brand_data_registry import get_brand_data_agent, get_brand_data_skills
from backend.app.services.brand_data_collection_service import collection_contract, create_collection, get_collection, run_collection

router = APIRouter()


@router.get("/api/brand-data/contract")
def contract_api():
    return api_response("ok", "品牌数据采集 Agent / Skill 合同", collection_contract())


@router.get("/api/brand-data/skills")
def skills_api():
    return api_response("ok", "品牌数据采集能力列表", {"agent": get_brand_data_agent(), "skills": get_brand_data_skills()})


@router.post("/api/brand-data/collections")
def create_api(payload: dict):
    item = create_collection(payload)
    return api_response("ok" if not item["errors"] else "blocked", "品牌数据采集任务已创建", {"collection": item}, missing_inputs=item["errors"])


@router.post("/api/brand-data/collections/{collection_id}/run")
def run_api(collection_id: str):
    item = run_collection(collection_id)
    return api_response("ok" if item["status"] == "completed" else "blocked", "品牌数据采集完成" if item["status"] == "completed" else "品牌数据采集未通过质量门禁", {"collection": item}, warnings=item["errors"], next_action=["补充授权账号、公开来源链接或品牌声量观察后重试"] if item["status"] == "blocked" else [])


@router.get("/api/brand-data/collections/{collection_id}")
def get_api(collection_id: str):
    return api_response("ok", "品牌数据采集任务详情", {"collection": get_collection(collection_id)})
