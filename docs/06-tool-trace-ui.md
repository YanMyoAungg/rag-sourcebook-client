# 6. Tool trace UI

> The collapsible row per tool call — status chip, duration, parameters, and
> result — plus the one live status line under it.

## What it does

Shows what the server did for a question, in order, above the answer it produced.
Each call is a row that opens while it is running and afterwards only on request.
Below the rows, one line reports the phase in words.

Two components: `ActivityTrace` (the list plus the status line) and `ToolCallRow`
(one call).

## How it works

### The trace

```tsx
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
```

- **`role="status"` is on the status line and nowhere else.** That is the
  accessibility decision that makes streaming usable with a screen reader: the
  phase is announced when it changes, while the answer text above grows without
  being read out word by word.
- **`motion-safe:` on both the dot and the label.** The pulse is opt-in for
  readers who have not asked for reduced motion; with
  `prefers-reduced-motion: reduce` there are zero pulsing elements (verified in
  the browser, not assumed).
- **The dot is `aria-hidden`.** It repeats what the words already say.

```tsx
function statusLabel(turn: ChatTurn): string {
  switch (turnStatus(turn)) {
    case 'waiting':   return 'Contacting the server…'
    case 'searching': return 'Searching the sourcebook…'
    case 'answering': return 'Writing the answer…'
    case 'stopped':   return 'Stopped.'
    case 'error':     return 'That question did not finish.'
    case 'done': {
      // An abstention is a result worth naming: nothing matched, so nothing was
      // written, and the reader can see that rather than trusting it.
      if (turn.result !== null && turn.result.retrievedChunks.length === 0) {
        return 'Nothing in the sourcebook matched, so no answer was written.'
      }

      return turn.durationMs === null ? 'Done.' : `Answered in ${formatDuration(turn.durationMs)}`
    }
  }
}
```

The labels are sentences, not states, and the `done` case is the interesting one:
it reads the *result*, not just the status, because two very different things both
end in `done`. An abstention says so plainly instead of showing "Answered in
698ms" next to "I couldn't find an answer" — which would be technically accurate
and confusing.

### One row

```tsx
export function ToolCallRow({ step }: { step: ToolStep }) {
  const [opened, setOpened] = useState(false)
  // Open while the call is in flight; afterwards, only if the reader asks.
  const open = opened || step.state === 'running'

  return (
    <Collapsible open={open} onOpenChange={setOpened} className="rounded-md border border-border bg-card">
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
          <ChevronDownIcon aria-hidden className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </span>
      </CollapsibleTrigger>
      …
    </Collapsible>
  )
}
```

- **`open = opened || step.state === 'running'`** — the row is forced open while
  the call is in flight, so a reader watching sees the arguments and the
  "Searching…" line without clicking. Once it completes, it closes unless the
  reader opened it, so a finished thread is compact.
- **The trigger is the whole row** (`w-full`, `text-left`), which is what makes it
  reachable and clickable across its width. It is a real button (from
  `Collapsible`), so Enter and Space work without extra handlers — verified: the
  row toggles with Enter alone and `aria-expanded` flips.
- **The tool name, the duration, and the numbers are monospace with
  `tabular-nums`.** This is the one place the design deliberately borrows the
  register of a developer tool: things you might compare character by character
  are set in mono.
- **The chevron rotates with the open state**, and is `aria-hidden` because the
  disclosure's own state is already in the accessibility tree.

### The status chip

```tsx
function StatusChip({ state }: { state: ToolStep['state'] }) {
  const Icon = state === 'running' ? ClockIcon : state === 'complete' ? CheckCircleIcon : XCircleIcon
  const label = state === 'running' ? 'Running' : state === 'complete' ? 'Complete' : 'Failed'

  return (
    <span className={cn(
      'inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground',
      state === 'running' && 'motion-safe:animate-pulse',
    )}>
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  )
}
```

The component's doc comment names the rule: *"Status is written out as well as
coloured, so it survives a monochrome screen or a colour-blind reader."* The chip
is a word plus an icon, not a coloured dot — there is no state that is only
communicated by hue.

### What opening it shows

```tsx
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

/** Tool arguments are read as they were sent: strings bare, anything else as JSON. */
function formatArgument(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
```

Parameters are a definition list — the argument name and its value — because that
is what they are: a name and a value, not a sentence. Strings are shown bare (a
query reads as a query); anything else is JSON, so a nested object is at least
unambiguous.

