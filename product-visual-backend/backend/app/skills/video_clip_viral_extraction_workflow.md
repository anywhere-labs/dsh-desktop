# video_clip_viral_extraction Workflow

The public UI name remains `直播切片分发工作台`.

## Output Contract
Each run must expose:

- MP4 final clips
- SRT subtitle files
- Cover frames
- Clip report
- Trace file containing `qa_result`
- Jianying project exchange files
- Unified QA fields on every clip and on the task result

## Button Gate Contract
- Submit review: enabled only when at least one final video exists and `qa_status=passed`
- Export final video: enabled when `final_video_exists=true` and QA is passed or warning-only
- Export Jianying project: enabled when all Jianying QA checks are true
- Retry: enabled when `qa_retry_required=true`
