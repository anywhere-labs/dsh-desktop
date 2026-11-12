/**
 * Encoding / mojibake guard.
 *
 * Fails when a source file in this repository is not valid UTF-8, or contains a
 * replacement character or a classic mojibake marker. The tree is kept uniformly
 * UTF-8 so delivered source (and the source export tool) never ships garbled
 * CJK. The pinned upstream submodule, build output, and dependencies are out of
 * scope.
 *
 * Usage: node scripts/check-mojibake.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const EXCLUDE = /[\\/](node_modules|\.git|deepseek-harness|lib|dist|_deprecated|vendor|\.yarn)[\\/]/
const EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.yml', '.yaml', '.md', '.css', '.html'])
const MARKERS = ['\uFFFD', '锟斤拷', 'ï¿½', 'â€', 'Ã©', 'Ã¨', 'Â ', 'ã€']
const UTF8 = new TextDecoder('utf-8', { fatal: true })

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (EXCLUDE.test(`${path}\\`)) continue
    if (entry.isDirectory()) walk(path, out)
    else if (entry.isFile() && EXTS.has(extname(entry.name)) && !entry.name.endsWith('.lock')) out.push(path)
  }
  return out
}

const files = walk(ROOT)
const problems = []
for (const file of files) {
  if (file === SELF) continue
  let bytes = readFileSync(file)
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) bytes = bytes.subarray(3)
  let text
  try {
    text = UTF8.decode(bytes)
  } catch {
    problems.push([relative(ROOT, file).replaceAll('\\', '/'), 'not valid UTF-8'])
    continue
  }
  const marker = MARKERS.find(candidate => text.includes(candidate))
  if (marker !== undefined) problems.push([relative(ROOT, file).replaceAll('\\', '/'), `mojibake marker ${JSON.stringify(marker)}`])
}

if (problems.length > 0) {
  console.error(`Encoding check failed: ${problems.length} problem(s).`)
  for (const [file, reason] of problems) console.error(`  ${file} — ${reason}`)
  process.exit(1)
}
console.log(`Encoding OK: ${files.length} files valid UTF-8, no mojibake markers.`)
