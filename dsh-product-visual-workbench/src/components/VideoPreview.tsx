export function VideoPreview({ src }: { src?: string }) {
  if (!src) return <div className="empty">暂无预览</div>;
  return <video src={src} controls style={{ width: "100%" }} />;
}

