import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addUsage, expandStreamRecords, PromptError, promptParts, questionChoices, questionForm, slashCommand, stopReason, toolCallUpdate, toolKind,
  toolResultUpdate,
} from '../../src/acp/convert.js'

const png = 'iVBORw0KGgo='

test('prompt blocks become DSH prompt parts', () => {
  assert.deepEqual(promptParts([
    { type: 'text', text: '看看 ' },
    { type: 'resource_link', name: 'main.ts', uri: 'file:///work/src/main.ts' },
    { type: 'text', text: ' 这张图：' },
    { type: 'image', data: png, mimeType: 'image/PNG', uri: 'file:///tmp/shot.png' },
    { type: 'resource', resource: { uri: 'file:///work/a.ts', mimeType: 'text/x-typescript', text: 'const a = 1' } },
  ]), [
    { type: 'text', text: '看看 [main.ts](/work/src/main.ts) 这张图：' },
    { type: 'image', mediaType: 'image/png', data: png, name: 'shot.png' },
    { type: 'text', text: '\n<context uri="/work/a.ts" mimeType="text/x-typescript">\nconst a = 1\n</context>\n' },
  ])
  assert.deepEqual(promptParts([{ type: 'resource', resource: { uri: 'file:///x.jpg', mimeType: 'image/jpeg', blob: png } }]),
    [{ type: 'image', mediaType: 'image/jpeg', data: png, name: 'x.jpg' }])
})

test('unsupported prompt content is refused before reaching DSH', () => {
  assert.throws(() => promptParts([{ type: 'audio', data: png, mimeType: 'audio/wav' }]), PromptError)
  assert.throws(() => promptParts([{ type: 'image', data: png, mimeType: 'image/tiff' }]), /图片类型/u)
  assert.throws(() => promptParts([{ type: 'image', data: 'not base64!', mimeType: 'image/png' }]), /base64/u)
  assert.throws(() => promptParts([{ type: 'resource', resource: { uri: 'file:///a.bin', blob: png } }]), /二进制/u)
  assert.throws(() => promptParts([{ type: 'text', text: '   ' }]), /不能为空/u)
})

test('slash commands are recognized only at the start of the prompt', () => {
  assert.deepEqual(slashCommand([{ type: 'text', text: '  /compact' }]), { name: 'compact', line: '/compact' })
  assert.deepEqual(slashCommand([{ type: 'text', text: '/permission ' }, { type: 'text', text: 'read-only' }]), { name: 'permission', line: '/permission read-only' })
  assert.equal(slashCommand([{ type: 'text', text: '路径是 /usr/bin' }]), undefined)
  assert.equal(slashCommand([{ type: 'image', data: png, mimeType: 'image/png' }, { type: 'text', text: '/compact' }]), undefined)
})

test('turn ends map to ACP stop reasons', () => {
  assert.deepEqual(stopReason({ kind: 'completed' }, false), { stopReason: 'end_turn' })
  assert.deepEqual(stopReason({ kind: 'completed' }, true), { stopReason: 'cancelled' }, 'a cancelled prompt always reports cancelled')
  assert.deepEqual(stopReason({ kind: 'max-tokens' }, false), { stopReason: 'max_tokens' })
  assert.deepEqual(stopReason({ kind: 'interrupted' }, false), { stopReason: 'cancelled' })
  assert.deepEqual(stopReason({ kind: 'aborted', reason: { kind: 'user' } }, false), { stopReason: 'cancelled' }, 'stopped in DSH Desktop')
  assert.deepEqual(stopReason({ kind: 'aborted', reason: { kind: 'hook' } }, false), { stopReason: 'end_turn' })
  assert.deepEqual(stopReason({ kind: 'error', error: { message: 'rate limited' } }, false), { error: 'DSH 这一轮执行失败：rate limited' })
  assert.deepEqual(stopReason({ kind: 'error', error: {} }, true), { stopReason: 'cancelled' })
})

