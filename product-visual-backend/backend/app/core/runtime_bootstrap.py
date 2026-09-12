from __future__ import annotations

import os
from pathlib import Path

from backend.app.core.paths import PROJECT_ROOT

_DLL_HANDLES: list[object] = []
_CONFIGURED = False


def project_runtime_paths(root: Path = PROJECT_ROOT) -> list[Path]:
    python_dir = root / "runtime" / "python"
    return [
        root / "runtime" / "cuda" / "bin",
        python_dir / "Lib" / "site-packages" / "torch" / "lib",
        python_dir,
        python_dir / "Scripts",
    ]


def configure_project_runtime(root: Path = PROJECT_ROOT) -> list[str]:
    global _CONFIGURED
    paths = [path.resolve() for path in project_runtime_paths(root) if path.is_dir()]
    if _CONFIGURED:
        return [str(path) for path in paths]

    current = os.environ.get("PATH", "").split(os.pathsep)
    normalized = {os.path.normcase(item) for item in current if item}
    prepend = [str(path) for path in paths if os.path.normcase(str(path)) not in normalized]
    os.environ["PATH"] = os.pathsep.join(prepend + current)

    if hasattr(os, "add_dll_directory"):
        for path in paths[:2]:
            _DLL_HANDLES.append(os.add_dll_directory(str(path)))
    _CONFIGURED = True
    return [str(path) for path in paths]
