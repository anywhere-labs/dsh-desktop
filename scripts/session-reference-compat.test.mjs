/** Exercise the installed session-reference parser in Beta and Next (issue #1500). */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const invalidReference = { code: 'SESSION_REFERENCE_INVALID_REFERENCE' }

function runtimePath(workspace) {
  try {
    return createRequire(resolve(workspace, 'package.json')).resolve('@deepseek-ai/dsh-session-reference')
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes("'@deepseek-ai/dsh-session-reference'")) return undefined
    throw error
  }
}

// Stable is frozen on the unpatched upstream parser.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const entry = runtimePath(workspace)
  test(`${workspace}: bare session-reference text compatibility`, {
    skip: entry === undefined && 'runtime dependencies are not installed; run corepack yarn install',
  }, async t => {
    const {
      SessionReferenceResolver,
      encodeSessionReferenceUri,
      formatSessionReferenceMention,
      parseSessionReferenceText,
    } = await import(pathToFileURL(entry).href)
    const sessionId = 'source-session'
    const uri = encodeSessionReferenceUri(sessionId)
    const mention = formatSessionReferenceMention({ sessionId, label: 'Research' })
    const objectUri = `dsh-session:${Buffer.from(JSON.stringify({ id: 'x' })).toString('base64url')}`

    await t.test('leaves bare text that is not a canonical URI unchanged', () => {
      for (const text of [
        'dsh-session:test',
        'see dsh-session:IiJ please',
        `truncated ${uri.slice(0, -2)}`,
        `object ${objectUri}`,
        'invalid session reference URI "dsh-session:test"',
      ]) assert.deepEqual(parseSessionReferenceText(text), { text, references: [] })
    })

    await t.test('still resolves canonical mentions and bare URIs next to plain text', () => {
      assert.deepEqual(parseSessionReferenceText(`compare ${mention}, ${uri} and dsh-session:test`), {
        text: 'compare @Research, @source-session and dsh-session:test',
        references: [{ sessionId, label: 'Research' }, { sessionId, label: sessionId }],
      })
    })

    await t.test('still rejects malformed explicit mentions', () => {
      assert.throws(() => parseSessionReferenceText('@[bad](dsh-session:test)'), invalidReference)
      assert.throws(() => parseSessionReferenceText('@[bad](dsh-session:%%%)'), invalidReference)
    })

    await t.test('passes a direct message with bare text through the pre-step unchanged', async () => {
      const calls = []
      const additionalContext = { role: 'user', source: { kind: 'session-reference' }, content: [] }
      const resolver = {
        async prepare(_agent, content, references) {
          calls.push(references)
          return { content, additionalContext }
        },
      }
      // Beta's alpha runtime adds a route parameter before the signal; the fake receives neither.
      const preStep = messages => SessionReferenceResolver.prototype.prepareDirectMessages.call(resolver, {}, messages)
      const message = text => Object.freeze({ id: text, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })

      const bare = message('dsh-session:test')
      const passed = await preStep([bare])
      assert.equal(passed.length, 1)
      assert.equal(passed[0], bare)
      assert.deepEqual(calls, [])

      const [direct, context] = await preStep([message(`use ${mention}`)])
      assert.deepEqual(direct.content, [{ type: 'text', text: 'use @Research' }])
      assert.equal(context, additionalContext)
      assert.deepEqual(calls, [[{ sessionId, label: 'Research' }]])

      await assert.rejects(preStep([message('@[bad](dsh-session:test)')]), invalidReference)
    })
  })
}
