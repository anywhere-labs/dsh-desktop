from backend.app.video_generation.compositing import compose_with_original_audio


def test_compositing_contract_contains_audio_remux_and_pixel_preservation(tmp_path, monkeypatch):
    commands = []

    class Result:
        returncode = 0
        stderr = ""

    def fake_run(command, **kwargs):
        commands.append(command)
        output = command[-1]
        if "video-only" not in output:
            open(output, "wb").close()
        else:
            open(output, "wb").close()
        return Result()

    monkeypatch.setattr("backend.app.video_generation.compositing.subprocess.run", fake_run)
    result = compose_with_original_audio(tmp_path / "source.mp4", tmp_path / "bg.png", tmp_path / "frames", tmp_path / "out.mp4", 30)
    assert result["original_audio_remuxed"] is True
    assert result["preserve_original_pixels"] is True
    assert len(commands) == 2
    assert "-map" in commands[1] and "1:a?" in commands[1]
