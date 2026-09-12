from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from backend.app.adapters.speech_transcription_adapter import _write_artifacts
from backend.app.core.paths import PROJECT_ROOT
from backend.app.media.ffmpeg_service import resolve_binary


def build_timestamp_segments(vad_ranges: list[list[int]], texts: list[str]) -> list[dict]:
    segments: list[dict] = []
    for time_range, text in zip(vad_ranges, texts):
        clean = str(text).strip()
        if not clean or len(time_range) < 2:
            continue
        start = max(0.0, float(time_range[0]) / 1000)
        end = max(start + 0.2, float(time_range[1]) / 1000)
        segments.append({"start": start, "end": end, "text": clean})
    return segments


def split_vad_ranges(vad_ranges: list[list[int]], max_ms: int = 30000) -> list[list[int]]:
    chunks: list[list[int]] = []
    for start, end in vad_ranges:
        cursor = int(start)
        end = int(end)
        while end - cursor >= 200:
            chunk_end = min(end, cursor + max_ms)
            if chunk_end - cursor < 200:
                break
            chunks.append([cursor, chunk_end])
            cursor = chunk_end
    return chunks


class FunASRTranscriptionAdapter:
    def __init__(
        self,
        model_dir: str | Path | None = None,
        vad_model_dir: str | Path | None = None,
        device: str = "cuda:0",
    ) -> None:
        self.model_dir = Path(model_dir or PROJECT_ROOT / "runtime" / "models" / "funasr" / "SenseVoiceSmall")
        self.vad_model_dir = Path(vad_model_dir or PROJECT_ROOT / "runtime" / "models" / "funasr" / "fsmn-vad")
        self.device = device

    def transcribe(self, media_path: str | Path, output_path: str | Path) -> dict:
        import soundfile as sf
        from funasr import AutoModel
        from funasr.utils.postprocess_utils import rich_transcription_postprocess

        media = Path(media_path)
        output = Path(output_path).with_suffix("")
        wav_path = output.with_suffix(".funasr.wav")
        _extract_audio(media, wav_path)

        vad = AutoModel(model=str(self.vad_model_dir), device=self.device, disable_update=True)
        vad_result = vad.generate(input=str(wav_path))
        vad_ranges = split_vad_ranges(_vad_ranges(vad_result))
        texts: list[str] = []
        asr = AutoModel(model=str(self.model_dir), device=self.device, disable_update=True)
        with sf.SoundFile(wav_path) as audio:
            sample_rate = audio.samplerate
            if not vad_ranges:
                vad_ranges = [[0, round((len(audio) / sample_rate) * 1000)]]
            for start_ms, end_ms in vad_ranges:
                start_frame = max(0, round(start_ms * sample_rate / 1000))
                frame_count = max(1, round((end_ms - start_ms) * sample_rate / 1000))
                audio.seek(start_frame)
                chunk = audio.read(frame_count, dtype="float32", always_2d=False)
                result = asr.generate(
                    input=chunk,
                    cache={},
                    language="zh",
                    use_itn=True,
                    batch_size_s=60,
                )
                raw_text = result[0].get("text", "") if result else ""
                texts.append(rich_transcription_postprocess(raw_text).strip())

        segments = build_timestamp_segments(vad_ranges, texts)
        result = {
            "text": " ".join(item["text"] for item in segments),
            "segments": segments,
            "provider": "funasr",
            "language": "zh",
            "device": self.device,
            "model": "SenseVoiceSmall",
            "warnings": [],
        }
        _write_artifacts(output, result)
        wav_path.unlink(missing_ok=True)
        return result


def _vad_ranges(result: Any) -> list[list[int]]:
    if not result or not isinstance(result, list):
        return []
    value = result[0].get("value", []) if isinstance(result[0], dict) else []
    return [
        [int(item[0]), int(item[1])]
        for item in value
        if isinstance(item, (list, tuple)) and len(item) >= 2 and float(item[1]) > float(item[0])
    ]


def _extract_audio(media_path: Path, wav_path: Path) -> None:
    ffmpeg = resolve_binary("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg is required for FunASR audio extraction")
    wav_path.parent.mkdir(parents=True, exist_ok=True)
    process = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(media_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-y",
            str(wav_path),
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=1800,
        shell=False,
    )
    if process.returncode != 0 or not wav_path.is_file() or wav_path.stat().st_size <= 44:
        raise RuntimeError(f"FunASR audio extraction failed: {process.stderr[-400:]}")
