/** Exercise the installed plugin detail document selection: Chinese and English README translations of packages without `meta.detail`. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const DETAIL = '@deepseek-ai/dsh-plugin-detail'
// Bundles Beta lists whose release declares no `meta.detail` but ships `README.zh.md`.
const README_BUNDLES = ['@deepseek-ai/dsh-experimental-liveshare', '@deepseek-ai/dsh-experimental-forge-bundle']
// The display languages the 0.2.2 Client offers.
const DISPLAY_LANGUAGES = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt']
const CHINESE_NAMES = ['README.zh.md', 'README.zh-CN.md', 'README-zh.md', 'README-zh-CN.md', 'README_zh.md', 'README_ZH.md', 'README_CN.md']
const ENGLISH_NAMES = ['README.en.md', 'README.en-US.md', 'README-en.md', 'README_en.md', 'README_EN.md']
const CHINESE = '# 中文说明\n'
const ENGLISH = '# English\n'
const notInstalled = 'runtime dependencies are not installed; run corepack yarn install'

function installed(require, specifier) {
  try {
    return require.resolve(specifier)
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(`'${specifier}'`)) return undefined
    throw error
  }
}

/**
 * Write a package into a directory.
 * @param dir - the package directory.
 * @param files - file contents by `/`-separated path.
 * @returns the directory.
 */
function writePackage(dir, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

/**
 * The same value for every display language but some.
 * @param value - the value of the other languages.
 * @param exceptions - values by language.
 * @returns values by display language.
 */
function byLanguage(value, exceptions = {}) {
  return Object.fromEntries(DISPLAY_LANGUAGES.map(language => [language, exceptions[language] ?? value]))
}

// Stable (0.2.1-rc.3) and Next (0.2.1-rc.5) predate bundle detail documents; a workspace whose plugin manager reads
// them must carry the patch.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const require = createRequire(resolve(workspace, 'package.json'))
  const manager = installed(require, '@deepseek-ai/dsh-plugin-manager/package.json')
  if (manager !== undefined && !Object.hasOwn(JSON.parse(readFileSync(manager, 'utf8')).dependencies ?? {}, DETAIL)) continue
  test(`${workspace}: plugin detail pages show a Chinese or English README translation`, {
    skip: manager === undefined && notInstalled,
  }, async t => {
    // The Plugins page reads through the plugin manager's copy; market entry pages must load the same one.
    const entry = createRequire(manager).resolve(DETAIL)
    const market = installed(require, '@deepseek-ai/dsh-plugin-market/package.json')
    if (market !== undefined) assert.equal(createRequire(market).resolve(DETAIL), entry)
    const { languageChain, localFiles, npmFiles, readPackageDocument } = await import(pathToFileURL(entry).href)
    const read = (files, language) => readPackageDocument(files, '', languageChain(language), 1024 * 1024, AbortSignal.timeout(10_000))
    const root = mkdtempSync(join(tmpdir(), 'dsh-plugin-detail-compat-'))
    t.after(() => { rmSync(root, { recursive: true, force: true }) })
    let packages = 0
    const local = files => localFiles(writePackage(join(root, String(packages++)), files), '1.0.0')
    // A case-insensitive file system reads `README_ZH.md` by the name `README_zh.md`, so local reads compare documents.
    const documents = async files => Object.fromEntries(await Promise.all(DISPLAY_LANGUAGES.map(async language => [
      language, (await read(files, language))?.markdown,
    ])))

    await t.test('reads a Chinese translation for a Chinese display language', async () => {
      for (const name of CHINESE_NAMES) {
        const files = local({ 'README.md': ENGLISH, [name]: CHINESE })
        assert.deepEqual(await documents(files), byLanguage(ENGLISH, { zh: CHINESE }), name)
        assert.equal((await read(files, 'zh-CN')).markdown, CHINESE, name)
      }
    })

    await t.test('reads an English translation for every other display language', async () => {
      for (const name of ENGLISH_NAMES) {
        const files = local({ 'README.md': CHINESE, [name]: ENGLISH })
        assert.deepEqual(await documents(files), byLanguage(ENGLISH, { zh: CHINESE }), name)
        assert.equal((await read(files, 'en-GB')).markdown, ENGLISH, name)
      }
    })

    await t.test('reads the README for other translations, and meta.detail before any README', async () => {
      const others = local({ 'README.md': ENGLISH, 'README.ja.md': '# 日本語\n', 'README.beginner.md': '# Beginner\n' })
      assert.deepEqual(await documents(others), byLanguage(ENGLISH))
      const detail = local({
        'README.md': ENGLISH,
        'README.zh.md': CHINESE,
        'docs/DETAIL.zh.md': '# 详情\n',
        'locale/zh.json': JSON.stringify({ meta: { detail: 'docs/DETAIL.zh.md' } }),
      })
      assert.deepEqual(await read(detail, 'zh'), { origin: 'locale', path: 'docs/DETAIL.zh.md', markdown: '# 详情\n' })
      const front = local({ 'README.md': ENGLISH, 'README_CN.md': `---\nkind: "package-bundle"\n---\n${CHINESE}` })
      assert.deepEqual(await read(front, 'zh'), { origin: 'readme', path: 'README_CN.md', markdown: CHINESE })
    })

    await t.test('reads the translations of an offered package from the npm file CDNs', async t => {
      const published = new Map()
      const requested = []
      t.mock.method(globalThis, 'fetch', async url => {
        const path = decodeURIComponent(new URL(url).pathname.replace(/^\/npm\/@scope\/offered@1\.0\.0\//u, ''))
        requested.push(path)
        if (published.get(path) === 'unavailable') return new Response('Unavailable', { status: 503 })
        return published.has(path) ? new Response(published.get(path)) : new Response('Not found', { status: 404 })
      })
      const files = npmFiles('@scope/offered', '1.0.0', ['jsdelivr'], { timeoutMs: 10_000, lifetime: new AbortController().signal })
      const publish = entries => {
        published.clear()
        requested.length = 0
        for (const [path, text] of entries) published.set(path, text)
      }

      publish([['README.md', ENGLISH], ['README_CN.md', CHINESE]])
      assert.equal((await read(files, 'zh')).path, 'README_CN.md')
      assert.deepEqual(requested.filter(path => !path.startsWith('locale/')).sort(), [...CHINESE_NAMES].sort())
      publish([['README.md', CHINESE], ['README_EN.md', ENGLISH]])
      assert.equal((await read(files, 'ja')).path, 'README_EN.md')
      assert.equal((await read(files, 'zh')).path, 'README.md')
      // A failing read of a better-ranked name is reported rather than replaced by a worse document.
      publish([['README.md', ENGLISH], ['README_CN.md', CHINESE], ['README.zh.md', 'unavailable']])
      await assert.rejects(read(files, 'zh'), { name: 'DetailFailure', reason: 'network' })
    })

    for (const name of README_BUNDLES) {
      const bundleManifest = installed(require, `${name}/package.json`)
      if (bundleManifest === undefined) continue
      await t.test(`${name} shows README.zh.md to a Chinese display language`, async () => {
        const files = localFiles(dirname(bundleManifest), JSON.parse(readFileSync(bundleManifest, 'utf8')).version)
        const paths = Object.fromEntries(await Promise.all(DISPLAY_LANGUAGES.map(async language => [language, (await read(files, language)).path])))
        assert.deepEqual(paths, byLanguage('README.md', { zh: 'README.zh.md' }))
      })
    }
  })
}
