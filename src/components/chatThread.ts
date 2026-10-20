import type { AnswerEvent, ChatAnswer, ToolStep } from '@/api/chat'

/** Where a turn is, as the labels around it report it. */
export type TurnStatus = 'waiting' | 'searching' | 'answering' | 'done' | 'stopped' | 'error'

/** One question and everything that has come back for it. */
export type ChatTurn = {
  id: string
  question: string
  /** The tool calls the answer traces, oldest first. */
  steps: ToolStep[]
  /** The answer, growing as its text arrives. */
  answer: string
  /** Set once the stream finishes, carrying citations and the retrieved chunks. */
  result: ChatAnswer | null
  error: string | null
  stopped: boolean
  durationMs: number | null
}

export function newTurn(id: string, question: string): ChatTurn {
  return {
    id,
    question,
    steps: [],
    answer: '',
    result: null,
    error: null,
    stopped: false,
    durationMs: null,
  }
}

export function applyEvent(turn: ChatTurn, event: AnswerEvent): ChatTurn {
  switch (event.type) {
    case 'tool':
      return { ...turn, steps: withStep(turn.steps, event.step) }
    case 'text-delta':
      return { ...turn, answer: turn.answer + event.text }
    case 'finish':
      return {
        ...turn,
        answer: event.result.answer,
        result: event.result,
        durationMs: event.durationMs,
      }
    case 'error':
      return { ...turn, error: event.message }
    default: {
      // The assignment keeps the compiler checking that every known member is
      // handled. At runtime a newer server may add an event this build does
      // not know; ignoring it keeps the turn (and the page) intact.
      const unknown: never = event
      void unknown
      return turn
    }
  }
}

/** A completing event updates the row that its running event opened. */
function withStep(steps: ToolStep[], step: ToolStep): ToolStep[] {
  const index = steps.findIndex((existing) => existing.id === step.id)

  return index === -1
    ? [...steps, step]
    : steps.map((existing, position) => (position === index ? step : existing))
}

export function failTurn(turn: ChatTurn, message: string): ChatTurn {
  return { ...turn, error: message }
}

export function stopTurn(turn: ChatTurn): ChatTurn {
  return { ...turn, stopped: true }
}

/**
 * Where the turn is, derived from what has arrived rather than tracked beside
 * it, so the label cannot drift out of step with the events.
 */
export function turnStatus(turn: ChatTurn): TurnStatus {
  if (turn.error !== null) return 'error'
  if (turn.stopped) return 'stopped'
  if (turn.result !== null) return 'done'
  if (turn.steps.length === 0) return 'waiting'

  return turn.steps.some((step) => step.state === 'running') ? 'searching' : 'answering'
}

export function isWorking(status: TurnStatus): boolean {
  return status === 'waiting' || status === 'searching' || status === 'answering'
}
