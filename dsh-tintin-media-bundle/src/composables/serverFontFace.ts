// ═══════════════════════════════════════════════════════════════
// serverFontFace — 服务端字体 FontFace 注册 + 下拉/预览自渲染设施
// （module 级单例；机制与 useCopywritingMontageStep3Voice 内联版同款——
//   该文件基线窗口期暂不收编，document.fonts 按族名去重，双注册无害）。
// fontId → 服务端族名（CSS font-family 回退链用）；FontFace 注册为
// 'stfont_<id>' 独立族名，避免与本地同名字体冲突；版本号驱动样式重算。
// ═══════════════════════════════════════════════════════════════
import { ref } from 'vue'

const serverFontFamilies = new Map<string, string>()
const fontFaceLoaded = new Set<string>()
const fontFacePending = new Set<string>()
const fontFacesVersion = ref(0)

/** 字体列表装载时记录 id→族名（构建 font-family 回退链用） */
export function registerServerFontFamily(fid: string, family: string): void {
  if (fid && family) serverFontFamilies.set(fid, family)
}

/**
 * 预载服务端字体文件并注册 FontFace（GET /config/fonts/{id}/file）。
 * 2026-09-24 修复（Step3Voice 同款）：不走桥通道——字体是二进制大对象，
 * 桥的 sendJson 会把字节 JSON.stringify 成数字数组文本（几十 MB 字体 →
 * 数百 MB 字符串，超 V8 上限抛 Invalid string length）。渲染层直连服务端
 * URL，FontFace 接受 url 引用，按 fid 派生去重。
 */
export async function ensureServerFontFace(fid: string): Promise<void> {
  if (!fid || fontFaceLoaded.has(fid) || fontFacePending.has(fid)) return
  fontFacePending.add(fid)
  try {
    const ping = await window.tintin?.env?.serverPing?.()
    const base = String(ping?.url || '').replace(/\/$/, '')
    if (!base) return
    const url = `${base}/config/fonts/${encodeURIComponent(fid)}/file`
    const ff = new FontFace(`stfont_${fid}`, `url(${JSON.stringify(url)})`)
    await ff.load()
    document.fonts.add(ff)
    fontFaceLoaded.add(fid)
    fontFacesVersion.value++
  } catch (_) {
    // 字体文件拉取失败：保留族名回退链，不阻断 UI
  } finally {
    fontFacePending.delete(fid)
  }
}

/** 字体选项的 CSS font-family（stfont_ 注册族 → 服务端族名 → sans-serif） */
export function fontOptionCssFamily(fid: string): string {
  if (!fid) return ''
  const family = (serverFontFamilies.get(fid) || '').replace(/'/g, '')
  return `'stfont_${fid}'${family ? `, '${family}'` : ''}, sans-serif`
}

/** TSelect optionStyle：字体下拉/触发器按所选字体自渲染；顺带惰性预载字体文件 */
export function fontOptionStyle(opt: { label: string; value: string | number }): Record<string, string> | undefined {
  const fid = String(opt.value || '')
  if (!fid) return undefined
  void fontFacesVersion.value
  void ensureServerFontFace(fid)
  return { fontFamily: fontOptionCssFamily(fid) }
}

/** computed 内 void 读一次即可注册依赖（字体注册完成后触发样式重算） */
export function serverFontFacesVersion(): number {
  return fontFacesVersion.value
}
