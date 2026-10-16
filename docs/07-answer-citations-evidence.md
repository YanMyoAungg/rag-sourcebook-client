# 7. Answer, citations, and evidence

> One finished turn: the trace above, the answer as plain text, the sources it
> cited as badges, and every retrieved passage one click away — plus the
> mechanics of asking a question at all.

## What it does

Renders a completed or in-flight exchange, and owns the composer that starts one.
Nothing here fetches anything; `ChatPanel` holds the thread and passes each turn
down.

## How it works

### The composer and the thread

```tsx
export function ChatPanel() {
  const [question, setQuestion] = useState('')
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [isAsking, setIsAsking] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  // Follow the answer only while the reader is already at the end of the thread.
  const followsThread = useRef(true)
  …
}
```

`ChatPanel` owns the thread: three `useState`s hold the composer's text, the
exchanges, and whether a question is in flight, and two refs hold the abort
controller and whether the view should follow the stream. The only other state
below it is a tool row's open/closed disclosure
([Tool trace UI](06-tool-trace-ui.md)).

**Autoscroll follows only if the reader is already at the bottom:**

```tsx
useEffect(() => {
  const thread = threadRef.current
  if (thread !== null && followsThread.current) thread.scrollTop = thread.scrollHeight
}, [exchanges])

function handleScroll() {
  const thread = threadRef.current
  if (thread === null) return
  followsThread.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40
}
```

The 40-pixel tolerance is what makes it work with sub-pixel scroll positions and
with a reader who has scrolled up by a few pixels. Without the flag, an answer
would yank the view back down while someone was reading an earlier turn.

**Submitting adds a turn, then streams into it:**

```tsx
async function handleSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  if (asked === '' || isAsking) return

  const id = crypto.randomUUID()
  setExchanges((previous) => [...previous, { id, turn: newTurn(id, asked) }])
  setQuestion('')
  setIsAsking(true)
  followsThread.current = true

  const controller = new AbortController()
  abortRef.current = controller

  const update = (change: (turn: ChatTurn) => ChatTurn) =>
    setExchanges((previous) =>
      previous.map((exchange) =>
        exchange.id === id ? { ...exchange, turn: change(exchange.turn) } : exchange,
      ),
    )

  try {
    await streamAsk(asked, (event) => update((turn) => applyEvent(turn, event)), controller.signal)
  } catch (cause) {
    // A stop is the reader's own doing; anything else is worth reporting.
    update((turn) => (controller.signal.aborted ? stopTurn(turn) : failTurn(turn, errorMessage(cause))))
  } finally {
    abortRef.current = null
    setIsAsking(false)
  }
}
```

- **The turn is added before the request**, so the question and the waiting state
  are visible immediately even if the server is cold and takes a minute.
- **`update` maps by id**, which keeps the update immutable and independent of
  where the exchange sits in the array.
- **`asked` is the trimmed question**, captured before `setQuestion('')`, so the
  request and the rendered question cannot differ.
- **One `try`/`catch`/`finally` around the whole stream**, which is why
  `streamAsk` takes a callback rather than returning an async iterator
  ([Streaming client](04-streaming-client.md)).
- **`controller.signal.aborted` chooses between stopped and failed.** The signal
  is the record of intent; no separate flag is needed.

**The textarea sends on Enter:**

```tsx
<Textarea
  id="question"
  value={question}
  onChange={(event) => setQuestion(event.target.value)}
  // Enter sends, as it does in a chat box; Shift+Enter keeps a line break.
  onKeyDown={(event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }}
  placeholder="What does the sourcebook say about…?"
  rows={2}
/>
```

`requestSubmit()` rather than `submit()` because it runs the form's validation and
fires a real `submit` event, so there is one code path into `handleSubmit`
(and Shift+Enter is untouched, so a multi-line question is possible).

The buttons:

```tsx
<Button type="submit" disabled={isAsking || asked === ''}>Ask</Button>
{isAsking ? (
  <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>Stop</Button>
) : null}
```

`Ask` is disabled while a question is in flight and while the box is empty — the
empty case is also guarded in `handleSubmit`, so the disabled state is a
convenience, not the enforcement. `Stop` exists only while asking, and it acts on
the ref because the controller is not render state.

