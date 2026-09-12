from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from backend.app.contracts.opening_hook_contract import OpeningHookPlan, ProductMatch


HOOK_MARKERS = ("最怕", "不要", "别再", "为什么", "显瘦", "透气", "舒服", "到手", "只要", "解决")
PROOF_MARKERS = ("面料", "材质", "真丝", "桑蚕丝", "版型", "显瘦", "透气", "包住", "价格", "到手", "工艺", "不透")


def build_opening_hook_plan(
    job_id: str,
    result_json: dict[str, Any],
    product_profile: dict[str, Any] | None = None,
    *,
    completion_seconds: float = 5.0,
) -> dict[str, Any]:
    transcript = result_json.get("transcript") or {}
    segments = _segments(transcript)
    profile = product_profile or {}
    product_match = _match_product(segments, profile)
    hook = _select_hook(segments, product_match)
    proof = _select_proof(segments, hook, product_match, completion_seconds)
    failed: list[str] = []
    warnings: list[str] = []
    if transcript.get("status") != "completed" or not segments:
        failed.append("asr_transcript")
    if product_match.status != "matched":
        failed.append("product_identity")
    if not hook:
        failed.append("three_second_hook")
    if not proof:
        failed.append("five_second_proof")
    if not transcript.get("ass_file") or not Path(str(transcript["ass_file"])).is_file():
        failed.append("ass_artifact")
    if result_json.get("sfx_enabled") or result_json.get("enable_sfx"):
        failed.append("sfx_disabled")
    if product_match.status == "matched" and product_match.confidence < 1:
        warnings.append("商品身份已匹配，但仍建议人工核对 SKU、价格和颜色。")
    plan = OpeningHookPlan(
        plan_id=f"opening-hook::{job_id}",
        job_id=job_id,
        status="ready" if not failed else "blocked",
        opening={
            "hook": hook or {},
            "proof": proof or {},
            "transition_plan": {"type": "direct_cut", "audio_continuity_required": True},
            "subtitle_source": "canonical_transcript",
            "sfx_policy": "disabled",
        },
        product_match=product_match,
        failed_gates=failed,
        warnings=warnings,
    )
    return plan.model_dump(mode="json")


def evaluate_opening_hook_qa(plan: dict[str, Any], result_json: dict[str, Any]) -> dict[str, Any]:
    transcript = result_json.get("transcript") or {}
    hook = (plan.get("opening") or {}).get("hook") or {}
    proof = (plan.get("opening") or {}).get("proof") or {}
    checks = {
        "asr_completed": transcript.get("status") == "completed" and bool(transcript.get("segments")),
        "product_match": (plan.get("product_match") or {}).get("status") == "matched",
        "hook_duration": 0 < float(hook.get("duration") or 0) <= 3.0,
        "proof_duration": 0 < float(proof.get("duration") or 0) <= 5.0,
        "ass_alignment": _ass_matches_transcript(transcript),
        "sfx_disabled": not bool(result_json.get("sfx_enabled") or result_json.get("enable_sfx")),
        "source_ranges_traceable": bool(hook.get("source_segment_ids") and proof.get("source_segment_ids")),
    }
    failed = [key for key, passed in checks.items() if not passed]
    if "product_match" in failed:
        next_action = "请确认当前视频对应的 SKU、商品名、颜色和价格，再重新生成 shadow plan。"
    elif "proof_duration" in failed:
        next_action = "请补齐 3 秒钩子后的同 SKU 卖点证明，确保前 5 秒完成一个证据闭环。"
    elif "ass_alignment" in failed:
        next_action = "请重新生成与 canonical transcript 同时间轴的 ASS 字幕。"
    elif "source_ranges_traceable" in failed:
        next_action = "请让钩子和证明都回指真实 transcript segment。"
    else:
        next_action = "通过后才允许进入正式渲染"
    return {
        "status": "passed" if not failed else "blocked",
        "checks": checks,
        "failed_gates": failed,
        "next_action": next_action if failed else "可进入受控渲染验收",
    }


def _segments(transcript: dict[str, Any]) -> list[dict[str, Any]]:
    output = []
    for index, raw in enumerate(transcript.get("segments") or [], start=1):
        text = str(raw.get("text") or "").strip()
        start = float(raw.get("start") or 0)
        end = float(raw.get("end") or 0)
        if text and end > start:
            output.append({**raw, "segment_id": raw.get("segment_id") or f"seg_{index:04d}", "start": start, "end": end, "text": text})
    return output


def _match_product(segments: list[dict[str, Any]], profile: dict[str, Any]) -> ProductMatch:
    name = str(profile.get("product_name") or "").strip()
    terms = [name, *(str(item).strip() for item in profile.get("aliases") or [])]
    terms = [term for term in dict.fromkeys(terms) if term]
    if not terms:
        return ProductMatch(status="blocked", notes=["缺少商品名或 SKU，不能确认前三秒属于哪个商品。"])
    matches = [(segment, term) for segment in segments for term in terms if term in segment["text"]]
    if not matches:
        return ProductMatch(status="unverified", sku_id=str(profile.get("sku_id") or ""), product_name=name, confidence=0)
    return ProductMatch(
        status="matched",
        sku_id=str(profile.get("sku_id") or ""),
        product_name=name,
        matched_terms=sorted({term for _, term in matches}),
        evidence_segment_ids=sorted({segment["segment_id"] for segment, _ in matches}),
        confidence=1.0,
    )


def _select_hook(segments: list[dict[str, Any]], match: ProductMatch) -> dict[str, Any] | None:
    for start_index, segment in enumerate(segments):
        window = []
        for candidate in segments[start_index:]:
            if candidate["end"] - segment["start"] > 3.0:
                break
            window.append(candidate)
            text = "".join(item["text"] for item in window)
            if candidate["end"] - segment["start"] >= 1.2 and any(marker in text for marker in HOOK_MARKERS):
                return _window(window, "hook")
    return None


def _select_proof(segments: list[dict[str, Any]], hook: dict[str, Any] | None, match: ProductMatch, completion_seconds: float) -> dict[str, Any] | None:
    if not hook:
        return None
    hook_end = float(hook["source_end"])
    selected = []
    for segment in segments:
        if segment["start"] < hook_end:
            continue
        if segment["end"] - float(hook["source_start"]) > completion_seconds:
            break
        selected.append(segment)
        text = "".join(item["text"] for item in selected)
        if any(marker in text for marker in PROOF_MARKERS) and segment["end"] > hook_end:
            return _window(selected, "proof")
    return None


def _window(segments: list[dict[str, Any]], kind: str) -> dict[str, Any]:
    return {
        "kind": kind,
        "source_segment_ids": [item["segment_id"] for item in segments],
        "source_start": segments[0]["start"],
        "source_end": segments[-1]["end"],
        "duration": round(segments[-1]["end"] - segments[0]["start"], 3),
        "text": " ".join(item["text"] for item in segments),
    }


def _ass_matches_transcript(transcript: dict[str, Any]) -> bool:
    path = transcript.get("ass_file")
    if not path or not Path(str(path)).is_file():
        return False
    lines = Path(str(path)).read_text(encoding="utf-8", errors="replace").splitlines()
    dialogue_count = sum(line.startswith("Dialogue:") for line in lines)
    return dialogue_count >= len(transcript.get("segments") or []) > 0
