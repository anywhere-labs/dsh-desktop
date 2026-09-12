export interface ParsedSseEvent<T = unknown> {
  readonly event?: string
  readonly id?: string
  readonly data: T
  readonly rawData: string
}

interface FrameDelimiter {
  readonly index: number
  readonly length: number
}

function findFrameDelimiter(buffer: string): FrameDelimiter | undefined {
  const candidates = [
    { index: buffer.indexOf('\n\n'), length: 2 },
    { index: buffer.indexOf('\r\n\r\n'), length: 4 },
  ].filter(candidate => candidate.index >= 0)
  if (candidates.length === 0) return undefined
  return candidates.reduce((first, candidate) => (
    candidate.index < first.index ? candidate : first
  ))
}

function parseData(rawData: string): unknown {
  try {
    return JSON.parse(rawData) as unknown
  } catch {
    return rawData
  }
}

function parseFrame(frame: string): ParsedSseEvent | undefined {
  let event: string | undefined
  let id: string | undefined
  const dataLines: string[] = []

  for (const line of frame.split(/\r\n|\r|\n/)) {
    if (line.startsWith(':') || line.length === 0) continue
    const separator = line.indexOf(':')
    const field = separator === -1 ? line : line.slice(0, separator)
    let value = separator === -1 ? '' : line.slice(separator + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') event = value
    else if (field === 'id') id = value
    else if (field === 'data') dataLines.push(value)
  }

  if (dataLines.length === 0) return undefined
  const rawData = dataLines.join('\n')
  const result: ParsedSseEvent = { data: parseData(rawData), rawData }
  if (event !== undefined) return id === undefined ? { ...result, event } : { ...result, event, id }
  if (id !== undefined) return { ...result, id }
  return result
}

/** Parse complete SSE events from arbitrary string chunks without I/O. */
export function parseSseChunks(chunks: readonly string[]): ParsedSseEvent[] {
  const events: ParsedSseEvent[] = []
  let buffer = ''

  const consume = (flush: boolean): void => {
    while (true) {
      const delimiter = findFrameDelimiter(buffer)
      if (delimiter === undefined) break
      const frame = buffer.slice(0, delimiter.index)
      buffer = buffer.slice(delimiter.index + delimiter.length)
      const event = parseFrame(frame)
      if (event !== undefined) events.push(event)
    }
    if (flush && buffer.length > 0) {
      const event = parseFrame(buffer)
      if (event !== undefined) events.push(event)
      buffer = ''
    }
  }

  for (const chunk of chunks) {
    buffer += chunk
    consume(false)
  }
  consume(true)
  return events
}
