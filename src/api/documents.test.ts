import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, stubServer } from '@/test/http'
import { ApiError } from './client'
import {
  ACCEPTED_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  listDocuments,
  uploadDocument,
  validateDocument,
} from './documents'

const SERVER = 'http://localhost:3000'

const STORED_DOCUMENT = {
  id: 'd1',
  filename: 'guide.md',
  chunkCount: 2,
  createdAt: '2026-10-16T10:00:00.000Z',
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('validateDocument', () => {
  it('accepts .txt and .md files', () => {
    expect(validateDocument(new File(['notes'], 'notes.txt'))).toBeNull()
    expect(validateDocument(new File(['# Title'], 'guide.md'))).toBeNull()
  })

  it('accepts those extensions in any case, as the server does', () => {
    expect(validateDocument(new File(['notes'], 'NOTES.TXT'))).toBeNull()
    expect(validateDocument(new File(['# Title'], 'Guide.MD'))).toBeNull()
  })

  it('rejects a document with another extension', () => {
    expect(validateDocument(new File(['%PDF-1.4'], 'report.pdf'))).toBe(
      'Only .txt and .md files are supported.',
    )
  })

  it('rejects an empty file', () => {
    expect(validateDocument(new File([], 'empty.md'))).toBe('That file is empty.')
  })

  it('rejects a file above the one mebibyte limit', () => {
    const oversize = new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], 'big.md')

    expect(validateDocument(oversize)).toBe('That file is larger than 1 MiB.')
  })

  it('accepts a file exactly at the limit', () => {
    const atLimit = new File([new Uint8Array(MAX_DOCUMENT_BYTES)], 'edge.md')

    expect(validateDocument(atLimit)).toBeNull()
  })
})

describe('listDocuments', () => {
  it('returns the documents reported by the server', async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    const fetchMock = stubServer(() => jsonResponse({ documents: [STORED_DOCUMENT] }))

    await expect(listDocuments()).resolves.toEqual([STORED_DOCUMENT])
    expect(fetchMock.mock.calls[0][0]).toBe(`${SERVER}/api/documents`)
  })

  it('returns an empty list when the sourcebook has no documents', async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    stubServer(() => jsonResponse({ documents: [] }))

    await expect(listDocuments()).resolves.toEqual([])
  })

  it('reports the message the server sent with a failure', async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    stubServer(() => jsonResponse({ error: 'database unavailable' }, 500))

    const failure = listDocuments()

    await expect(failure).rejects.toThrow(new ApiError('database unavailable', 500))
    await expect(failure).rejects.toHaveProperty('status', 500)
  })

  it('falls back to the status when a failure carries no message', async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    stubServer(() => new Response('<html>bad gateway</html>', { status: 502 }))

    await expect(listDocuments()).rejects.toThrow('The server returned 502.')
  })

  it('explains that an unreachable server could not be reached', async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    stubServer(() => {
      throw new TypeError('fetch failed')
    })

    await expect(listDocuments()).rejects.toThrow(
      'Could not reach the server. Check that it is running, then try again.',
    )
  })

  it('refuses to guess when no server URL is configured', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    const fetchMock = stubServer(() => jsonResponse({ documents: [] }))

    await expect(listDocuments()).rejects.toThrow(
      'VITE_API_BASE_URL is not set, so the client cannot reach the server.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports an empty body instead of inventing a document list', async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    stubServer(() => new Response('', { status: 200 }))

    await expect(listDocuments()).rejects.toThrow(
      'The server returned an empty response.',
    )
  })
})

describe('uploadDocument', () => {
  it('posts the filename and the file text as JSON', async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    const fetchMock = stubServer(() => jsonResponse(STORED_DOCUMENT, 201))

    const summary = await uploadDocument(new File(['# Title\nbody text'], 'guide.md'))

    expect(summary).toEqual(STORED_DOCUMENT)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${SERVER}/api/documents`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({
      filename: 'guide.md',
      content: '# Title\nbody text',
    })
  })

  it("surfaces the server's reason when indexing fails", async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    stubServer(() => jsonResponse({ error: 'content must not be empty' }, 400))

    await expect(uploadDocument(new File(['   '], 'blank.md'))).rejects.toThrow(
      'content must not be empty',
    )
  })
})

describe('accepted extensions', () => {
  it('exposes the list the server accepts, for the file input', () => {
    expect(ACCEPTED_EXTENSIONS).toEqual(['.txt', '.md'])
    expect(ACCEPTED_EXTENSIONS.join(',')).toBe('.txt,.md')
  })
})
