import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, stubServer } from '@/test/http'
import App from './App'

const SERVER = 'http://localhost:3000'

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', SERVER)
  stubServer(() => jsonResponse({ documents: [] }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('App shell', () => {
  it('shows the app name as a top-level heading', () => {
    render(<App />)

    expect(screen.getByRole('heading', { level: 1, name: /rag sourcebook/i })).toBeInTheDocument()
  })

  it('offers a labelled control for uploading .txt and .md documents', () => {
    render(<App />)

    const upload = screen.getByLabelText(/upload document/i)

    expect(upload).toHaveAttribute('type', 'file')
    expect(upload).toHaveAttribute('accept', '.txt,.md')
  })

  it('lists what the sourcebook already holds', async () => {
    stubServer(() =>
      jsonResponse({
        documents: [
          {
            id: 'd1',
            filename: 'guide.md',
            chunkCount: 3,
            createdAt: '2026-10-16T10:00:00.000Z',
          },
        ],
      }),
    )

    render(<App />)

    expect(await screen.findByText('guide.md')).toBeInTheDocument()
    expect(screen.getByText('3 chunks')).toBeInTheDocument()
  })
})
