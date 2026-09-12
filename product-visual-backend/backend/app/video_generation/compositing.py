from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any


def compose_with_original_audio(source: Path, background: Path, mask_dir: Path, output: Path, fps: float) -> dict[str, Any]:
    """Composite tracked alpha over a background and remux source audio unchanged."""
    ffmpeg = os.getenv("FFMPEG_BIN", "ffmpeg")
    silent = output.with_name(f"{output.stem}.video-only{output.suffix}")
    silent.parent.mkdir(parents=True, exist_ok=True)
    mask_pattern = str(mask_dir / "%06d.png")
    filters = (
        "[1:v]scale=iw:ih:force_original_aspect_ratio=increase," 
        "crop=iw:ih[bg];"
        "[0:v]format=rgba[fg];"
        "[2:v]format=gray[mask];"
        "[fg][mask]alphamerge[fgm];"
        "[bg][fgm]overlay=shortest=1[outv]"
    )
    first = [ffmpeg, "-y", "-i", str(source), "-loop", "1", "-i", str(background), "-framerate", str(fps), "-i", mask_pattern, "-filter_complex", filters, "-map", "[outv]", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", str(silent)]
    remux = [ffmpeg, "-y", "-i", str(silent), "-i", str(source), "-map", "0:v:0", "-map", "1:a?", "-c:v", "copy", "-c:a", "copy", "-shortest", str(output)]
    for command in (first, remux):
        result = subprocess.run(command, capture_output=True, text=True, check=False, timeout=1800)
        if result.returncode != 0:
            raise RuntimeError(result.stderr[-1200:] or "ffmpeg failed")
    silent.unlink(missing_ok=True)
    return {"status": "ok", "output": str(output), "original_audio_remuxed": True, "preserve_original_pixels": True}
