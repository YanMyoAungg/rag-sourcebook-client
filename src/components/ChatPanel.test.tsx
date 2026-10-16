import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, stubServer } from '@/test/http'
import { ChatPanel } from './ChatPanel'

const SERVER = 'http://localhost:3000'

const ANSWERED = {
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
}

function setUp() {
  vi.stubEnv('VITE_API_BASE_URL', SERVER)
  render(<ChatPanel />)

  return {
    ask: screen.getByRole('button', { name: /ask/i }),
    question: screen.getByLabelText(/your question/i),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('ChatPanel', () => {
  it('asks the question and shows the answer with the sources it cited', async () => {
    const user = userEvent.setup()
    const fetchMock = stubServer(() => jsonResponse(ANSWERED))
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)

    expect(await screen.findByText(ANSWERED.answer)).toBeInTheDocument()
    const sources = screen.getByRole('list', { name: 'Sources' })
    expect(within(sources).getByText('guide.md · chunk 3')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${SERVER}/api/chat`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      question: 'Where are chunk embeddings stored?',
    })
  })

  it('keeps the retrieved passages available to inspect', async () => {
    const user = userEvent.setup()
    stubServer(() => jsonResponse(ANSWERED))
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)

    await user.click(await screen.findByText('1 retrieved passage'))

    expect(await screen.findByText(ANSWERED.retrievedChunks[0].content)).toBeVisible()
    expect(screen.getByText('relevance 0.62')).toBeVisible()
  })

  it('reports an answer with no sources without inventing any', async () => {
    const user = userEvent.setup()
    stubServer(() =>
      jsonResponse({
        answer: "I couldn't find an answer to that in the indexed documents.",
        citations: [],
        retrievedChunks: [],
      }),
    )
    const { ask, question } = setUp()

    await user.type(question, 'What is the capital of France?')
    await user.click(ask)

    expect(
      await screen.findByText("I couldn't find an answer to that in the indexed documents."),
    ).toBeInTheDocument()
    expect(screen.queryByText(/sources/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/retrieved passage/i)).not.toBeInTheDocument()
  })

  it("shows the server's reason when the answer fails", async () => {
    const user = userEvent.setup()
    stubServer(() => jsonResponse({ error: 'answer generation failed' }, 502))
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)

    expect(await screen.findByRole('alert')).toHaveTextContent('answer generation failed')
  })

  it('explains a server that cannot be reached', async () => {
    const user = userEvent.setup()
    stubServer(() => {
      throw new TypeError('fetch failed')
    })
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server. Check that it is running, then try again.',
    )
  })

  it('will not send an empty question', async () => {
    const user = userEvent.setup()
    stubServer(() => jsonResponse(ANSWERED))
    const { ask, question } = setUp()

    expect(ask).toBeDisabled()

    await user.type(question, '   ')
    expect(ask).toBeDisabled()

    await user.type(question, 'Why?')
    expect(ask).toBeEnabled()
  })

  it('reports that it is asking and blocks a second question', async () => {
    const user = userEvent.setup()
    let finish: (response: Response) => void = () => {}
    stubServer(() => new Promise<Response>((resolve) => (finish = resolve)))
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)

    expect(await screen.findByRole('status')).toHaveTextContent(/asking/i)
    expect(ask).toBeDisabled()

    finish(jsonResponse(ANSWERED))

    await waitFor(() => expect(screen.getByText(ANSWERED.answer)).toBeInTheDocument())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(ask).toBeEnabled()
  })
})
