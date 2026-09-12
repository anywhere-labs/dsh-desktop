export function FileUploader({ onFile }: { onFile: (file: File) => void }) {
  return <input className="file-input" type="file" accept="video/*" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />;
}
