/**
 * One place that knows how to talk to the RAG Sourcebook server: where it lives,
 * how failures are shaped, and what a user-facing message looks like.
 */

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ApiError'
    this.status = status
  }
}

/** A message worth showing a person, whatever came out of a failed call. */
export function errorMessage(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.'
}

/**
 * Read at call time rather than at module load, so a missing value fails the
 * request that needs it instead of the whole app.
 */
export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL

  if (typeof configured !== 'string' || configured.trim() === '') {
    throw new ApiError(
      'VITE_API_BASE_URL is not set, so the client cannot reach the server.',
      0,
    )
  }

  return configured.trim().replace(/\/+$/, '')
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })
  } catch (cause) {
    if (cause instanceof ApiError) throw cause

    throw new ApiError(
      'Could not reach the server. Check that it is running, then try again.',
      0,
      { cause },
    )
  }

  const body = await readJson(response)

  if (!response.ok) {
    throw new ApiError(serverMessage(body) ?? `The server returned ${response.status}.`, response.status)
  }

  if (body === undefined) {
    throw new ApiError('The server returned an empty response.', response.status)
  }

  return body as T
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return undefined

  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The server reports failures as `{ error: string }`. */
function serverMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null

  const { error } = body as { error: unknown }
  return typeof error === 'string' && error.trim() !== '' ? error : null
}
