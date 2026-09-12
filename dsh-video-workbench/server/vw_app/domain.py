TASK_STATES = ("DRAFT", "ANALYZING", "READY", "AWAITING_APPROVAL", "QUEUED", "GENERATING", "POST_PROCESSING", "QA_RUNNING", "COMPLETED", "PARTIAL", "FAILED")
ALLOWED = {"QUEUED": {"GENERATING", "FAILED"}, "GENERATING": {"POST_PROCESSING", "PARTIAL", "FAILED"}, "POST_PROCESSING": {"QA_RUNNING", "PARTIAL", "FAILED"}, "QA_RUNNING": {"COMPLETED", "PARTIAL", "FAILED"}}


def assert_transition(current: str, target: str) -> None:
    if target not in ALLOWED.get(current, set()): raise ValueError(f"illegal task transition: {current} -> {target}")
