"""Local skill2loop-compatible feedback loop for video production episodes.

The loop creates evidence and reviewable proposals. It never mutates a Skill,
changes a Provider, or retries a billable generation by itself.
"""
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class Skill2LoopBridge:
    def __init__(self, root: Path):
        self.root = root / "skill2loop"
        self.root.mkdir(parents=True, exist_ok=True)

    def record_episode(self, *, run_id: str, skill_name: str, status: str, provider: str, model: str | None, trace: list[dict[str, Any]], feedback: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        episode = {"run_id": run_id, "skill_name": skill_name, "skill_version": "1.0.0", "status": status, "provider": provider, "model": model, "created_at": datetime.now(timezone.utc).isoformat(), "trace": trace, "feedback": feedback or []}
        path = self.root / "episodes" / f"{run_id}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(episode, ensure_ascii=False, indent=2), encoding="utf-8")
        return episode

    def metrics(self, skill_name: str) -> dict[str, Any]:
        episodes = self._episodes(skill_name)
        accepted = [item for item in episodes if item["status"] == "accepted"]
        labels = Counter(label for item in episodes for feedback in item.get("feedback", []) for label in feedback.get("labels", []))
        return {"skill_name": skill_name, "episode_count": len(episodes), "acceptance_rate": round(len(accepted) / len(episodes), 4) if episodes else 0, "feedback_count": sum(len(item.get("feedback", [])) for item in episodes), "top_feedback_labels": [{"label": k, "count": v} for k, v in labels.most_common(10)]}

    def propose(self, skill_name: str) -> dict[str, Any]:
        metrics = self.metrics(skill_name)
        episodes = self._episodes(skill_name)
        failures = [item for item in episodes if item["status"] not in ("accepted", "completed")]
        proposal = {"skill_name": skill_name, "created_at": datetime.now(timezone.utc).isoformat(), "status": "待人工审核" if failures else "观察中", "evidence": {"metrics": metrics, "failed_episode_ids": [item["run_id"] for item in failures]}, "recommendations": [{"target": "ProviderPreflight", "action": "将失败原因纳入 Provider 路由和预检分类，不自动重试未知错误。"}] if failures else [], "merge_policy": "manual_review_required"}
        path = self.root / "proposals" / f"{skill_name}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(proposal, ensure_ascii=False, indent=2), encoding="utf-8")
        return proposal

    def _episodes(self, skill_name: str) -> list[dict[str, Any]]:
        episodes = []
        for path in sorted((self.root / "episodes").glob("*.json")) if (self.root / "episodes").exists() else []:
            item = json.loads(path.read_text(encoding="utf-8"))
            if item.get("skill_name") == skill_name: episodes.append(item)
        return episodes
