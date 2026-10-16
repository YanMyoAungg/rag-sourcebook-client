import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, stubServer } from '@/test/http'
import { askQuestion } from './chat'

const SERVER = 'http://localhost:3000'

const ANSWERED = {
  answer: 'Chunk embeddings live in Postgres with pgvector. [chunk-1]',
  citations: [{ documentId: 'd1', filename: 'guide.md', chunkIndex: 0 }],
  retrievedChunks: [
    {
      documentId: 'd1',
      filename: 'guide.md',
      chunkIndex: 0,
      content: 'The sourcebook stores chunk embeddings in Postgres.',
      relevance: 0.4558,
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('askQuestion', () => {
  it('posts the question and returns the answer with its citations and passages', async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    const fetchMock = stubServer(() => jsonResponse(ANSWERED))

    const result = await askQuestion('Where are chunk embeddings stored?')

    expect(result).toEqual(ANSWERED)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${SERVER}/api/chat`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      question: 'Where are chunk embeddings stored?',
    })
  })

  it("surfaces the server's reason when it cannot answer", async () => {
    vi.stubEnv('VITE_API_BASE_URL', SERVER)
    stubServer(() => jsonResponse({ error: 'chat is not configured' }, 503))

    await expect(askQuestion('Anything?')).rejects.toThrow('chat is not configured')
  })
})
