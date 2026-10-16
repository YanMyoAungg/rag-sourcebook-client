import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, stubServer } from '@/test/http'
import { DocumentUpload } from './DocumentUpload'

const SERVER = 'http://localhost:3000'

const STORED_DOCUMENT = {
  id: 'd1',
  filename: 'notes.md',
  chunkCount: 1,
  createdAt: '2026-10-16T10:00:00.000Z',
}

function setUp() {
  vi.stubEnv('VITE_API_BASE_URL', SERVER)
  const onUploaded = vi.fn()
  render(<DocumentUpload onUploaded={onUploaded} />)

  return { onUploaded, upload: screen.getByLabelText(/upload document/i) }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('DocumentUpload', () => {
  it('uploads a supported document and reports what was stored', async () => {
    const user = userEvent.setup()
    const fetchMock = stubServer(() => jsonResponse(STORED_DOCUMENT, 201))
    const { onUploaded, upload } = setUp()

    await user.upload(upload, new File(['# Notes\nSome text.'], 'notes.md'))

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(STORED_DOCUMENT))
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({
      filename: 'notes.md',
      content: '# Notes\nSome text.',
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refuses a document the server would not accept, without calling it', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const fetchMock = stubServer(() => jsonResponse(STORED_DOCUMENT, 201))
    const { onUploaded, upload } = setUp()

    await user.upload(upload, new File(['%PDF-1.4'], 'report.pdf'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only .txt and .md files are supported.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('refuses an empty file without calling the server', async () => {
    const user = userEvent.setup()
    const fetchMock = stubServer(() => jsonResponse(STORED_DOCUMENT, 201))
    const { upload } = setUp()

    await user.upload(upload, new File([], 'empty.md'))

    expect(await screen.findByRole('alert')).toHaveTextContent('That file is empty.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("shows the server's reason when indexing fails", async () => {
    const user = userEvent.setup()
    stubServer(() => jsonResponse({ error: 'content must not be empty' }, 400))
    const { onUploaded, upload } = setUp()

    await user.upload(upload, new File(['   '], 'blank.md'))

    expect(await screen.findByRole('alert')).toHaveTextContent('content must not be empty')
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('reports that indexing is in progress and blocks a second upload', async () => {
    const user = userEvent.setup()
    let finish: (response: Response) => void = () => {}
    stubServer(() => new Promise<Response>((resolve) => (finish = resolve)))
    const { onUploaded, upload } = setUp()

    await user.upload(upload, new File(['# Notes'], 'notes.md'))

    expect(await screen.findByRole('status')).toHaveTextContent(/indexing/i)
    expect(screen.getByLabelText(/upload document/i)).toBeDisabled()

    finish(jsonResponse(STORED_DOCUMENT, 201))

    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(STORED_DOCUMENT))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/upload document/i)).toBeEnabled()
  })
})