### One exchange

```tsx
function Exchange({ turn }: { turn: ChatTurn }) {
  return (
    <article className="flex flex-col gap-3">
      <p className="text-sm font-medium">{turn.question}</p>

      <div className="flex flex-col gap-3 border-l border-border pl-4">
        <ActivityTrace turn={turn} />

        {turn.answer === '' ? null : <p className="text-sm whitespace-pre-wrap">{turn.answer}</p>}

        {turn.error === null ? null : (
          <p role="alert" className="text-sm text-destructive">{turn.error}</p>
        )}

        {turn.result !== null && turn.result.citations.length > 0 ? (
          <ul aria-label="Sources" className="flex flex-wrap gap-2">
            {turn.result.citations.map((citation) => (
              <li key={`${citation.documentId}-${citation.chunkIndex}`}>
                <Badge variant="secondary">
                  {citation.filename} · chunk {citation.chunkIndex + 1}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}

        {turn.result === null ? null : <SourceEvidence chunks={turn.result.retrievedChunks} />}
      </div>
    </article>
  )
}
```

The left border and indent are what visually group everything under a question —
the trace, the answer, the sources, the evidence — as one unit.

Four rendering decisions:

1. **The answer is plain text with `whitespace-pre-wrap`.** No Markdown renderer.
   The model is told to answer in at most three sentences; a renderer would add a
   dependency and would turn model output into markup. The visible cost is that
   the `[chunk-N]` markers the model wrote stay in the text (as literal
   characters after the sentences they cite).
2. **The error paragraph appears *below* whatever answer arrived.** A failure
   mid-stream leaves the partial answer and adds the reason, rather than replacing
   one with the other ([Thread state](05-thread-state.md)).
3. **Badges show only cited passages**, and only once the turn is `done`. An
   in-flight turn has no citations yet, so nothing is claimed prematurely.
4. **`chunkIndex + 1`.** The data is 0-based; the reader counts from one, and the
   answer's `[chunk-1]` marker is the same chunk as the first badge.

The badge key is `documentId` + `chunkIndex` — the only identity that is unique
across documents with the same filename.

### The evidence disclosure

```tsx
export function SourceEvidence({ chunks }: { chunks: SearchHit[] }) {
  if (chunks.length === 0) return null

  return (
    <details className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">
        {chunks.length === 1 ? '1 retrieved passage' : `${chunks.length} retrieved passages`}
      </summary>
      <ul className="mt-3 flex flex-col gap-3">
        {chunks.map((chunk) => (
          <li key={`${chunk.documentId}-${chunk.chunkIndex}`} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-mono text-xs">{chunk.filename} · chunk {chunk.chunkIndex + 1}</span>
              <span className="text-xs text-muted-foreground">
                relevance {chunk.relevance.toFixed(2)}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{chunk.content}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}
```

- **A native `<details>`**, not the `Collapsible` component: it needs no state, no
  JavaScript, and is keyboard-operable and screen-reader-announced by the browser.
- **Closed by default**, because the answer is the point and the passages are the
  audit trail. A reader who wants to verify a claim opens it.
- **The summary states the count**, so the disclosure's size is known without
  opening it.
- **Returns `null` for zero chunks.** An empty disclosure would imply something was
  retrieved when nothing was; the abstention is already stated by the status line
  ([Tool trace UI](06-tool-trace-ui.md)).

### Two different lists, on purpose

| Shown | Comes from | Means |
| --- | --- | --- |
| Citation badges | `result.citations` | The passages the model *cited*, derived from `[chunk-N]` markers and validated against the retrieved set |
| Retrieved passages | `result.retrievedChunks` | Every passage that cleared the relevance floor and was *available* to the model |

They routinely differ — the model cites a subset. Keeping both visible is what
makes the difference between "it said something" and "it said something it can
point to" checkable.

### The empty thread

```tsx
function EmptyThread() {
  return (
    <p className="py-1 text-sm text-muted-foreground text-balance">
      Ask about anything in the documents you have indexed. Every answer cites
      the passages it used, and says so when nothing in them matches.
    </p>
  )
}
```

A paragraph, not example questions. It states the two rules the app enforces —
answers cite their passages, and an unanswerable question is refused rather than
guessed at — which is the whole behaviour of the thing in two clauses.

