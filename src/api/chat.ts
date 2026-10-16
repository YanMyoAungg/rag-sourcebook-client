import { ApiError, apiBaseUrl, failureMessage } from './client'

/** Mirrors the server's `Citation` in `../server/src/rag/answer.ts`. */
export type Citation = {
  documentId: string
  filename: string
  chunkIndex: number
}

/** Mirrors the server's `SearchHit` in `../server/src/rag/search.ts`. */
export type SearchHit = Citation & {
  content: string
  /** Cosine similarity, normalized so larger values are more relevant. */
  relevance: number
}

export type ChatAnswer = {
  answer: string
  citations: Citation[]
  retrievedChunks: SearchHit[]
}

/** Mirrors the server's `TraceHit`: a hit as the trace reports it, without its content. */
export type TraceHit = {
  filename: string
  chunkIndex: number
  relevance: number
}

/** Mirrors the server's `ToolTrace`: one tool call, reported as it progresses. */
export type ToolStep = {
  /** Stable across the events that describe the same call. */
  id: string
  /** The tool's registered name, e.g. `search_documents`. */
  tool: string
  args: Record<string, unknown>
  state: 'running' | 'complete' | 'error'
  hits?: TraceHit[]
  durationMs?: number
}

/**
 * What the stream carries: the server's `AnswerEvent`s, plus the failure it can
 * only report once the response has already started.
 */
export type AnswerEvent =
  | { type: 'tool'; step: ToolStep }
  | { type: 'text-delta'; text: string }
  | { type: 'finish'; result: ChatAnswer; durationMs: number }
  | { type: 'error'; message: string }

/**
 * Asks a question and hands each event to `onEvent` as it arrives. Resolves when
 * the stream ends; rejects on a request that never started or a broken stream.
 */
export async function streamAsk(
  question: string,
  onEvent: (event: AnswerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let response: Response

  try {
    response = await fetch(`${apiBaseUrl()}/api/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
      signal,
    })
  } catch (cause) {
    if (cause instanceof ApiError) throw cause
    // A stop is the reader's own doing, and the panel reports it as stopped.
    if (signal.aborted) throw cause

    throw new ApiError(
      'Could not reach the server. Check that it is running, then try again.',
      0,
      { cause },
    )
  }

  if (!response.ok) {
    throw new ApiError(await failureMessage(response), response.status)
  }

  if (response.body === null) {
    throw new ApiError('The server returned an empty response.', response.status)
  }

  for await (const event of readEvents(response.body)) {
    onEvent(event)
  }
}

const FRAME_TERMINATOR = '\n\n'

/**
 * Splits a `text/event-stream` body into the events it carries. Frames are only
 * parsed once their blank-line terminator has arrived, because a read can end
 * anywhere, including inside a frame.
 */
export async function* readEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AnswerEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let end = buffer.indexOf(FRAME_TERMINATOR)
      while (end !== -1) {
        const event = parseFrame(buffer.slice(0, end))
        buffer = buffer.slice(end + FRAME_TERMINATOR.length)
        if (event !== null) yield event
        end = buffer.indexOf(FRAME_TERMINATOR)
      }
    }

    const last = parseFrame(buffer)
    if (last !== null) yield last
  } finally {
    reader.releaseLock()
  }
}

/**
 * Reads one frame's payload. Frames the server sends without data, such as the
 * keep-alive comments that hold an idle connection open, carry no event.
 */
function parseFrame(frame: string): AnswerEvent | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n')

  return data === '' ? null : (JSON.parse(data) as AnswerEvent)
}
