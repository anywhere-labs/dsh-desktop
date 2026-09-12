from pathlib import Path


def write_basic_srt(path: Path, title: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"1\n00:00:00,000 --> 00:00:03,000\n{title}\n", encoding="utf-8")

