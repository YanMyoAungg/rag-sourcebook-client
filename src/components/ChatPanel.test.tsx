import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, openSseResponse, sseFrame, sseResponse, stubServer } from '@/test/http'
import { ChatPanel } from './ChatPanel'

const SERVER = 'http://localhost:3000'
const URL_QUERY = 'Where are chunk embeddings stored?'

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

const RUNNING_STEP = {
  id: 'step-1',
  tool: 'search_documents',
  args: { query: URL_QUERY, limit: 5 },
  state: 'running' as const,
}

const COMPLETE_STEP = {
  ...RUNNING_STEP,
  state: 'complete' as const,
  hits: [{ filename: 'guide.md', chunkIndex: 2, relevance: 0.6156 }],
  durationMs: 18,
}

/** The frames the server sends for a question it can answer from one passage. */
function answeredStream(answer: string, result = ANSWERED): Response {
  return sseResponse([
    sseFrame('tool', { type: 'tool', step: RUNNING_STEP }),
    sseFrame('tool', { type: 'tool', step: COMPLETE_STEP }),
    sseFrame('text-delta', { type: 'text-delta', text: answer }),
    sseFrame('finish', { type: 'finish', result: { ...result, answer }, durationMs: 2140 }),
  ])
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
  it('traces the tool it called, then shows the answer with the sources it cited', async () => {
    const user = userEvent.setup()
    const fetchMock = stubServer(() => answeredStream(ANSWERED.answer))
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)

    expect(await screen.findByText(ANSWERED.answer)).toBeInTheDocument()

    // The tool the answer ran, named as an MCP client would call it.
    expect(screen.getByText('search_documents')).toBeInTheDocument()
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByText('Answered in 2.1s')).toBeInTheDocument()

    const sources = screen.getByRole('list', { name: 'Sources' })
    expect(within(sources).getByText('guide.md · chunk 3')).toBeInTheDocument()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${SERVER}/api/chat/stream`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      question: 'Where are chunk embeddings stored?',
    })
  })

  it('shows the tool call while it is still running, with the query it was given', async () => {
    const user = userEvent.setup()
    stubServer(
      (_url, init) =>
        openSseResponse(sseFrame('tool', { type: 'tool', step: RUNNING_STEP }), init?.signal),
    )
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)

    // Running rows are expanded, so the reader sees what is being asked for.
    expect(await screen.findByText('Running')).toBeInTheDocument()
    const row = within(
      screen.getByText('Running').closest('[data-slot="collapsible"]') as HTMLElement,
    )
    expect(row.getByText(URL_QUERY)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/searching the sourcebook/i)
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument()
    expect(ask).toBeDisabled()
  })

  it('stops a question when the reader asks it to', async () => {
    const user = userEvent.setup()
    stubServer(
      (_url, init) =>
        openSseResponse(sseFrame('tool', { type: 'tool', step: RUNNING_STEP }), init?.signal),
    )
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)
    await user.click(await screen.findByRole('button', { name: /stop/i }))

    expect(await screen.findByText('Stopped.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /stop/i })).not.toBeInTheDocument(),
    )

    // The box was cleared when the question was sent, so the next one is typed.
    await user.type(question, 'Where are chunk embeddings stored?')
    expect(ask).toBeEnabled()
  })

  it('keeps the retrieved passages available to inspect', async () => {
    const user = userEvent.setup()
    stubServer(() => answeredStream(ANSWERED.answer))
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)

    await user.click(await screen.findByText('1 retrieved passage'))

    expect(await screen.findByText(ANSWERED.retrievedChunks[0].content)).toBeVisible()
    expect(screen.getByText('relevance 0.62')).toBeVisible()
  })

  it('opens a finished tool call to show its parameters and result', async () => {
    const user = userEvent.setup()
    stubServer(() => answeredStream(ANSWERED.answer))
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)

    // Finished rows collapse, so a reader opens one to see what it did.
    const trigger = await screen.findByRole('button', { name: /search_documents/i })
    await user.click(trigger)

    const row = within(trigger.closest('[data-slot="collapsible"]') as HTMLElement)
    expect(row.getByText('Parameters')).toBeInTheDocument()
    expect(row.getByText('query')).toBeInTheDocument()
    expect(row.getByText(URL_QUERY)).toBeInTheDocument()
    expect(row.getByText('limit')).toBeInTheDocument()
    expect(await row.findByText('guide.md · chunk 3')).toBeInTheDocument()
    expect(row.getByText('0.62')).toBeInTheDocument()
  })

  it('says so when nothing in the sourcebook matched', async () => {
    const user = userEvent.setup()
    stubServer(() =>
      sseResponse([
        sseFrame('tool', { type: 'tool', step: RUNNING_STEP }),
        sseFrame('tool', {
          type: 'tool',
          step: { ...COMPLETE_STEP, hits: [] },
        }),
        sseFrame('finish', {
          type: 'finish',
          result: {
            answer: "I couldn't find an answer to that in the indexed documents.",
            citations: [],
            retrievedChunks: [],
          },
          durationMs: 332,
        }),
      ]),
    )
    const { ask, question } = setUp()

    await user.type(question, 'What is the capital of France?')
    await user.click(ask)

    expect(
      await screen.findByText("I couldn't find an answer to that in the indexed documents."),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/nothing in the sourcebook matched/i)
    expect(screen.queryByRole('list', { name: 'Sources' })).not.toBeInTheDocument()
    expect(screen.queryByText(/retrieved passage/i)).not.toBeInTheDocument()
  })

  it('keeps earlier questions and answers in the thread', async () => {
    const user = userEvent.setup()
    stubServer((_url, init) => {
      const { question: asked } = JSON.parse(String(init?.body))
      return answeredStream(`About: ${asked}`)
    })
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)
    await screen.findByText('About: Where are chunk embeddings stored?')

    await user.type(question, 'And how are they queried?')
    await user.click(ask)

    expect(await screen.findByText('About: And how are they queried?')).toBeInTheDocument()
    expect(screen.getByText('About: Where are chunk embeddings stored?')).toBeInTheDocument()
    expect(screen.getAllByText('search_documents')).toHaveLength(2)
  })

  it("reports the server's reason when the answer fails mid-stream", async () => {
    const user = userEvent.setup()
    stubServer(() =>
      sseResponse([
        sseFrame('tool', { type: 'tool', step: RUNNING_STEP }),
        sseFrame('error', { type: 'error', message: 'answer generation failed' }),
      ]),
    )
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)

    expect(await screen.findByRole('alert')).toHaveTextContent('answer generation failed')
  })

  it("reports the server's reason when the question is refused", async () => {
    const user = userEvent.setup()
    stubServer(() => jsonResponse({ error: 'question must not be empty' }, 400))
    const { ask, question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?')
    await user.click(ask)

    expect(await screen.findByRole('alert')).toHaveTextContent('question must not be empty')
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
    stubServer(() => answeredStream(ANSWERED.answer))
    const { ask, question } = setUp()

    expect(ask).toBeDisabled()

    await user.type(question, '   ')
    expect(ask).toBeDisabled()

    await user.type(question, 'Why?')
    expect(ask).toBeEnabled()
  })

  it('sends on Enter, and keeps Shift+Enter as a line break', async () => {
    const user = userEvent.setup()
    const fetchMock = stubServer(() => answeredStream(ANSWERED.answer))
    const { question } = setUp()

    await user.type(question, 'Where are chunk embeddings stored?{Shift>}{Enter}{/Shift}')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(question).toHaveValue('Where are chunk embeddings stored?\n')

    await user.keyboard('{Enter}')

    expect(await screen.findByText(ANSWERED.answer)).toBeInTheDocument()
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      question: 'Where are chunk embeddings stored?',
    })
  })
  it('explains what the thread does before the first question', () => {
    setUp()

    expect(
      screen.getByText(/Every answer cites the passages it used/),
    ).toBeInTheDocument()
  })
})
