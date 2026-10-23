/**
 * shell 页的启动错误浮层(2026-10-23): 任何加载/运行错误直接上屏 —— 黑屏无声的教训。
 * index.html 的内联脚本先注册 window.__tintinBootFail; 这里提供同签名的兜底出口。
 */
const bootFail = (message: string): void => {
  const show = (window as unknown as { __tintinBootFail?: (message: string) => void }).__tintinBootFail;
  if (typeof show === 'function') show(message);
};
export { bootFail };
