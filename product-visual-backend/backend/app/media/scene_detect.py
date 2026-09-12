def detect_basic_segments(duration: float) -> list[dict]:
    if duration <= 0:
        return []
    return [{"start": 0, "end": min(duration, 30), "type": "full_preview"}]

