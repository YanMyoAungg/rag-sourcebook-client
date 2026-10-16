import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, stubServer } from '@/test/http'
import { DocumentLibrary } from './DocumentLibrary'

const SERVER = 'http://localhost:3000'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function renderLibrary() {
  vi.stubEnv('VITE_API_BASE_URL', SERVER)
  render(<DocumentLibrary />)
}

describe('DocumentLibrary', () => {
  it('lists each indexed document with its chunk count', async () => {
    stubServer(() =>
      jsonResponse({
        documents: [
          {
            id: 'd1',
            filename: 'guide.md',
            chunkCount: 3,
            createdAt: '2026-10-16T10:00:00.000Z',
          },
          {
            id: 'd2',
            filename: 'notes.txt',
            chunkCount: 1,
            createdAt: '2026-10-16T09:00:00.000Z',
          },
        ],
      }),
    )

    renderLibrary()

    expect(await screen.findByText('guide.md')).toBeInTheDocument()
    expect(screen.getByText('3 chunks')).toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    expect(screen.getByText('1 chunk')).toBeInTheDocument()
  })

  it('says so when the sourcebook holds nothing yet', async () => {
    stubServer(() => jsonResponse({ documents: [] }))

    renderLibrary()

    expect(await screen.findByText(/no documents/i)).toBeInTheDocument()
  })

  it('reports that it is loading before the documents arrive', () => {
    stubServer(() => new Promise<Response>(() => {}))

    renderLibrary()

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it("shows the server's reason when the list cannot be read", async () => {
    stubServer(() => jsonResponse({ error: 'database unavailable' }, 500))

    renderLibrary()

    expect(await screen.findByRole('alert')).toHaveTextContent('database unavailable')
  })

  it('explains a server that cannot be reached at all', async () => {
    stubServer(() => {
      throw new TypeError('fetch failed')
    })

    renderLibrary()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not reach the server. Check that it is running, then try again.',
    )
  })
})
