/** Owner-only live metadata. Reconnects replace the baseline; no periodic inventory requests. */
import { CONNECTIONS_PATH, type ConnectionState } from '../management-contract.js'

export type LiveStatus = 'connecting' | 'live' | 'reconnecting'

/** A queued push cannot rewind a newer manual snapshot; a restarted Host starts a new revision sequence. */
export function latestConnectionState(previous: ConnectionState | undefined, next: ConnectionState): ConnectionState {
  return previous?.instanceId === next.instanceId && previous.revision > next.revision ? previous : next
}

export function watchConnections(onState: (state: ConnectionState) => void, onStatus: (status: LiveStatus) => void): () => void {
  let disposed = false
  let controller: AbortController | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    controller = new AbortController()
    const current = controller
    const arm = () => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => { current.abort() }, 45_000)
    }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      arm()
      const response = await fetch(`${CONNECTIONS_PATH}?watch=1`, { cache: 'no-store', signal: current.signal })
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
      reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (!disposed) {
        const { done, value } = await reader.read()
        if (done) break
        arm()
        buffer += decoder.decode(value, { stream: true })
        let end: number
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end)
          buffer = buffer.slice(end + 1)
          if (!line.trim()) continue
          const state = JSON.parse(line) as ConnectionState
          if (disposed) return
          onState(state)
          onStatus('live')
        }
      }
    } catch { /* Keep the last snapshot visible, marked stale, until a new baseline arrives. */ }
    finally {
      clearTimeout(watchdog)
      await reader?.cancel().catch(() => {})
      current.abort()
      if (!disposed) {
        onStatus('reconnecting')
        retry = setTimeout(() => { void run() }, 2_000)
      }
    }
  }
  onStatus('connecting')
  void run()
  return () => {
    disposed = true
    clearTimeout(retry); clearTimeout(watchdog)
    controller?.abort()
  }
}
