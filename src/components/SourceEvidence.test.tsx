import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SourceEvidence } from './SourceEvidence'

const CHUNK = {
  documentId: 'd1',
  filename: 'guide.md',
  chunkIndex: 2,
  content: 'Chunk embeddings are stored in Postgres with the pgvector extension.',
  relevance: 0.6156,
}

describe('SourceEvidence', () => {
  it('summarises how many passages were retrieved', () => {
    render(<SourceEvidence chunks={[CHUNK]} />)

    expect(screen.getByText('1 retrieved passage')).toBeInTheDocument()
  })

  it('pluralises the summary for several passages', () => {
    render(<SourceEvidence chunks={[CHUNK, { ...CHUNK, documentId: 'd2' }]} />)

    expect(screen.getByText('2 retrieved passages')).toBeInTheDocument()
  })

  it('names the passage, numbers it as the answer does, and reports its relevance', async () => {
    const user = userEvent.setup()
    render(<SourceEvidence chunks={[CHUNK]} />)

    await user.click(screen.getByText('1 retrieved passage'))

    expect(screen.getByText('guide.md · chunk 3')).toBeInTheDocument()
    expect(screen.getByText('relevance 0.62')).toBeInTheDocument()
    expect(screen.getByText(CHUNK.content)).toBeVisible()
  })

  it('renders nothing when no passages were retrieved', () => {
    const { container } = render(<SourceEvidence chunks={[]} />)

    expect(container).toBeEmptyDOMElement()
  })
})
