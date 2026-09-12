from __future__ import annotations

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
STORAGE_DIR = PROJECT_ROOT / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
MATERIALS_DIR = STORAGE_DIR / "materials"
EXPORTS_DIR = STORAGE_DIR / "exports"
DEMO_DIR = STORAGE_DIR / "demo"
LOGS_DIR = STORAGE_DIR / "logs"
TMP_DIR = STORAGE_DIR / "tmp"


def ensure_dirs() -> None:
    for path in [STORAGE_DIR, UPLOADS_DIR, MATERIALS_DIR, EXPORTS_DIR, DEMO_DIR, LOGS_DIR, TMP_DIR]:
        path.mkdir(parents=True, exist_ok=True)


def rel_path(path: Path) -> str:
    return path.resolve().relative_to(PROJECT_ROOT).as_posix()

