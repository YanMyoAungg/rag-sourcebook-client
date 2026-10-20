import { describe, expect, it } from 'vitest'
import type { AnswerEvent, ToolStep } from '@/api/chat'
import {
  applyEvent,
  failTurn,
  isWorking,
  newTurn,
  stopTurn,
  turnStatus,
} from './chatThread'

const RUNNING: ToolStep = {
  id: 'step-1',
  tool: 'search_documents',
  args: { query: 'Where are embeddings stored?', limit: 5 },
  state: 'running',
}

const COMPLETE: ToolStep = {
  ...RUNNING,
  state: 'complete',
  hits: [{ filename: 'guide.md', chunkIndex: 2, relevance: 0.6156 }],
  durationMs: 18,
}

const RESULT = {
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

describe('turnStatus', () => {
  it('reports a question that has answered nothing yet as waiting', () => {
    expect(turnStatus(newTurn('t1', 'q'))).toBe('waiting')
    expect(isWorking(turnStatus(newTurn('t1', 'q')))).toBe(true)
  })

  it('reports a running tool call as searching', () => {
    const turn = applyEvent(newTurn('t1', 'q'), { type: 'tool', step: RUNNING })

    expect(turnStatus(turn)).toBe('searching')
  })

  it('reports a completed search as answering', () => {
    const turn = applyEvent(
      applyEvent(newTurn('t1', 'q'), { type: 'tool', step: RUNNING }),
      { type: 'tool', step: COMPLETE },
    )

    expect(turnStatus(turn)).toBe('answering')
  })

  it('reports a finished turn as done, and stops calling it working', () => {
    const turn = applyEvent(newTurn('t1', 'q'), {
      type: 'finish',
      result: RESULT,
      durationMs: 2140,
    })

    expect(turnStatus(turn)).toBe('done')
    expect(isWorking(turnStatus(turn))).toBe(false)
  })

  it('reports a stopped turn as stopped', () => {
    const turn = stopTurn(applyEvent(newTurn('t1', 'q'), { type: 'tool', step: RUNNING }))

    expect(turnStatus(turn)).toBe('stopped')
    expect(isWorking(turnStatus(turn))).toBe(false)
  })

  it('reports a failed turn as an error', () => {
    const turn = failTurn(newTurn('t1', 'q'), 'answer generation failed')

    expect(turnStatus(turn)).toBe('error')
    expect(turn.error).toBe('answer generation failed')
  })
})

describe('applyEvent', () => {
  it('updates the row an event opened instead of adding a second one', () => {
    const opened = applyEvent(newTurn('t1', 'q'), { type: 'tool', step: RUNNING })
    const closed = applyEvent(opened, { type: 'tool', step: COMPLETE })

    expect(closed.steps).toEqual([COMPLETE])
  })

  it('keeps calls in the order they were made', () => {
    const second: ToolStep = { ...RUNNING, id: 'step-2' }
    const turn = applyEvent(
      applyEvent(newTurn('t1', 'q'), { type: 'tool', step: RUNNING }),
      { type: 'tool', step: second },
    )

    expect(turn.steps.map((step) => step.id)).toEqual(['step-1', 'step-2'])
  })

  it('appends text deltas in the order they arrive', () => {
    const turn = applyEvent(
      applyEvent(newTurn('t1', 'q'), { type: 'text-delta', text: 'Chunk ' }),
      { type: 'text-delta', text: 'embeddings.' },
    )

    expect(turn.answer).toBe('Chunk embeddings.')
    expect(turn.result).toBeNull()
  })

  it('takes the answer, citations, and duration from the finish event', () => {
    const streamed = applyEvent(newTurn('t1', 'q'), {
      type: 'text-delta',
      text: 'a partial answer',
    })
    const turn = applyEvent(streamed, { type: 'finish', result: RESULT, durationMs: 2140 })

    expect(turn.answer).toBe(RESULT.answer)
    expect(turn.result).toEqual(RESULT)
    expect(turn.durationMs).toBe(2140)
  })

  it('records a failure the server reports mid-stream', () => {
    const turn = applyEvent(newTurn('t1', 'q'), {
      type: 'error',
      message: 'answer generation failed',
    })

    expect(turn.error).toBe('answer generation failed')
  })

  it('leaves the turn untouched for an event type it does not know', () => {
    const turn = newTurn('t1', 'q')

    // A newer server may add an event; it must not replace the turn with
    // undefined and take the page down.
    expect(applyEvent(turn, { type: 'heartbeat' } as unknown as AnswerEvent)).toBe(turn)
  })

  it('leaves the steps and text a stopped turn had already received', () => {
    const turn = stopTurn(
      applyEvent(applyEvent(newTurn('t1', 'q'), { type: 'tool', step: COMPLETE }), {
        type: 'text-delta',
        text: 'Chunk',
      }),
    )

    expect(turn.steps).toEqual([COMPLETE])
    expect(turn.answer).toBe('Chunk')
    expect(turn.result).toBeNull()
  })
})