```tsx
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
        <li key={`${hit.filename}-${hit.chunkIndex}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-mono text-xs">{hit.filename} · chunk {hit.chunkIndex + 1}</span>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {hit.relevance.toFixed(2)}
          </span>
        </li>
      ))}
    </ul>
  )
}
```

A result is the hits the search returned: filename, chunk number (the data's
0-based index shown as a person counts, matching the answer's citation badges),
and the relevance to two decimals. **No content** — the trace never carries chunk
text ([server: Grounded answering](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/06-grounded-answering.md)); the
passages appear once, under the answer.

The failures come before the floors, and each branch says the true thing for its
state: a call still in flight is *searching*; a call that threw *failed*; a call
that returned with nothing cleared the floor. An empty result is why the
abstention is not a mystery: it says *why* the model was not asked, instead of
leaving the reader to guess from an answer that is politely blank.

The failure branch is checked before the empty-result branch deliberately. The
server reports a failed call as `state: "error"` with **no** `hits`
([server: Grounded answering](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/06-grounded-answering.md)),
so ordering those two tests the other way round makes a failed search read as a
relevance rejection — which is not what happened. `ToolCallRow.test.tsx` renders
the row directly with a hand-built step to pin each of those sentences, which is
the cheapest way to cover wording that only shows up when something goes wrong.

## Decisions and rejected alternatives

- **The AI Elements `Tool` pattern, ported rather than installed.** The shape
  (icon, monospace name, status, disclosure with parameters and result) is what
  coding agents show, and it is what the project's requirement asked for. Porting
  it as two local components avoided pulling in `ai`, `streamdown`, and
  `use-stick-to-bottom` for markup and a `Collapsible`.
- **Open while running, closed afterwards.** The reader's attention during the
  wait is on the call; afterwards it is on the answer. The alternative — always
  open — makes a long thread unreadable; always closed hides the wait entirely.
- **Status as words plus an icon, never colour alone.** Non-negotiable for
  accessibility, and it also makes the trace legible in a screenshot.
- **One live region, on the status line.** Announcing every delta would make the
  app unusable with a screen reader. Announcing nothing would leave a reader
  unaware that anything was happening.
- **The abstention wording lives here, not in the answer text.** The server sends
  the sentence it sends; the label is the client's own explanation of the phase,
  and the two are deliberately different sentences for different purposes. The
  failure sentence is the client's own too, and it stays generic on purpose: the
  trace's error step carries a state and a duration but no message, so the row
  cannot say *what* failed — the turn's error paragraph does that.
- **`toFixed(2)` on relevance in the UI.** Two decimals match the evidence list
  below the answer; the MCP text output uses three for terminal comparison. Each
  surface is internally consistent.

## Where it can bite you

- **The failed-call wording is generic.** The trace's error step carries `state`
  and `durationMs` but no message, so the row can only say the search failed, not
  why; the turn's own error paragraph is what names the cause. If the server ever
  puts a message on the step, this row should show it.
- **The disclosure state is local and lost on remount.** Any remount of the
  exchange (a key change, a list re-render that replaces the element) resets
  `opened` to `false`.
- **A non-string argument is JSON on one line with `break-all`.** A large nested
  argument would break mid-token across many lines; nothing truncates or wraps it
  as JSON.
- **Chunk keys are `filename` + index,** not the document id. Two documents with
  the same filename and chunk index would collide as React keys within one row,
  and the later hit would silently not render. (The citation badges use
  `documentId` + index, so this exists only inside the trace's result list.)
- **The trace renders as many rows as the server traced.** One call per question
  today; nothing bounds the list.
- **No copy button or raw JSON view.** The parameters are shown, not exportable.

## Questions this invites

**Why does the row force itself open while running, then collapse?**
Because the two moments have different questions. While waiting: *what is it
doing?* Afterwards: *what did it use?* Forcing it open costs nothing during the
wait and leaves the finished thread scannable.

**Why is the status line the only live region?**
`role="status"` is announced politely. Putting it on the answer paragraph would
interrupt with every delta; putting it nowhere would leave a screen-reader user
with silence between question and answer. Phase in words, answer in text, is the
division that works.

**What does the reader learn from the relevance number?**
That retrieval scored the passage, and roughly how strongly. It is also the only
place the `0.35` floor is visible in operation: a hit shown at `0.41` cleared it,
and the abstention message means nothing did
([server: Retrieval and relevance](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/05-retrieval-and-relevance.md)).

**Why does the trace not show chunk content?**
Because the same content is shown once, under the answer, in the retrieved-passages
disclosure ([Answer, citations, and evidence](07-answer-citations-evidence.md)).
Duplicating a thousand characters per hit inside a collapsible row would grow the
stream and the DOM for no new information.

**How would a second tool change this component?**
Not at all: it maps `turn.steps` in order and renders one row each. The
interesting work would be on the server, giving each call a distinct id
([server: Grounded answering](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/06-grounded-answering.md)).

## Related

- [Thread state](05-thread-state.md) — `turnStatus`, `isWorking`, and the step
  list this renders.
- [Answer, citations, and evidence](07-answer-citations-evidence.md) — what sits
  under the trace.
- [Dark theme and design tokens](08-dark-theme-and-tokens.md) — the mono font and
  neutral palette referenced here.
