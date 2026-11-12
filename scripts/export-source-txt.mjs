/**
 * Source export tool.
 *
 * Concatenates this repository's own source files into one UTF-8 text file
 * (with a BOM so Windows editors detect UTF-8), one `// ===== FILE: … =====`
 * header per file. It decodes every file as **strict UTF-8** and only falls
 * back to GBK when the bytes are not valid UTF-8, so CJK text is never
 * mis-decoded into mojibake (the bug this tool previously had when its reader
 * used the platform ANSI codepage).
 *
 * Usage: node scripts/export-source-txt.mjs [outputPath]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const OUT = resolve(process.argv[2] ?? join(ROOT, 'dsh-desktop-source.txt'))
const EXCLUDE = /[\\/](node_modules|\.git|deepseek-harness|lib|dist|_deprecated|vendor|\.yarn)[\\/]/
const EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.yml', '.yaml'])
const UTF8 = new TextDecoder('utf-8', { fatal: true })
let GBK
try { GBK = new TextDecoder('gbk') } catch { GBK = undefined }

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (EXCLUDE.test(`${path}\\`)) continue
    if (entry.isDirectory()) walk(path, out)
    else if (entry.isFile() && EXTS.has(extname(entry.name)) && !entry.name.endsWith('.lock')) out.push(path)
  }
  return out
}

function decode(buffer) {
  let bytes = buffer
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) bytes = bytes.subarray(3)
  try { return { text: UTF8.decode(bytes), encoding: 'utf-8' } } catch { /* not UTF-8 */ }
  if (GBK !== undefined) { try { return { text: GBK.decode(bytes), encoding: 'gbk' } } catch { /* fall through */ } }
  return { text: bytes.toString('latin1'), encoding: 'latin1' }
}

const files = walk(ROOT).sort()
const parts = [
  '\uFEFF# DSH Desktop source export',
  '# encoding: UTF-8 (BOM); files decoded as strict UTF-8, GBK only as a fallback',
  '# scope: this repository\'s own packages (excludes node_modules/.git/deepseek-harness/lib/dist/vendor/_deprecated)',
]
let nonUtf8 = 0
let corrupted = 0
for (const file of files) {
  const { text, encoding } = decode(readFileSync(file))
  if (encoding !== 'utf-8') nonUtf8 += 1
  if (text.includes('\uFFFD')) corrupted += 1
  parts.push('', `// ===== FILE: ${relative(ROOT, file).replaceAll('\\', '/')} [${encoding}] =====`, text)
}
writeFileSync(OUT, `${parts.join('\n')}\n`, 'utf8')
console.log(`Wrote ${files.length} files to ${OUT} (non-utf8=${nonUtf8}, corrupted=${corrupted})`)
if (corrupted > 0) process.exit(1)
