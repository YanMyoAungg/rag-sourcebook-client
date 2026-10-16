import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, sseFrame, sseResponse, stubServer } from '@/test/http'
import { readEvents, streamAsk } from './chat'
import type { AnswerEvent } from './chat'

const SERVER = 'http://localhost:3000'

const RUNNING: AnswerEvent = {
  type: 'tool',
  step: {
    id: 'step-1',
    tool: 'search_documents',
    args: { query: 'Where are embeddings stored?', limit: 5 },
    state: 'running',
  },
}

const FINISHED: AnswerEvent = {
  type: 'finish',
  result: {
    answer: 'Chunk embeddings live in Postgres with pgvector. [chunk-3]',
    citations: [{ documentId: 'd1', filename: 'guide.md', chunkIndex: 2 }],
    retrievedChunks: [
      {
        documentId: 'd1',
        filename: 'guide.md',
        chunkIndex: 2,
        content: 'Chunk embeddings are stored in Postgres with the pgvector extension.',
        relevance: 0.6156,
      },
    ],
  },
  durationMs: 2140,
}

async function collect(body: ReadableStream<Uint8Array>): Promise<AnswerEvent[]> {
  const events: AnswerEvent[] = []
  for await (const event of readEvents(body)) {
    events.push(event)
  }
  return events
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('readEvents', () => {
  it('reads the events a stream carries, in order', async () => {
    const body = sseResponse([sseFrame('tool', RUNNING), sseFrame('finish', FINISHED)]).body!

    expect(await collect(body)).toEqual([RUNNING, FINISHED])
  })

  it('parses frames that a read splits apart', async () => {
    const frame = sseFrame('tool', RUNNING)
    // A read can end anywhere, including inside a frame's JSON.
    const body = sseResponse([frame.slice(0, 9), frame.slice(9, 22), frame.slice(22)]).body!

    expect(await collect(body)).toEqual([RUNNING])
  })

  it('ignores keep-alive comments and other frames without data', async () => {
    const body = sseResponse([': keep-alive\n\n', 'event: ping\n\n', sseFrame('tool', RUNNING)]).body!

    expect(await collect(body)).toEqual([RUNNING])
  })

  it('reads a final frame that arrives without its terminator', async () => {
    const body = sseResponse([sseFrame('tool', RUNNING), `data: ${JSON.stringify(FINISHED)}`]).body!

    expect(await collect(body)).toEqual([RUNNING, FINISHED])
  })

  it('joins a payload that arrived across several data lines', async () => {
    // The server writes one data line per event; the format allows more, and
    // every data line of a frame belongs to the same event.
    const payload = JSON.stringify({ type: 'text-delta', text: 'Chunk embeddings.' }, null, 2)
    const frame = `${payload
      .split('\n')
      .map((line) => `data: ${line}`)
      .join('\n')}\n\n`
    const body = sseResponse([frame, sseFrame('finish', FINISHED)]).body!

    expect(await collect(body)).toEqual([
      { type: 'text-delta', text: 'Chunk embeddings.' },
      FINISHED,
    ])
  })
})

describe('streamAsk', () => {
  it('posts the question to the stream endpoint and reports each event', async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    const fetchMock = stubServer(() =>
      sseResponse([sseFrame('tool', RUNNING), sseFrame('finish', FINISHED)]),
    )
    const events: AnswerEvent[] = []

    await streamAsk('Where are embeddings stored?', (event) => events.push(event), new AbortController().signal)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${SERVER}/api/chat/stream`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ question: 'Where are embeddings stored?' })
    expect(events).toEqual([RUNNING, FINISHED])
  })

  it("reports the server's reason when the request is refused", async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    stubServer(() => jsonResponse({ error: 'question must not be empty' }, 400))

    await expect(
      streamAsk('  ', () => {}, new AbortController().signal),
    ).rejects.toThrow('question must not be empty')
  })

  it('explains a server that cannot be reached', async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    stubServer(() => {
      throw new TypeError('fetch failed')
    })

    await expect(
      streamAsk('Where are embeddings stored?', () => {}, new AbortController().signal),
    ).rejects.toThrow('Could not reach the server. Check that it is running, then try again.')
  })

  it('reports the failure the server sends after the stream opens', async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    stubServer(() =>
      sseResponse([sseFrame('tool', RUNNING), sseFrame('error', { type: 'error', message: 'answer generation failed' })]),
    )
    const events: AnswerEvent[] = []

    await streamAsk('Where are embeddings stored?', (event) => events.push(event), new AbortController().signal)

    expect(events.at(-1)).toEqual({ type: 'error', message: 'answer generation failed' })
  })
})
