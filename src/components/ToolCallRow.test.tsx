import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ToolStep } from '@/api/chat'
import { ToolCallRow } from './ToolCallRow'

const CALL = {
  id: 'step-1',
  tool: 'search_documents',
  args: { query: 'Where are chunk embeddings stored?', limit: 5 },
  durationMs: 12,
}

/** A finished row collapses, so a reader opens one before its result is visible. */
async function openRow(step: ToolStep) {
  const user = userEvent.setup()
  render(<ToolCallRow step={step} />)

  const trigger = screen.getByRole('button', { name: /search_documents/i })
  await user.click(trigger)

  return within(trigger.closest('[data-slot="collapsible"]') as HTMLElement)
}

describe('ToolCallRow', () => {
  it('reports a failed search as a failure, not as a relevance rejection', async () => {
    const row = await openRow({ ...CALL, state: 'error' })

    expect(row.getByText('Failed')).toBeInTheDocument()
    expect(row.getByText(/the search failed/i)).toBeInTheDocument()
    expect(row.queryByText(/relevance floor/i)).not.toBeInTheDocument()
  })

  it('explains an empty result as the relevance floor turning the model away', async () => {
    const row = await openRow({ ...CALL, state: 'complete', hits: [] })

    expect(row.getByText('Complete')).toBeInTheDocument()
    expect(row.getByText(/relevance floor/i)).toBeInTheDocument()
  })
})
