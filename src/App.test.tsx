import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

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
})
