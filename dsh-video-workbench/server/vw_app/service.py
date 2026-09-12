import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from .config import Settings
from .contracts import GenerateRequest
from .providers import LibTvCliAdapter, extract_output_url
from .repository import Repository
from .loop import Skill2LoopBridge
from .router import ProviderRouter
from .domain import assert_transition
from .assets import AssetUploadService
from .commerce import CommerceVideoPackager, PLATFORM_SPECS
from .media_qa import MediaQAService


def timestamp() -> str: return datetime.now(timezone.utc).isoformat()


class GenerationService:
    def __init__(self, settings: Settings, repository: Repository, provider: LibTvCliAdapter, router: ProviderRouter | None = None):
        self.settings, self.repository, self.provider, self.loop, self.router = settings, repository, provider, Skill2LoopBridge(settings.state_dir), router
        self.assets, self.qa, self.packager = AssetUploadService(), MediaQAService(), CommerceVideoPackager()

    def preflight(self, request: GenerateRequest) -> dict[str, Any]:
        errors = []
        if not request.projectId.strip() and not self.settings.project_uuid: errors.append("projectId/projectUuid is required")
        if not request.node.strip() and not self.settings.node_key: errors.append("node is required")
        if request.confirmed is not True: errors.append("confirmed=true is required")
        if not request.approvalId or not request.approvalId.strip(): errors.append("approvalId is required")
        if any(not asset.authorized for asset in request.assets): errors.append("all assets must be authorized")
        errors.extend(self.assets.validate([asset.model_dump() for asset in request.assets]))
        selected = request.providerId or "libtv-cli"
        adapter = self.router.resolve(selected) if self.router else self.provider
        if adapter is None: errors.append(f"unknown provider: {selected}")
        if selected != "libtv-cli" and adapter is not None and not adapter.available(): errors.append("third-party provider is not configured")
        command = self.provider.command(request.projectId or self.settings.project_uuid, request.node or self.settings.node_key) if selected == "libtv-cli" else [selected, "generate"]
        return {"allowed": not errors, "errors": errors, "provider": selected, "workspaceId": request.workspaceId or self.settings.workspace_id, "wouldRun": command}

    def create(self, request: GenerateRequest) -> dict[str, Any]:
        project = request.projectId.strip() or self.settings.project_uuid; workspace = request.workspaceId.strip() or self.settings.workspace_id; node = request.node.strip() or self.settings.node_key
        key = request.idempotencyKey or f"{workspace}:{project}:{node}:{uuid.uuid4().hex}"
        existing = self.repository.find_key(key)
        if existing: return existing
        now = timestamp(); job = {"runId": f"vw_{uuid.uuid4().hex[:18]}", "idempotencyKey": key, "state": "QUEUED", "workspaceId": workspace, "projectId": project, "node": node, "provider": request.providerId or "libtv-cli", "createdAt": now, "updatedAt": now}
        self.repository.create_job(job, request.model_dump_json(), [a.model_dump() for a in request.assets]); return job

    def execute(self, run_id: str, request: GenerateRequest) -> None:
        job = self.repository.get(run_id)
        if not job: return
        assert_transition(job["state"], "GENERATING")
        selected = request.providerId or "libtv-cli"; adapter = self.router.resolve(selected) if self.router else self.provider
        if adapter is None: self.repository.update(run_id, "FAILED", timestamp(), error=f"unknown provider: {selected}", detail="provider resolve failed"); return
        self.repository.update(run_id, "GENERATING", timestamp(), detail=f"{selected} started")
        try:
            provider_args = (request.model_dump(),) if selected != "libtv-cli" else ()
            code, stdout, stderr = adapter.run(request.projectId.strip() or self.settings.project_uuid, request.node.strip() or self.settings.node_key, *provider_args)
        except (OSError, subprocess.TimeoutExpired) as cause:
            self.repository.update(run_id, "FAILED", timestamp(), error=str(cause)[-4000:], detail="libtv CLI process error")
            self.loop.record_episode(run_id=run_id, skill_name="video-scene-consistency", status="failed", provider=selected, model=request.model, trace=[{"stage":"provider","detail":str(cause)}])
            return
        self.repository.receipt(run_id, code, stdout, stderr, timestamp())
        if code != 0 and selected == "libtv-cli" and self.router:
            error = (stderr.strip() or stdout.strip() or f"libtv exited with code {code}")[-4000:]
            fallback = self.router.fallback.choose(self.router.descriptors(), selected) if self.router.fallback.can_fallback(error) else None
            if fallback and (fallback_adapter := self.router.resolve(fallback["providerId"])) is not None and fallback_adapter.available():
                selected = fallback["providerId"]
                self.repository.update(run_id, "GENERATING", timestamp(), error=error, detail=f"libtv failed; fallback selected: {selected}")
                code, stdout, stderr = fallback_adapter.run(request.projectId.strip() or self.settings.project_uuid, request.node.strip() or self.settings.node_key, request.model_dump())
                self.repository.receipt(run_id, code, stdout, stderr, timestamp())
            else:
                self.repository.update(run_id, "FAILED", timestamp(), error=error, detail="libtv CLI failed; no configured fallback")
                self.loop.record_episode(run_id=run_id, skill_name="video-scene-consistency", status="failed", provider=selected, model=request.model, trace=[{"stage":"provider","detail":error}])
                return
        if code != 0:
            error = (stderr.strip() or stdout.strip() or f"{selected} exited with code {code}")[-4000:]
            self.repository.update(run_id, "FAILED", timestamp(), error=error, detail=f"{selected} failed")
            self.loop.record_episode(run_id=run_id, skill_name="video-scene-consistency", status="failed", provider=selected, model=request.model, trace=[{"stage":"provider","detail":error}])
            return
        output = stdout.strip(); output_url = extract_output_url(output)
        self.repository.update(run_id, "POST_PROCESSING", timestamp(), output=output, output_url=output_url, detail=f"{selected} completed")
        self.repository.update(run_id, "QA_RUNNING", timestamp(), detail="media QA started")
        qa, packaged = self._qa_and_package(run_id, output, request)
        self.repository.update(run_id, "COMPLETED", timestamp(), detail=f"provider result accepted; qa={qa['status']}; publication remains manual")
        self.loop.record_episode(run_id=run_id, skill_name="video-scene-consistency", status="completed", provider=selected, model=request.model, trace=[{"stage":"provider","detail":"provider completed"},{"stage":"qa","detail":qa["status"]},{"stage":"package","detail":"created" if packaged else "deferred: remote output"}])

    def _qa_and_package(self, run_id: str, output: str, request: GenerateRequest) -> tuple[dict[str, Any], bool]:
        payload: Any = {}
        try: payload = __import__("json").loads(output)
        except (TypeError, ValueError): pass
        output_data = payload.get("output") if isinstance(payload, dict) else {}
        if not isinstance(output_data, dict): output_data = {}
        candidate = payload.get("outputPath") or output_data.get("path") or output_data.get("file") if isinstance(payload, dict) else None
        if not candidate or not Path(candidate).exists():
            self.repository.artifact(run_id, "provider-output", extract_output_url(output) or "provider://output", "PENDING_EXTERNAL_DOWNLOAD", {"qa": "local file unavailable", "publication": "manual_confirmation_required"}, timestamp())
            return {"status": "PENDING_EXTERNAL_DOWNLOAD"}, False
        platform = str(request.settings.get("platform", "douyin")); spec = PLATFORM_SPECS.get(platform, PLATFORM_SPECS["douyin"])
        qa = self.qa.inspect(Path(candidate), expected_ratio=spec["ratios"][0], expected_duration=spec["maxDurationSeconds"])
        destination = self.settings.artifact_dir / run_id / platform
        packaged = self.packager.package(Path(candidate), {"platform": platform, "spec": spec, "qa": qa, "assets": self.assets.manifest([a.model_dump() for a in request.assets])}, destination)
        self.repository.artifact(run_id, "commerce-video", packaged["artifact"], qa["status"], {"manifest": str(destination / "manifest.json"), "platform": platform, "qa": qa}, timestamp())
        return qa, True
