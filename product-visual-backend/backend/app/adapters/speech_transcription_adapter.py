from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any


ModelFactory = Callable[..., Any]


class SpeechTranscriptionAdapter:
    def __init__(
        self,
        model_factory: ModelFactory | None = None,
        cuda_available: Callable[[], bool] | None = None,
        model_name: str = "small",
    ) -> None:
        self._model_factory = model_factory or _default_model_factory
        self._cuda_available = cuda_available or _cuda_available
        self._model_name = model_name

    def transcribe(self, media_path: str | Path, output_path: str | Path) -> dict:
        warnings: list[str] = []
        if self._cuda_available():
            try:
                segments, info = self._run(media_path, device="cuda", compute_type="float16")
            except Exception as exc:
                warnings.append(
                    f"CUDA transcription failed; retried with CPU int8: {exc}"
                )
                segments, info = self._run(
                    media_path, device="cpu", compute_type="int8"
                )
        else:
            segments, info = self._run(media_path, device="cpu", compute_type="int8")

        normalized_segments = [
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "text": str(segment.text).strip(),
            }
            for segment in segments
        ]
        result = {
            "text": " ".join(
                segment["text"] for segment in normalized_segments if segment["text"]
            ),
            "segments": normalized_segments,
            "provider": "faster-whisper",
            "language": getattr(info, "language", None),
            "warnings": warnings,
        }
        _write_artifacts(Path(output_path), result)
        return result

    def _run(
        self, media_path: str | Path, *, device: str, compute_type: str
    ) -> tuple[list[Any], Any]:
        model = self._model_factory(
            self._model_name,
            device=device,
            compute_type=compute_type,
        )
        segments, info = model.transcribe(
            str(media_path),
            language="zh",
            vad_filter=True,
            word_timestamps=True,
            beam_size=3,
        )
        return list(segments), info


def _default_model_factory(model_name: str, **kwargs: Any) -> Any:
    from faster_whisper import WhisperModel

    return WhisperModel(model_name, **kwargs)


def _cuda_available() -> bool:
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except (ImportError, RuntimeError):
        return False


def _write_artifacts(output_path: Path, result: dict) -> None:
    base_path = output_path.with_suffix("") if output_path.suffix else output_path
    base_path.parent.mkdir(parents=True, exist_ok=True)
    base_path.with_suffix(".txt").write_text(
        f"{result['text']}\n", encoding="utf-8"
    )
    base_path.with_suffix(".srt").write_text(
        _segments_to_srt(result["segments"]), encoding="utf-8"
    )
    base_path.with_suffix(".json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _segments_to_srt(segments: list[dict]) -> str:
    blocks = [
        (
            f"{index}\n"
            f"{_srt_time(segment['start'])} --> {_srt_time(segment['end'])}\n"
            f"{segment['text']}"
        )
        for index, segment in enumerate(segments, start=1)
    ]
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def _srt_time(seconds: float) -> str:
    milliseconds = max(0, int(round(seconds * 1000)))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
