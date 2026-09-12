from backend.app.video_generation.qa import evaluate_composite


def test_qa_fails_closed_when_output_is_missing(tmp_path):
    result = evaluate_composite(tmp_path / "source.mp4", tmp_path / "missing.mp4")
    assert result["status"] == "fail"
    assert result["failures"][0]["code"] == "output_missing"
