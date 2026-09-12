FALLBACK_ERRORS = ("算力不足", "compute unavailable", "capacity", "temporarily unavailable")


class ProviderFallbackPolicy:
    def can_fallback(self, error: str, submitted: bool = False) -> bool:
        if submitted: return False
        lowered = error.lower()
        return any(marker.lower() in lowered for marker in FALLBACK_ERRORS)

    def choose(self, providers: list[dict], failed_provider: str) -> dict | None:
        candidates = [p for p in providers if p.get("enabled") and p.get("providerId") != failed_provider]
        return sorted(candidates, key=lambda p: p.get("priority", 100))[0] if candidates else None
