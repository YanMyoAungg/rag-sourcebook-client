# 5. Thread state

> The turn record, the pure functions that fold events into it, and why the
> status a label shows is derived from the data rather than stored beside it.

## What it does

Holds everything that has arrived for one question and knows how to absorb the
next event. It has no React in it: `chatThread.ts` is a plain module of types and
pure functions, which is why it can be tested by calling it
(`chatThread.test.ts`, 12 tests, no DOM).

## How it works

### The record

```ts
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
```

Every field is a fact that arrived, and nothing in the record is a conclusion:
there is no `status` field, no `isLoading`, no `hasAnswer`. `result` being
non-null *is* "finished"; `steps` being empty *is* "nothing has happened yet".

### Folding one event

```ts
export function applyEvent(turn: ChatTurn, event: AnswerEvent): ChatTurn {
  switch (event.type) {
    case 'tool':
      return { ...turn, steps: withStep(turn.steps, event.step) }
    case 'text-delta':
      return { ...turn, answer: turn.answer + event.text }
    case 'finish':
      return { ...turn, answer: event.result.answer, result: event.result, durationMs: event.durationMs }
    case 'error':
      return { ...turn, error: event.message }
  }
}
```

- **`tool` appends or updates**, which is the payoff of the server's stable
  `step.id`:

```ts
/** A completing event updates the row that its running event opened. */
function withStep(steps: ToolStep[], step: ToolStep): ToolStep[] {
  const index = steps.findIndex((existing) => existing.id === step.id)

  return index === -1
    ? [...steps, step]
    : steps.map((existing, position) => (position === index ? step : existing))
}
```

  The running event opens a row; the complete event **replaces** that row,
  keeping its position. Without the id, the trace would show the same call twice.

- **`text-delta` appends.** Deltas arrive many times; this is the hot path during
  an answer.
- **`finish` replaces the answer rather than trusting the accumulated text.** The
  concatenated deltas and the final `answer` should be identical; taking the
  server's value makes the final state authoritative, so a dropped or duplicated
  delta cannot leave the visible answer different from the answer the citations
  were computed against.
- **`error` records the message.** It does not clear steps or the partial answer
  — a failure after four sentences of text leaves those four sentences on screen,
  which is useful and honest.

Every case returns a new object. React compares by identity, so a mutation would
update the data and skip the render.

The switch has no `default` case and the function is annotated `: ChatTurn`. A new
member added to `AnswerEvent` therefore leaves a reachable end-of-function, which
the compiler rejects — the reducer cannot silently ignore a new event type.

### Two endings the events do not describe

```ts
export function failTurn(turn: ChatTurn, message: string): ChatTurn {
  return { ...turn, error: message }
}

export function stopTurn(turn: ChatTurn): ChatTurn {
  return { ...turn, stopped: true }
}
```

`failTurn` is for a rejection that never became an `error` event — a 400 on the
request, a network failure. `stopTurn` is for the reader's *Stop*: it is not a
failure and must not read like one, so it sets a separate flag that the status
logic treats as its own case.

### Status, derived

```ts
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
```

The order is the priority order, and each step is a question about the data:

| Order | Condition | Status | What the reader is told |
| --- | --- | --- | --- |
| 1 | `error !== null` | `error` | "That question did not finish." |
| 2 | `stopped` | `stopped` | "Stopped." |
| 3 | `result !== null` | `done` | "Answered in 3.8s", or the abstention wording |
| 4 | `steps.length === 0` | `waiting` | "Contacting the server…" |
| 5 | any step still running | `searching` | "Searching the sourcebook…" |
| 6 | otherwise | `answering` | "Writing the answer…" |

Two ordering decisions are worth naming:

- **Failure and stop outrank finish.** A turn cannot be both, but if it somehow
  were, the reader needs to know it failed.
- **`searching` is keyed on a step's own state, not on a flag.** The moment the
  tool-complete event lands, the label becomes "Writing the answer…" — because
  the data changed, not because something remembered to set a phase.

`isWorking` exists so that "is a pulse shown" is one predicate rather than a list
of statuses repeated in the view ([Tool trace UI](06-tool-trace-ui.md)).

## Decisions and rejected alternatives

- **Derived status, not a stored one.** A stored status would need updating in
  every branch of `applyEvent` plus the two endings — six chances to forget one,
  and a class of bug (label says "Writing the answer…" while the stream is dead)
  that cannot exist here.
- **A plain module of pure functions, not a `useReducer`.** The state lives in
  `ChatPanel`'s `exchanges` array, where an update has to find one exchange among
  many. A reducer would still need that mapping, and would add a dispatch
  indirection between the event callback and the update. The functions are the
  part worth testing, and they are testable without React.
- **`finish` overwrites the accumulated answer.** See above: one authority for
  the final text.
- **The error message is stored, not a boolean.** The message is what the reader
  needs; a flag would leave the panel to invent text the server already wrote.
- **`stopTurn` marks a flag rather than setting `error` to "Stopped."** A stop is
  not an error — it should not colour the text destructive or read like a fault.
- **`durationMs` comes only from `finish`.** There is no client-side timer, so
  the number shown is the server's own measurement of the whole pipeline, not a
  stopwatch that includes network time on the client.

## Where it can bite you

- **Steps are kept by id, so duplicate ids collapse.** If the pipeline ever
  emitted two distinct calls with the same id, the second would overwrite the
  first and the trace would show one row for two calls.
- **There is no cap on `steps`.** One call today; a future multi-tool pipeline
  would render every row it traced.
- **`answer` grows by string concatenation.** Fine for a three-sentence answer;
  a long stream would do quadratic work building the string.
- **A turn has no notion of retry.** Asking again creates a new turn; the failed
  one stays in the thread with its error, which is the intended reading
  (*"keeps earlier questions and answers in the thread"*).
- **`stopped` beats `finish` in the status order, but nothing prevents both.**
  A stop that races a `finish` event would show "Stopped." while a complete
  answer sits beneath it. The window is small and the display is still truthful
  about what happened.
- **The status order is the whole specification.** Anyone reordering those `if`s
  changes behaviour with no type error — the tests in `chatThread.test.ts` are
  what pin it.

## Questions this invites

**Why not store a status on the turn?**
Because it would be a second copy of information the turn already contains, and
the two would eventually disagree. Deriving it means there is one place where
"what state is this?" is answered, and it is a pure function that can be tested
by constructing a turn.

**Why does a completing tool event need the same id as the running one?**
So the row can be updated in place. The server emits `running` then `complete`
under one id ([server: Grounded answering](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/06-grounded-answering.md));
`withStep` finds the existing row and replaces it, which is what makes the trace
read as one call rather than two.

**What keeps the partial answer visible when the model fails halfway?**
`failTurn` and the `error` case both spread the existing turn: only `error` is
added. The deltas that already arrived are not discarded.

**Why is `durationMs` nullable?**
Because a stopped or failed turn has none — the server's `finish` event is the
only thing that carries one. The view falls back to "Done." when the number is
missing.

**How would per-question timing on the client differ?**
It would include request setup, queueing, and the network, and it would measure a
different thing on every machine. The server's number measures the pipeline, and
its label is "Answered in …" rather than "Waited …".

## Related

- [Streaming client](04-streaming-client.md) — the source of every `AnswerEvent`
  folded here.
- [Tool trace UI](06-tool-trace-ui.md) — how `turnStatus` becomes words.
- [Answer, citations, and evidence](07-answer-citations-evidence.md) — what a
  finished turn renders.
