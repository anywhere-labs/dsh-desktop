import json
import subprocess
from pathlib import Path


class MediaQAService:
    def inspect(self, path: Path, expected_ratio: str = "9:16", expected_duration: float | None = 15) -> dict:
        result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,duration", "-of", "json", str(path)], capture_output=True, text=True, check=False)
        if result.returncode != 0: return {"status": "FAILED", "error": result.stderr[-2000:]}
        data = json.loads(result.stdout); streams = data.get("streams", []); video = next((s for s in streams if s.get("codec_type") == "video"), None)
        duration = float((data.get("format") or {}).get("duration") or 0)
        width, height = (video or {}).get("width", 0), (video or {}).get("height", 0)
        expected_width, expected_height = (map(int, expected_ratio.split(":", 1)) if ":" in expected_ratio else (0, 0))
        actual = width / height if height else 0; expected = expected_width / expected_height if expected_height else 0
        ratio_ok = bool(video and expected and abs(actual - expected) <= 0.02)
        duration_ok = expected_duration is None or abs(duration - expected_duration) <= 0.1
        return {"status": "PASS" if ratio_ok and duration_ok else "PARTIAL", "duration": duration, "ratio": f"{width}:{height}" if video else None, "ratioExpected": expected_ratio, "durationExpected": expected_duration, "streams": streams, "checks": {"video": bool(video), "ratio": ratio_ok, "duration": duration_ok}}
