import { vi } from 'vitest'

/**
 * Replaces global fetch with a handler that receives the resolved URL and init,
 * so tests exercise the real request code instead of a mocked API module.
 */
export function stubServer(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return handler(url, init)
  })

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** One Server-Sent Events frame, as `POST /api/chat/stream` writes them. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * A `text/event-stream` response whose body arrives in the given chunks, so a
 * test can split frames at whatever boundary it means to exercise.
 */
export function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })

  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

/**
 * A stream that delivers its frames and then stays open until the request is
 * aborted, the way a slow answer behaves: reads fail once the caller gives up.
 */
export function openSseResponse(chunk: string, signal: AbortSignal | null | undefined): Response {
  const encoder = new TextEncoder()

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(chunk))
      signal?.addEventListener('abort', () => {
        controller.error(new DOMException('The request was aborted.', 'AbortError'))
      })
    },
  })

  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}
