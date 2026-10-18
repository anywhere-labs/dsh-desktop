// getTintin — window.tintin 桥访问（自媒体包 useSettingsConfig 一比一拷贝，2026-10-17；独立域不交叉导入）
export function getTintin(): any {
  return (window as any).tintin
}
