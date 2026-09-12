import React from "react";

type TimelineSegment = {
  start: number;
  end: number;
  text: string;
  sequence_no?: number;
  emphasis_tags?: string[];
  hook_candidate?: boolean;
};

function formatDuration(segment: TimelineSegment) {
  return `${Math.max(0, segment.end - segment.start).toFixed(3)}s`;
}

export function TranscriptTimelineLane({
  segments,
  selected,
}: {
  segments: TimelineSegment[];
  selected: number[];
}) {
  return (
    <section className="transcript-timeline-lane">
      <div className="transcript-timeline-head">
        <h4>字幕时间线概览</h4>
        <small>{segments.length} 条字幕片段</small>
      </div>
      <div className="transcript-lane-track">
        {segments.map((segment, index) => (
          <article
            className={selected.includes(index) ? "active" : ""}
            key={`${segment.sequence_no || index + 1}-${segment.start}`}
          >
            <strong>#{segment.sequence_no || index + 1}</strong>
            <span>{formatDuration(segment)}</span>
            <p>{segment.text}</p>
            <div>
              {segment.hook_candidate ? <em>hook</em> : null}
              {(segment.emphasis_tags || []).map((tag) => (
                <em key={`${segment.sequence_no || index + 1}-${tag}`}>{tag}</em>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