## Decisions and rejected alternatives

- **No Markdown renderer.** The answers are three sentences with bracketed
  citations. A renderer would add a dependency, sanitisation questions, and a new
  way for model output to become markup.
- **Citation badges *and* the evidence list.** One answers "what did it use?", the
  other "what did it have?" Collapsing them into one list would hide whichever
  question the reader was not asking.
- **`<details>` for evidence, `Collapsible` for the tool row.** The tool row needs
  to be forced open while running; the evidence needs nothing but open and closed.
  Use the smallest thing that does the job.
- **Blank-line preservation with `whitespace-pre-wrap`.** The model may emit line
  breaks; `pre-wrap` keeps them without turning the answer into a code block.
- **The composer lives in `ChatPanel`, not in `Exchange`.** One composer for the
  thread; the alternative would put a form per exchange.
- **`crypto.randomUUID()` for the exchange id.** No dependency, and it is the
  browser's own uniqueness guarantee — the id never leaves the client.
- **Autoscroll on a "was I at the bottom?" flag, not unconditionally.** Reading an
  earlier answer should not be interrupted by a new one arriving.

## Where it can bite you

- **`[chunk-1]` stays in the visible answer text.** Nothing strips the markers, so
  a reader sees both the marker and the badge. It is honest (the model did write
  it) and slightly redundant.
- **A model that returns Markdown shows it literally** — `**bold**` stays as
  asterisks, a list stays as hyphens. Predictable, but not pretty.
- **An answer with no citations renders no badges at all,** and looks like a plain
  paragraph. Only the evidence disclosure distinguishes "the model cited nothing"
  from "nothing was retrieved" — and that disclosure says "3 retrieved passages".
- **A stopped turn keeps `isAsking` false but leaves a partial answer** with
  "Stopped." above it. Nothing marks the text as truncated.
- **The thread container is capped at `max-h-[60vh]`.** A long thread scrolls
  inside the card rather than growing the page, which is deliberate on a
  two-column layout and easy to break on a short viewport.
- **`aria-label="Sources"` names the list but the badges themselves are plain
  text** (`vercel-smoke.md · chunk 2`). A screen reader reads the filename and
  chunk, which is the useful part; there is no link to the document.
- **The evidence disclosure has no id or anchor**, so a citation badge cannot
  point the reader at the passage it names. Correlating them is a visual, manual
  act.
- **`Stop` is only rendered while asking,** so a keyboard user who tabs away and
  back can lose it mid-question. It returns as soon as the state is read again —
  but it is not a fixed target.

## Questions this invites

**Why show the model's cited passages separately from all retrieved ones?**
Because the difference is the interesting signal. A citation is a claim ("this
passage supports this sentence"); the retrieved list is the raw evidence. If they
matched, the badges would be redundant; they rarely do, and where they differ is
where a reader should look
([server: Grounded answering](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/06-grounded-answering.md)).

**Why is the answer not rendered as Markdown?**
The prompt asks for at most three sentences of plain prose with bracketed
citations. Rendering would be building a feature for output the system
specifically asks not to receive, and it would make the model's text executable
markup.

**What happens between the question appearing and the first token?**
The turn is added with empty steps, so the status line reads "Contacting the
server…"; the trace's running row appears when the first event lands, then
"Searching the sourcebook…", then "Writing the answer…". Every phase is visible
because the events drive it ([Thread state](05-thread-state.md)).

**Why can the reader stop at all?**
Because a free-tier reasoning model can take many seconds, and because the abort
is not cosmetic: it closes the connection, which aborts the provider call on the
server and stops it spending quota
([server: Chat API](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/07-chat-api-and-event-streaming.md)).

**Where would a "copy answer" button go, and what would it copy?**
Next to the answer paragraph, copying `turn.answer` as-is — including the
`[chunk-N]` markers, which is what makes the copy verifiable against the
disclosure below it.

## Related

- [Thread state](05-thread-state.md) — the turn these components render.
- [Tool trace UI](06-tool-trace-ui.md) — the trace above the answer.
- [Streaming client](04-streaming-client.md) — `streamAsk`, which the composer
  calls.
