# video_background_replication_skill

## Purpose

Replace the background of an original short video while preserving the original foreground pixels, motion, lip movement, product appearance, and audio.

## Hard boundaries

- Do not regenerate the person, product, action, lip movement, or audio.
- Do not use video-to-video, face swap, digital human, lip-sync, or TTS as the primary path.
- Keep the original video and audio immutable; write all artifacts to a task-scoped output directory.
- A QA failure blocks delivery and must identify the responsible stage for repair.

## Pipeline contract

```text
source video
  -> shot detection
  -> user/agent object selection
  -> temporal tracking
  -> human matte + product edge refinement
  -> camera-motion-matched background
  -> alpha composite
  -> original-audio remux
  -> visual and media QA
  -> delivery only on PASS
```

## Provider boundary

An image provider may generate a replacement background only. A video provider may not rewrite the preserved foreground in this workflow.

## Required evidence

- source media probe;
- selected object records;
- mask and matte artifact references;
- composite and remux media probe;
- QA report with PASS/FAIL checks;
- repair task when any critical check fails.
