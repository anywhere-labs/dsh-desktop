import json
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.testclient import TestClient
from .config import Settings
from .contracts import GenerateRequest
from .domain import TASK_STATES
from .providers import LibTvCliAdapter
from .repository import Repository
from .service import GenerationService
from .provider_config import ProviderConfigStore
from .provider_registry import ProviderRegistry
from .router import ProviderRouter
from .assets import AssetUploadService
from .commerce import PLATFORM_SPECS


def create_app(testing: bool = False, state_dir=None) -> TestClient | FastAPI:
    settings = Settings.from_env()
    if state_dir is not None: settings = Settings(**{**settings.__dict__, "state_dir": state_dir})
    repository = Repository(settings.state_dir); provider = LibTvCliAdapter(settings); configs = ProviderConfigStore(); registry = ProviderRegistry(settings, configs); router = ProviderRouter(registry, configs); service = GenerationService(settings, repository, provider, router)
    app = FastAPI(title="DSH Video Workbench API", version="0.3.0")
    app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET", "POST"], allow_headers=["content-type"])

    @app.get("/health")
    def health(): return {"status": "ok", "provider": provider.provider, "libtvBin": settings.libtv_bin, "libtvAvailable": provider.available()}

    @app.get("/ready")
    def ready():
        if not provider.available(): raise HTTPException(503, {"status": "blocked", "libtv": False})
        return {"status": "ready", "workspaceId": settings.workspace_id, "projectUuid": settings.project_uuid, "node": settings.node_key}

    @app.get("/api/video-workbench/capabilities")
    def capabilities(): return {"providers": router.descriptors(), "workspaceId": settings.workspace_id, "projectUuid": settings.project_uuid, "taskStates": list(TASK_STATES), "platformSpecs": PLATFORM_SPECS, "skills": [{"skillId": "video-scene-consistency", "status": "ACTIVE"}, {"skillId": "hook-analyzer", "status": "READY"}, {"skillId": "export-packager", "status": "STANDBY"}, {"skillId": "skill2loop", "status": "ACTIVE", "mergePolicy": "manual_review_required"}]}

    @app.get("/api/video-workbench/providers")
    def providers(): return {"providers": router.descriptors()}

    @app.get("/api/video-workbench/platform-specs")
    def platform_specs(): return {"platforms": PLATFORM_SPECS}

    @app.post("/api/video-workbench/preflight")
    def preflight(request: GenerateRequest): return service.preflight(request)

    @app.post("/api/video-workbench/generate", status_code=202)
    def generate(request: GenerateRequest, background_tasks: BackgroundTasks):
        check = service.preflight(request)
        if not check["allowed"]: raise HTTPException(400, check["errors"])
        job = service.create(request); background_tasks.add_task(service.execute, job["runId"], request); return job

    @app.get("/api/video-workbench/jobs/{run_id}")
    def job(run_id: str):
        value = repository.get(run_id)
        if not value: raise HTTPException(404, "video job not found")
        value["artifacts"] = repository.artifacts(run_id)
        return value

    @app.get("/api/video-workbench/jobs/{run_id}/artifacts")
    def artifacts(run_id: str):
        if not repository.get(run_id): raise HTTPException(404, "video job not found")
        return {"artifacts": repository.artifacts(run_id)}

    @app.get("/api/video-workbench/jobs/{run_id}/events")
    def events(run_id: str):
        if not repository.get(run_id): raise HTTPException(404, "video job not found")
        body = "".join(f"id: {event['id']}\nevent: task\ndata: {json.dumps(event, ensure_ascii=False)}\n\n" for event in repository.events(run_id)); return StreamingResponse(iter([body]), media_type="text/event-stream")

    @app.get("/api/video-workbench/loops/{skill_name}/metrics")
    def loop_metrics(skill_name: str): return service.loop.metrics(skill_name)

    @app.post("/api/video-workbench/loops/{skill_name}/propose")
    def loop_propose(skill_name: str): return service.loop.propose(skill_name)

    return TestClient(app) if testing else app
