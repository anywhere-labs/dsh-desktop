from dataclasses import dataclass
import os
import shutil
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    state_dir: Path
    artifact_dir: Path
    libtv_bin: str
    libtv_cwd: Path
    libtv_timeout_seconds: int
    workspace_id: str
    project_uuid: str
    node_key: str
    model_key: str
    cors_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        root = Path(os.getenv("VIDEO_WORKBENCH_STATE_DIR", "/data/video-workbench"))
        try:
            root.mkdir(parents=True, exist_ok=True)
        except OSError:
            root = Path.cwd() / ".video-workbench"
            root.mkdir(parents=True, exist_ok=True)
        return cls(root, Path(os.getenv("VIDEO_WORKBENCH_ARTIFACT_DIR", str(root / "artifacts"))), os.getenv("LIBTV_BIN", "").strip() or shutil.which("libtv") or str(Path.home() / ".libtv" / "libtv"), Path(os.getenv("LIBTV_CWD", os.getcwd())), int(os.getenv("LIBTV_TIMEOUT_SECONDS", "7200")), os.getenv("LIBTV_WORKSPACE_ID", "").strip(), os.getenv("LIBTV_PROJECT_UUID", "").strip(), os.getenv("LIBTV_NODE_KEY", "").strip(), os.getenv("LIBTV_MODEL_KEY", "").strip(), tuple(x.strip() for x in os.getenv("CORS_ORIGINS", "http://127.0.0.1:5173,http://127.0.0.1:5174,http://localhost:5173").split(",") if x.strip()))
