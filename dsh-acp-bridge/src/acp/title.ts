/** ACP's generic, currently unstable title request; no editor-specific extension names. */
import { RequestError } from '@agentclientprotocol/sdk'
import { record } from './convert.js'

// Official v1 draft: sessionCapabilities.title, session/set_title -> { title }.
// SDK 1.4 does not include this method yet; use its public typed-parser registration seam.
export const SET_SESSION_TITLE = 'session/set_title'
export function parseSessionTitle(value: unknown): { sessionId: string; title: string } {
  const input = record(value)
  if (typeof input.sessionId !== 'string' || !input.sessionId.trim()
    || typeof input.title !== 'string' || !input.title.trim()) {
    throw RequestError.invalidParams(undefined, 'sessionId 和 title 必须是非空字符串。')
  }
  return { sessionId: input.sessionId, title: input.title }
}
