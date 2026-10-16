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
