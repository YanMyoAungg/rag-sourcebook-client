import type { ChatTurn } from '@/components/chatThread'
import { isWorking, turnStatus } from '@/components/chatThread'
import { ToolCallRow } from '@/components/ToolCallRow'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * What the agent did for one question, in order, above the answer it produced.
 * The status line is the only live region: the answer streams past it without
 * being announced word by word.
 */
export function ActivityTrace({ turn }: { turn: ChatTurn }) {
  const status = turnStatus(turn)

  return (
    <div className="flex flex-col gap-2">
      {turn.steps.map((step) => (
        <ToolCallRow key={step.id} step={step} />
      ))}

      <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
        {isWorking(status) ? (
          <span aria-hidden className="size-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
        ) : null}
        <span className={cn(isWorking(status) && 'motion-safe:animate-pulse')}>
          {statusLabel(turn)}
        </span>
      </p>
    </div>
  )
}

function statusLabel(turn: ChatTurn): string {
  switch (turnStatus(turn)) {
    case 'waiting':
      return 'Contacting the server…'
    case 'searching':
      return 'Searching the sourcebook…'
    case 'answering':
      return 'Writing the answer…'
    case 'stopped':
      return 'Stopped.'
    case 'error':
      return 'That question did not finish.'
    case 'done': {
      // An abstention is a result worth naming: nothing matched, so nothing was
      // written, and the reader can see that rather than trusting it.
      if (turn.result !== null && turn.result.retrievedChunks.length === 0) {
        return 'Nothing in the sourcebook matched, so no answer was written.'
      }

      return turn.durationMs === null
        ? 'Done.'
        : `Answered in ${formatDuration(turn.durationMs)}`
    }
  }
}
