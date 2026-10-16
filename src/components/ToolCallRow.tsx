import { useState } from 'react'
import { CheckCircleIcon, ChevronDownIcon, ClockIcon, WrenchIcon, XCircleIcon } from 'lucide-react'
import type { ToolStep } from '@/api/chat'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { formatDuration } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * One tool call, in the shape a coding agent shows them: the tool's name, what
 * it was asked, how it ended, and — behind a disclosure — the arguments and the
 * result. Status is written out as well as coloured, so it survives a
 * monochrome screen or a colour-blind reader.
 */
export function ToolCallRow({ step }: { step: ToolStep }) {
  const [opened, setOpened] = useState(false)
  // Open while the call is in flight; afterwards, only if the reader asks.
  const open = opened || step.state === 'running'

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpened}
      className="rounded-md border border-border bg-card"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40">
        <WrenchIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-xs">{step.tool}</span>
        <StatusChip state={step.state} />
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {step.durationMs === undefined ? null : (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {formatDuration(step.durationMs)}
            </span>
          )}
          <ChevronDownIcon
            aria-hidden
            className={cn(
              'size-3.5 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="border-t border-border px-3 py-2">
        <div className="flex flex-col gap-3">
          <Section title="Parameters">
            <dl className="flex flex-col gap-1">
              {Object.entries(step.args).map(([name, value]) => (
                <div key={name} className="flex flex-wrap gap-x-2">
                  <dt className="font-mono text-xs text-muted-foreground">{name}</dt>
                  <dd className="font-mono text-xs break-all">{formatArgument(value)}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="Result">
            <Result step={step} />
          </Section>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function StatusChip({ state }: { state: ToolStep['state'] }) {
  const Icon =
    state === 'running' ? ClockIcon : state === 'complete' ? CheckCircleIcon : XCircleIcon
  const label = state === 'running' ? 'Running' : state === 'complete' ? 'Complete' : 'Failed'

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground',
        state === 'running' && 'motion-safe:animate-pulse',
      )}
    >
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      {children}
    </div>
  )
}

function Result({ step }: { step: ToolStep }) {
  if (step.state === 'running') {
    return <p className="text-xs text-muted-foreground">Searching the sourcebook…</p>
  }

  if (step.state === 'error') {
    return (
      <p className="text-xs text-muted-foreground">
        The search failed, so the model was not asked.
      </p>
    )
  }

  if (step.hits === undefined || step.hits.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No passage cleared the relevance floor, so the model was not asked.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-1">
      {step.hits.map((hit) => (
        <li
          key={`${hit.filename}-${hit.chunkIndex}`}
          className="flex flex-wrap items-baseline justify-between gap-x-3"
        >
          <span className="font-mono text-xs">
            {hit.filename} · chunk {hit.chunkIndex + 1}
          </span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {hit.relevance.toFixed(2)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Tool arguments are read as they were sent: strings bare, anything else as JSON. */
function formatArgument(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
