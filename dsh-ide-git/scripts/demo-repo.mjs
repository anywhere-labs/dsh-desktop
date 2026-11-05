/**
 * Builds the throwaway demo repository used by docs/screenshots.
 *
 *   node scripts/demo-repo.mjs [target-dir]      (default /tmp/dsh-ide-git-demo)
 *
 * Everything in it is fictional: a small note-taking app with a branched and
 * merged history, tags, a bare 'origin' so ahead/behind badges show up, one
 * stash and pending work in every state the changes pane can display. No real
 * project, author or path is involved.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const target = process.argv[2] === undefined || process.argv[2] === '' ? '/tmp/dsh-ide-git-demo' : process.argv[2]
const origin = target.replace(/\/$/, '') + '-origin.git'
const clone = target.replace(/\/$/, '') + '-clone'
const AUTHORS = [
  ['Alice Chen', 'alice@example.com'],
  ['Bob Lee', 'bob@example.com'],
  ['Carol Wang', 'carol@example.com'],
]
let authorIndex = 0

function git(args, env) {
  return execFileSync('git', args, { cwd: target, encoding: 'utf8', env: Object.assign({ GIT_TERMINAL_PROMPT: '0' }, process.env, env) })
}

function stamp(daysAgo, hour) {
  const at = new Date(Date.now() - daysAgo * 86400000)
  at.setHours(hour === undefined ? 10 : hour, 24, 0, 0)
  const pad = (value) => (value < 10 ? '0' + value : String(value))
  return at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + 'T' + pad(at.getHours()) + ':' + pad(at.getMinutes()) + ':00+08:00'
}

function write(relative, content) {
  const full = join(target, relative)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function identity(daysAgo, hour) {
  const author = AUTHORS[authorIndex % AUTHORS.length]
  authorIndex += 1
  const when = stamp(daysAgo, hour)
  return {
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_DATE: when,
    GIT_AUTHOR_NAME: author[0],
    GIT_AUTHOR_EMAIL: author[1],
    GIT_COMMITTER_NAME: author[0],
    GIT_COMMITTER_EMAIL: author[1],
  }
}

function commit(message, daysAgo, hour, paths) {
  if (paths === undefined) git(['add', '-A'])
  else git(['add', ...paths])
  git(['commit', '-q', '-m', message], identity(daysAgo, hour))
}

rmSync(target, { recursive: true, force: true })
rmSync(origin, { recursive: true, force: true })
rmSync(clone, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
git(['init', '-q', '-b', 'main'])
git(['config', 'user.name', 'Alice Chen'])
git(['config', 'user.email', 'alice@example.com'])
git(['config', 'commit.gpgsign', 'false'])

write('README.md', '# Aurora Notes\n\n一个用来演示的极光笔记应用。\n')
write('package.json', JSON.stringify({ name: 'aurora-notes', version: '0.1.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n')
commit('chore: 初始化仓库', 30, 9)

write('src/store.js', 'export const notes = new Map()\n\nexport function put(note) {\n  notes.set(note.id, note)\n}\n')
write('src/app.js', "import { notes } from './store.js'\n\nexport function start() {\n  return notes.size\n}\n")
commit('feat: 笔记数据模型与本地存储', 29, 11)

write('tests/store.test.js', "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n\ntest('store starts empty', () => {\n  assert.ok(true)\n})\n")
commit('test: 存储层单测骨架', 28, 15)

write('.eslintrc.json', JSON.stringify({ root: true, env: { node: true, es2022: true } }, null, 2) + '\n')
commit('chore: 接入 eslint 与 prettier', 27, 10)
git(['tag', '-a', 'v0.1.0', '-m', 'v0.1.0'])

git(['checkout', '-q', '-b', 'feature/markdown-preview'])
write('src/markdown.js', 'export function render(source) {\n  return source.replace(/^# (.*)$/gm, "<h1>$1</h1>")\n}\n')
commit('feat: markdown 渲染', 25, 14)
write('src/ui/preview.js', 'export function mountPreview(root) {\n  root.dataset.ready = "1"\n}\n')
commit('feat: 预览面板挂载', 24, 16)

git(['checkout', '-q', 'main'])
write('src/app.js', "import { notes } from './store.js'\n\nexport function start() {\n  if (notes.size === 0) return 0\n  return notes.size\n}\n")
commit('fix: 空笔记列表不再抛错', 23, 9)
git(['merge', '-q', '--no-ff', 'feature/markdown-preview', '-m', 'Merge branch \'feature/markdown-preview\' into main'])

git(['checkout', '-q', '-b', 'develop'])
write('src/ui/list.js', 'export function renderList(items) {\n  return items.map((item) => item.title).join(",")\n}\n')
commit('feat: 搜索面板骨架', 20, 11)

git(['checkout', '-q', '-b', 'feature/search-index'])
write('src/search.js', 'export function buildIndex(items) {\n  return items.map((item) => item.title.toLowerCase())\n}\n')
commit('feat: 倒排索引构建', 19, 13)
appendFileSync(join(target, 'src/search.js'), '\nexport function query(index, needle) {\n  return index.filter((entry) => entry.includes(needle))\n}\n')
commit('feat: 索引查询接口', 18, 17)

git(['checkout', '-q', 'develop'])
write('src/store.js', 'export const notes = new Map()\n\nexport function put(note) {\n  notes.set(note.id, note)\n}\n\nexport function all() {\n  return [...notes.values()]\n}\n')
commit('refactor: 拆出 store 查询接口', 17, 10)
git(['merge', '-q', '--no-ff', 'feature/search-index', '-m', 'Merge branch \'feature/search-index\' into develop'])

git(['checkout', '-q', 'main'])
write('package.json', JSON.stringify({ name: 'aurora-notes', version: '0.2.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n')
commit('chore: 版本号 0.2.0', 15, 9)
git(['tag', '-a', 'v0.2.0', '-m', 'v0.2.0'])
git(['merge', '-q', '--no-ff', 'develop', '-m', 'Merge branch \'develop\' into main'])

git(['checkout', '-q', '-b', 'fix/sync-retry'])
write('src/sync.js', 'export async function sync(remote) {\n  return remote.push()\n}\n')
commit('fix: 同步失败时重试一次', 13, 12)
appendFileSync(join(target, 'src/sync.js'), '\nexport function backoff(attempt) {\n  return Math.min(30000, 2 ** attempt * 500)\n}\n')
commit('fix: 指数退避上限 30 秒', 12, 15)

git(['checkout', '-q', 'main'])
git(['merge', '-q', '--no-ff', 'fix/sync-retry', '-m', 'Merge branch \'fix/sync-retry\' into main'])
write('src/ui/editor.js', 'export function bindShortcuts(input) {\n  input.addEventListener("keydown", (event) => {\n    if (event.key === "s" && event.metaKey) event.preventDefault()\n  })\n}\n')
commit('feat: 编辑器快捷键', 10, 11)

write('docs/architecture.md', '# 架构\n\nstore 负责数据,ui 负责渲染,sync 负责远端同步。\n')
commit('docs: 补充架构说明', 9, 14)
write('src/db.js', 'export async function open() {\n  return { name: "aurora" }\n}\n')
commit('refactor: 存储迁移到 IndexedDB', 8, 10)
write('src/export.js', 'export function toHtml(note) {\n  return "<article>" + note.title + "</article>"\n}\n')
commit('feat: 导出为 HTML', 7, 16)
appendFileSync(join(target, 'src/ui/list.js'), '\nexport function sortByTitle(items) {\n  return items.slice().sort((a, b) => a.title.localeCompare(b.title, "zh"))\n}\n')
commit('fix: 中文标题排序改为按拼音', 6, 9)
appendFileSync(join(target, 'src/markdown.js'), '\nexport function renderCached(source, cache) {\n  if (cache.has(source)) return cache.get(source)\n  const html = render(source)\n  cache.set(source, html)\n  return html\n}\n')
commit('perf: 大文档渲染加缓存', 5, 13)
appendFileSync(join(target, 'tests/store.test.js'), "\ntest('put then all returns the note', () => {\n  assert.ok(true)\n})\n")
commit('test: 补充 store 用例', 4, 10)
write('src/tags.js', 'export function tag(note, name) {\n  note.tags = [...(note.tags === undefined ? [] : note.tags), name]\n  return note\n}\n')
commit('feat: 标签系统', 3, 15)
appendFileSync(join(target, 'README.md'), '\n## 功能\n\n- Markdown 预览\n- 标签\n- 导出\n')
commit('docs: 更新功能列表', 2, 11)
write('package.json', JSON.stringify({ name: 'aurora-notes', version: '1.0.0', type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n')
commit('chore: 发布 1.0.0', 1, 18)
git(['tag', '-a', 'v1.0.0', '-m', 'v1.0.0'])

// 1) 一条贮藏：先写草稿并把它 stash 起来(此刻工作区又回到干净)
write('src/sync-worker.js', 'export function workerIdle() {\n  return true\n}\n')
git(['add', 'src/sync-worker.js'])
git(['stash', 'push', '-q', '-u', '-m', 'wip: 同步 worker 草稿'], identity(0, 8))

// 2) 一个裸 origin，并把每个分支推上去(这样面板里有远程分支与跟踪关系)
execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' })
git(['remote', 'add', 'origin', origin])
git(['push', '-q', '-u', 'origin', 'main'])
for (const branch of ['develop', 'feature/markdown-preview', 'feature/search-index', 'fix/sync-retry']) {
  git(['push', '-q', 'origin', branch])
}

// 3) 别人往 origin/main 推了一个提交 -> fetch 之后本地会显示 behind 1
execFileSync('git', ['clone', '-q', '-b', 'main', origin, clone], { encoding: 'utf8' })
execFileSync('git', ['config', 'user.name', 'Bob Lee'], { cwd: clone, encoding: 'utf8' })
execFileSync('git', ['config', 'user.email', 'bob@example.com'], { cwd: clone, encoding: 'utf8' })
writeFileSync(join(clone, 'docs', 'release-notes.md'), '# 发布说明\n\n1.0.0 首次发布。\n')
execFileSync('git', ['add', '-A'], { cwd: clone, encoding: 'utf8' })
execFileSync('git', ['commit', '-q', '-m', 'docs: 补充 1.0.0 发布说明'], {
  cwd: clone,
  encoding: 'utf8',
  env: Object.assign({}, process.env, {
    GIT_AUTHOR_DATE: stamp(0, 8),
    GIT_COMMITTER_DATE: stamp(0, 8),
    GIT_AUTHOR_NAME: 'Bob Lee',
    GIT_AUTHOR_EMAIL: 'bob@example.com',
    GIT_COMMITTER_NAME: 'Bob Lee',
    GIT_COMMITTER_EMAIL: 'bob@example.com',
  }),
})
execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: clone, encoding: 'utf8' })
rmSync(clone, { recursive: true, force: true })
git(['fetch', '-q', '--prune', 'origin'])

// 4) 本地再领先若干提交，并让一条主题分支与 main 交错提交后合并 ——
//    这样提交图谱顶部会同时出现并行 lane 与合并曲线，而不是一条直线。
write('src/ui/theme.js', 'export const themes = ["light", "dark"]\n')
commit('feat: 主题切换', 0, 7, ['src/ui/theme.js'])
write('src/ui/icons.js', 'export const icons = { note: "N", tag: "T" }\n')
commit('feat: 图标集', 0, 8, ['src/ui/icons.js'])
git(['checkout', '-q', '-b', 'feature/export-formats'])
write('src/export/csv.js', 'export function toCsv(notes) {\n  return notes.map((note) => note.title).join(",")\n}\n')
commit('feat: 导出 CSV', 0, 9, ['src/export/csv.js'])
git(['checkout', '-q', 'main'])
write('src/ui/shortcuts.js', 'export const SHORTCUTS = { save: "Meta+S", search: "Meta+K" }\n')
commit('feat: 快捷键面板', 0, 10, ['src/ui/shortcuts.js'])
git(['checkout', '-q', 'feature/export-formats'])
write('src/export/pdf.js', 'export function toPdf(notes) {\n  return notes.length\n}\n')
commit('feat: 导出 PDF', 0, 11, ['src/export/pdf.js'])
git(['checkout', '-q', 'main'])
write('docs/formats.md', '# 导出格式\n\nCSV / PDF / HTML。\n')
commit('docs: 导出格式说明', 0, 12, ['docs/formats.md'])
git(['merge', '-q', '--no-ff', 'feature/export-formats', '-m', "Merge branch 'feature/export-formats' into main"], identity(0, 12))

// 5) 最后把工作区留在「已暂存 / 已修改 / 未跟踪」都有内容的状态
write('src/ui/toolbar.js', 'export function toolbar() {\n  return ["new", "search"]\n}\n')
git(['add', 'src/ui/toolbar.js'])
appendFileSync(join(target, 'src/ui/list.js'), '\nexport function emptyState() {\n  return "还没有笔记"\n}\n')
write('notes/scratch.md', '- 想一想要不要支持双链\n')
write('docs/todo.md', '- [ ] 同步冲突提示\n')

// 6) 一个被忽略的目录与文件：「显示忽略的文件」要有东西可显示,而
//    ls-files --directory 会把整个 dist/ 收成一条,不会淹没列表。
write('.gitignore', 'dist/\n*.log\n')
write('dist/bundle.js', '// build output, ignored on purpose\n')
write('debug.log', 'noise\n')

console.log('demo repo ready at ' + target)
console.log('origin: ' + origin)
console.log(git(['log', '--oneline', '--graph', '--decorate', '-n', '10']))
console.log('branches: ' + git(['branch', '--format=%(refname:short)']).trim().split('\n').join(', '))
console.log('tracking: ' + git(['rev-list', '--left-right', '--count', 'origin/main...main']).trim())
console.log('status:')
console.log(git(['status', '--short']))
console.log('stash: ' + git(['stash', 'list']).trim())