test('the compact stream of a step in progress expands to chunks', () => {
  assert.deepEqual(expandStreamRecords([
    { type: 'chunk', time: 1, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
    { type: 'reasoning-chunks', time0: 1, index: 0, dt: [0, 1], texts: ['想', '一想'] },
    { type: 'chunk', time: 2, chunk: { type: 'block-start', index: 1, blockType: 'text' } },
    { type: 'text-chunks', time0: 2, index: 1, dt: [0], texts: ['你好前半'] },
    { type: 'tool-call-chunks', time0: 3, index: 2, dt: [0], id: 'c', args: ['{'] },
  ]), [
    { type: 'block-start', index: 0, blockType: 'reasoning' },
    { type: 'reasoning-delta', index: 0, text: '想' },
    { type: 'reasoning-delta', index: 0, text: '一想' },
    { type: 'block-start', index: 1, blockType: 'text' },
    { type: 'text-delta', index: 1, text: '你好前半' },
  ])
  assert.equal(expandStreamRecords([{ type: 'future-chunks', texts: ['x'] }]), undefined, 'an unknown record is not guessed at')
  assert.equal(expandStreamRecords([{ type: 'text-chunks', index: 0, texts: [1] }]), undefined)
})

test('usage is summed over a turn', () => {
  const once = addUsage(undefined, { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4 })
  assert.deepEqual(addUsage(once, { inputTokens: 5, outputTokens: 1, reasoningTokens: 3 }),
    { inputTokens: 15, outputTokens: 3, totalTokens: 18, thoughtTokens: 3, cachedReadTokens: 4 })
  assert.equal(addUsage(undefined, { inputTokens: 'x' }), undefined)
})

test('tool cards follow the tool presentation, with name-based fallbacks', () => {
  assert.deepEqual(toolCallUpdate('c1', 'bash', { command: 'ls' }, undefined),
    { sessionUpdate: 'tool_call', toolCallId: 'c1', name: 'bash', status: 'in_progress', title: 'bash', kind: 'execute', rawInput: { command: 'ls' } })
  assert.equal(toolKind('grep'), 'search')
  assert.equal(toolKind('str_replace_editor'), 'edit')
  assert.deepEqual(toolCallUpdate('c2', 'write', { file_path: '/w/a.txt' }, {
    card: 'diff', title: 'Write /w/a.txt', diffs: [{ path: '/w/a.txt', oldText: null, newText: 'hi' }], locations: [{ path: '/w/a.txt' }],
  }), { sessionUpdate: 'tool_call', toolCallId: 'c2', name: 'write', status: 'in_progress', title: 'Write /w/a.txt', kind: 'edit',
    rawInput: { file_path: '/w/a.txt' }, content: [{ type: 'diff', path: '/w/a.txt', oldText: null, newText: 'hi' }], locations: [{ path: '/w/a.txt' }] })
  const terminal = toolCallUpdate('c3', 'bash', { command: 'npm test' }, { card: 'terminal', title: 'npm test', description: '运行测试' })
  assert.equal(terminal.sessionUpdate === 'tool_call' && terminal.kind, 'execute')
  assert.deepEqual(terminal.sessionUpdate === 'tool_call' && terminal.content, [{ type: 'content', content: { type: 'text', text: '运行测试' } }])
})

test('tool results close the card with the presented output', () => {
  const terminal = toolResultUpdate('c1', false, [{ type: 'text', text: 'ok' }], { card: 'terminal', output: 'all passed', exitCode: 0 })
  assert.equal(terminal.sessionUpdate, 'tool_call_update')
  assert.match(JSON.stringify(terminal), /all passed/u)
  assert.match(JSON.stringify(terminal), /退出码 0/u)
  assert.deepEqual(terminal.sessionUpdate === 'tool_call_update' && terminal.rawOutput, { output: 'all passed', exitCode: 0 })
  const search = toolResultUpdate('c2', false, [], { card: 'search', shape: 'matches', files: [{ path: 'a.ts', matches: [{ lineNumber: 3, line: 'foo()' }] }], truncated: true, total: 9 })
  assert.match(JSON.stringify(search), /a\.ts:3: foo\(\)/u)
  assert.match(JSON.stringify(search), /共 9 项/u)
  const read = toolResultUpdate('c3', false, [], { card: 'read', path: '/w/a.ts', offset: 5, lines: [{ number: 5, text: 'x' }], totalLines: 9, lang: 'ts' })
  assert.deepEqual(read.sessionUpdate === 'tool_call_update' && read.locations, [{ path: '/w/a.ts', line: 5 }])
  const failed = toolResultUpdate('c4', true, [{ type: 'text', text: 'permission denied' }], { card: 'terminal', output: 'ignored' })
  assert.equal(failed.sessionUpdate === 'tool_call_update' && failed.status, 'failed')
  assert.match(JSON.stringify(failed), /permission denied/u, 'a failure shows the error, not the presentation')
  const long = toolResultUpdate('c5', false, [{ type: 'text', text: 'x'.repeat(300_000) }], undefined)
  assert.ok(JSON.stringify(long).length < 220_000, 'huge outputs are clipped')
})

test('questions become a form and answers keep DSH option labels', () => {
  const form = questionForm([
    { id: 'mode', header: '模式', question: '选择模式', options: [{ label: '标准' }, { label: '快速', description: '少做检查' }] },
    { id: 'targets', question: '选择平台', multiSelect: true, options: [{ label: 'Web' }, { label: 'Android' }] },
    { id: 'notes', question: '其他要求' },
    { id: 'access', question: '允许访问？', options: [{ label: 'Allow' }, { label: 'Deny' }], intent: { kind: 'approval', approve: 'Allow', reject: 'Deny' } },
  ])!
  assert.ok(form)
  assert.deepEqual(Object.keys(form.schema.properties), ['mode', 'mode__custom', 'targets', 'targets__custom', 'notes', 'access'])
  assert.deepEqual(form.schema.required, ['notes', 'access'])
  assert.deepEqual(form.schema.properties.mode?.oneOf, [{ const: '标准', title: '标准' }, { const: '快速', title: '快速（少做检查）' }])
  assert.equal(form.schema.properties.targets?.type, 'array')
  assert.deepEqual(form.answer({ mode: '快速', targets: ['Web', 'Android', 'Bogus'], targets__custom: ' iOS ', notes: '简洁', access: 'Allow' }), { answers: [
    { id: 'mode', selected: ['快速'] },
    { id: 'targets', selected: ['Web', 'Android'], custom: 'iOS' },
    { id: 'notes', selected: [], custom: '简洁' },
    { id: 'access', selected: ['Allow'] },
  ] })
  assert.deepEqual(form.answer({ mode: '标准', mode__custom: '自定义', targets: ['Web'], notes: 'x', access: 'Deny' })?.answers[0],
    { id: 'mode', selected: [], custom: '自定义' }, 'a written answer replaces a single choice')
  assert.equal(form.answer({ targets: ['Web'], notes: 'x', access: 'Allow' }), undefined, 'every question needs an answer')
  assert.equal(questionForm([{ id: 'a', question: 'q' }, { id: 'a', question: 'q' }]), undefined, 'duplicate ids are not expressible')
  assert.equal(questionForm([]), undefined)
})

test('without forms, single-choice questions become permission choices', () => {
  assert.deepEqual(questionChoices([
    { id: 'mode', header: '模式', question: '选择模式', detail: '影响检查范围', options: [{ label: '标准' }, { label: '快速', description: '少做检查' }] },
  ]), [{ id: 'mode', title: '模式：选择模式', detail: '影响检查范围', options: [
    { optionId: 'option-0', name: '标准', kind: 'allow_once', label: '标准' },
    { optionId: 'option-1', name: '快速（少做检查）', kind: 'allow_once', label: '快速' },
  ] }])

  // DSH's plan review: the plan is the detail, and only the approving label approves.
  const [review] = questionChoices([{ id: 'plan_review', header: 'Plan review', question: 'Approve this plan and leave plan mode?', detail: '# 计划',
    options: [{ label: 'Approve', description: 'Leave plan mode' }, { label: 'Keep planning' }], intent: { kind: 'plan-review', approve: 'Approve' } }])!
  assert.equal(review?.title, '批准这个计划并退出计划模式？')
  assert.equal(review?.detail, '# 计划')
  assert.deepEqual(review?.options.map(option => [option.name, option.kind, option.label]),
    [['批准计划', 'allow_once', 'Approve'], ['继续规划', 'reject_once', 'Keep planning']])

  const [approval] = questionChoices([{ id: 'grant', question: 'Allow?', options: [{ label: 'Allow' }, { label: 'Always' }, { label: 'Deny' }],
    intent: { kind: 'approval', approve: 'Allow', reject: 'Deny', always: 'Always', display: { question: { en: 'Allow access?', 'zh-CN': '允许访问吗？' } } } }])!
  assert.equal(approval?.title, '允许访问吗？')
  assert.deepEqual(approval?.options.map(option => option.kind), ['allow_once', 'allow_always', 'reject_once'])

  assert.equal(questionChoices([{ id: 'a', question: 'q', multiSelect: true, options: [{ label: 'x' }] }]), undefined, 'several choices need a form')
  assert.equal(questionChoices([{ id: 'a', question: 'q' }]), undefined, 'a typed answer needs a form')
  assert.equal(questionChoices([{ id: 'a', question: 'q', options: [{ label: 'x' }] }, { id: 'b', question: '其他要求' }]), undefined,
    'one question a list cannot carry leaves the whole request to forms or DSH')
  assert.equal(questionChoices([]), undefined)
})
