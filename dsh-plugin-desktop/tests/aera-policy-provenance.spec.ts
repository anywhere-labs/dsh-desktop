import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// This is an AERA-owned patch module inside the pinned provider package. Its
// explicit path makes the source-custody seam visible and directly testable.
// @ts-expect-error the patch-private module intentionally does not widen the upstream public API
import { aeraPolicyProvenanceHeader } from '../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/aera-policy-provenance.js'

describe('Aera Code policy provenance', () => {
  it('projects immutable message source into a content-free correlation header', () => {
    const texts = ['owner prompt', 'runtime plugin context', 'runtime skill catalogue']
    const raw = aeraPolicyProvenanceHeader([
      { id: 'owner-1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: texts[0] }] },
      { id: 'plugin-1', role: 'system', source: { kind: 'plugin' }, content: [{ type: 'text', text: texts[1] }] },
      { id: 'skills-1', role: 'user', source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: texts[2] }] },
    ])
    const envelope = JSON.parse(raw)

    expect(envelope).toEqual({
      version: 1,
      segments: [
        {
          correlation_id: 'owner-1', source_type: 'HUMAN_USER', trust_class: 'UNTRUSTED',
          semantic_role: 'USER_INTENT', temporal_role: 'CURRENT_USER_TURN', retained_ordinal: 0,
          content_sha256: createHash('sha256').update(texts[0]!).digest('hex'),
        },
        {
          correlation_id: 'plugin-1', source_type: 'RUNTIME_PLUGIN_CONTEXT', trust_class: 'RUNTIME_SUPPLIED',
          semantic_role: 'CONTEXT_INTEGRITY', temporal_role: 'RUNTIME_CONTEXT', retained_ordinal: 1,
          content_sha256: createHash('sha256').update(texts[1]!).digest('hex'),
        },
        {
          correlation_id: 'skills-1', source_type: 'RUNTIME_SKILL_CATALOGUE', trust_class: 'RUNTIME_SUPPLIED',
          semantic_role: 'CONTEXT_INTEGRITY', temporal_role: 'RUNTIME_CONTEXT', retained_ordinal: 2,
          content_sha256: createHash('sha256').update(texts[2]!).digest('hex'),
        },
      ],
    })
    expect(raw).not.toContain(texts[0])
    expect(raw).not.toContain(texts[1])
    expect(raw).not.toContain(texts[2])
  })

  it('marks only the latest human message as the current user turn', () => {
    const messages = [
      { id: 'prior-owner', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Explicitly inspect the earlier state.' }] },
      { id: 'assistant-history', role: 'assistant', source: { kind: 'assistant' }, content: [{ type: 'text', text: 'Earlier answer.' }] },
      { id: 'current-owner', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Summarise the architecture.' }] },
      { id: 'skills', role: 'user', source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: 'Runtime catalogue.' }] },
    ]
    const envelope = JSON.parse(aeraPolicyProvenanceHeader(messages))

    expect(envelope.segments.map((segment: { correlation_id: string; temporal_role: string }) => ({
      id: segment.correlation_id,
      temporal: segment.temporal_role,
    }))).toEqual([
      { id: 'prior-owner', temporal: 'CONVERSATION_HISTORY' },
      { id: 'current-owner', temporal: 'CURRENT_USER_TURN' },
      { id: 'skills', temporal: 'RUNTIME_CONTEXT' },
    ])
  })

  it('wires the patch helper into the exact provider request header path', () => {
    const source = readFileSync(
      new URL('../node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js', import.meta.url),
      'utf8',
    )
    expect(source).toContain('withAeraPolicyProvenance(profile.headers, options.messages)')
  })
})
