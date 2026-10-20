# 4. Streaming client

> How Server-Sent Events frames are read off a `ReadableStream`, why a partial
> frame must be buffered, and how a stop is told apart from a failure.

## What it does

Posts one question to `POST /api/chat/stream` and hands each event to a callback
as it arrives, so the UI can update while the model is still writing. It also
owns the client's copy of the event types.

## How it works

### The types mirror the server, plus one

```ts
/** Mirrors the server's `Citation` in `../server/src/rag/answer.ts`. */
export type Citation = { documentId: string; filename: string; chunkIndex: number }

/** Mirrors the server's `SearchHit` in `../server/src/rag/search.ts`. */
export type SearchHit = Citation & { content: string; relevance: number }

export type ChatAnswer = { answer: string; citations: Citation[]; retrievedChunks: SearchHit[] }

/** Mirrors the server's `ToolTrace`: one tool call, reported as it progresses. */
export type ToolStep = {
  /** Stable across the events that describe the same call. */
  id: string
  tool: string
  args: Record<string, unknown>
  state: 'running' | 'complete' | 'error'
  hits?: TraceHit[]
  durationMs?: number
}

/**
 * What the stream carries: the server's `AnswerEvent`s, plus the failure it can
 * only report once the response has already started.
 */
export type AnswerEvent =
  | { type: 'tool'; step: ToolStep }
  | { type: 'text-delta'; text: string }
  | { type: 'finish'; result: ChatAnswer; durationMs: number }
  | { type: 'error'; message: string }
```

Three of these four members exist verbatim on the server. The fourth — `error` —
exists **only** here, and the comment says why: once the SSE response has
started, the status code is already 200, so a failure can only be delivered as an
event ([server: Chat API](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/07-chat-api-and-event-streaming.md)).
The client's union is the honest picture of the wire, not a copy of the server's
`AnswerEvent` type.

### The request

```ts
export async function streamAsk(
  question: string,
  onEvent: (event: AnswerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let response: Response

  try {
    response = await fetch(`${apiBaseUrl()}/api/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
      signal,
    })
  } catch (cause) {
    if (cause instanceof ApiError) throw cause
    // A stop is the reader's own doing, and the panel reports it as stopped.
    if (signal.aborted) throw cause

    throw new ApiError(
      'Could not reach the server. Check that it is running, then try again.',
      0,
      { cause },
    )
  }

  if (!response.ok) {
    throw new ApiError(await failureMessage(response), response.status)
  }

  if (response.body === null) {
    throw new ApiError('The server returned an empty response.', response.status)
  }

  for await (const event of readEvents(response.body)) {
    onEvent(event)
  }
}
```

Reading the catch block in order explains the design:

1. **An `ApiError` is rethrown untouched** so an unconfigured `VITE_API_BASE_URL`
   keeps its specific message.
2. **An abort is rethrown as-is.** `signal.aborted` means the reader pressed
   *Stop*; wrapping that in "Could not reach the server" would be a lie, and the
   panel decides what a stop looks like ([Thread state](05-thread-state.md)).
3. **Everything else is a network failure:** status `0`, the client's own
   sentence.

The `!response.ok` branch is what surfaces the server's 400 for a malformed or
empty question, using the same `failureMessage` helper every other call uses
([Scaffold and configuration](01-scaffold-and-configuration.md)).

Then the whole point: events are handed over **as they arrive**, not collected
and returned. `streamAsk` resolves when the stream ends; the caller's callback did
all the visible work.

### Why not `EventSource`

`EventSource` cannot send a POST body, and it reconnects automatically. This
endpoint takes `{ question }` as JSON and has nothing to resume, so neither
feature applies.

### The frame parser

```ts
const FRAME_TERMINATOR = '\n\n'

/**
 * Splits a `text/event-stream` body into the events it carries. Frames are only
 * parsed once their blank-line terminator has arrived, because a read can end
 * anywhere, including inside a frame.
 */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AnswerEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      let end = buffer.indexOf(FRAME_TERMINATOR)
      while (end !== -1) {
        const event = parseFrame(buffer.slice(0, end))
        buffer = buffer.slice(end + FRAME_TERMINATOR.length)
        if (event !== null) yield event
        end = buffer.indexOf(FRAME_TERMINATOR)
      }
    }

    const last = parseFrame(buffer)
    if (last !== null) yield last
  } finally {
    reader.releaseLock()
  }
}
```

Four details, each one a bug avoided:

- **`decoder.decode(value, { stream: true })`** keeps multi-byte characters
  intact when a read splits one in half (an em dash or an accented filename is
  two or more bytes, and a chunk boundary can fall between them). Without
  `stream: true`, such a character would be replaced with `�`.
- **A buffer, not a per-read parse.** A read can end anywhere — inside a frame, in
  the middle of a JSON string. Only text up to a blank-line terminator is
  parsed; the remainder waits.
- **The `while` loop drains every complete frame in the buffer.** One read can
  carry several frames: the tool-running frame, the tool-complete frame, and the
  first deltas can all be delivered in one chunk.
- **The trailing buffer is parsed after the loop.** The server's last frame may
  arrive without its terminator, and dropping it would lose the `finish` event —
  the one carrying citations and retrieved chunks. `api/chat.test.ts` has a test
  named exactly for this: *"reads a final frame that arrives without its
  terminator"*.

`reader.releaseLock()` in `finally` releases the stream lock however the
generator ends, including when the caller stops iterating early because of an
abort.

### One frame

```ts
/**
 * Reads one frame's payload. Frames the server sends without data, such as the
 * keep-alive comments that hold an idle connection open, carry no event.
 */
function parseFrame(frame: string): AnswerEvent | null {
  const lines = frame.split('\n')
  const data = lines
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trimStart())
    .join('\n')

  if (data === '') return null

  const parsed: unknown = JSON.parse(data)
  if (typeof parsed !== 'object' || parsed === null) return null
  if (typeof (parsed as { type?: unknown }).type === 'string') return parsed as AnswerEvent

  // Some frames name their type only in the SSE `event:` field.
  const eventName = lines.find((line) => line.startsWith('event:'))?.slice('event:'.length).trim()
  if (eventName === undefined || eventName === '') return null

  return { ...(parsed as Record<string, unknown>), type: eventName } as AnswerEvent
}
```

- **The payload's `type` wins.** The `event:` line the server writes is normally redundant, because the body already carries `type`.
- **The `event:` line is the fallback.** An error frame once carried `{ message }` with the kind only in `event: error`; the parser would hand the reducer an event with no `type`, which replaced the turn with `undefined`. The frame name is now used when the body has no discriminator, so an older server cannot white-screen the page.
- **Malformed payloads are skipped.** A JSON value that is not an object, or that has no usable type from either source, carries no event.
- **All `data:` lines are joined with `\n`,** which is the SSE rule for a payload
  spanning several lines. The server happens to write a single-line JSON body, but
  the parser does not depend on that.
- **`trimStart()`** accommodates the conventional `data: {…}` space.
- **Empty data means no event.** That is how the `: keep-alive` comment frames
  (and any other data-less frame) are skipped — they have no `data:` line at
  all, so `data` is `''`.
- **`JSON.parse` is not wrapped in a `try`.** A frame the server wrote as valid
  JSON cannot fail to parse; if it does, that is a bug in the server or a
  corrupted stream, and the thrown `SyntaxError` propagates to the panel, which
  shows its generic fallback sentence. Wrapping it would hide a real fault behind
  a friendly message.

## Decisions and rejected alternatives

- **A hand-written parser instead of a dependency.** The subset needed is
  "collect `data:` lines per blank-line-terminated frame, parse the payload as
  JSON" — about fifteen lines, and it is exercised by five dedicated tests. The
  `eventsource-parser` package would be a dependency whose behaviour would still
  need tests at this boundary.
- **A callback, not an async iterator, at the API boundary.** The panel wants to
  update state per event *and* run one `try`/`catch`/`finally` around the whole
  question. `onEvent` gives that: the loop above is inside `streamAsk`, so the
  caller sees a single promise to await. Returning a generator instead would push
  the iteration and the error handling into every caller.
- **Abort via `AbortSignal` into `fetch`.** The signal reaches the browser's
  request, so a stop closes the connection rather than merely ignoring the
  response — which is what makes the server's `onAbort` fire and stop the model
  call ([server: Chat API](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/07-chat-api-and-event-streaming.md)).
- **Frames are parsed defensively but payloads strictly.** Structural tolerance
  (partial frames, comments, multi-line data) costs nothing and prevents real
  bugs; inventing a fallback for a malformed JSON payload would mask a server
  fault.
- **`readEvents` is exported.** It is the piece with the interesting edge cases,
  so its tests exercise it directly with chunk boundaries they choose, rather
  than through the component ([Scaffold and configuration](01-scaffold-and-configuration.md)
  describes the `sseResponse` helper that makes that possible).

## Where it can bite you

- **The terminator is `\n\n`, and CRLF would break it.** If a server or proxy
  emitted `\r\n\r\n` between frames, `indexOf('\n\n')` would never match: frames
  would accumulate, and at the end of the stream the whole body would be parsed
  as one frame whose joined `data:` lines are not valid JSON. Hono's SSE helper
  writes `\n\n` (verified on the deployed service — deltas arrived
  incrementally), so this works today; it is the assumption to check first if
  streaming ever stops mid-answer.
- **A malformed frame becomes a generic error.** `JSON.parse` throws out of
  `readEvents`, through `streamAsk`, into the panel, where a non-`ApiError` maps
  to "Something went wrong. Please try again." The cause is in the console, not
  on screen.
- **There is no reconnect or resume.** A dropped connection ends the turn as an
  error; every earlier delta is kept on screen but the answer never completes.
  `EventSource`'s automatic retry is not available through `fetch`, and resuming
  would need the server to support `Last-Event-ID`.
- **`releaseLock()` means the body cannot be re-read.** Correct here — one
  consumer, one pass — but it also means a caller cannot hold the response and
  iterate it later.
- **The whole payload is parsed on the client's main thread.** At the sizes here
  (a few kilobytes of JSON) that is irrelevant; a multi-megabyte answer would
  not be.
- **A failure after the first byte does not arrive as an exception.** The server
  writes it as an `error` frame carrying `{ message }`, and `readEvents` yields it
  like any other event: nothing is thrown, so the panel never sees an `ApiError`,
  and `applyEvent` records the message on the turn instead. That is the one place
  the failure shape differs between the two routes — a 400 or a 502 on the JSON
  route is `{ error }` with a status code
  ([server: Chat API and event streaming](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/07-chat-api-and-event-streaming.md)).

## Questions this invites

**Why not use `EventSource`?**
It cannot POST. The question has to be sent in a request body, and `EventSource`
only issues GET requests with no body — so the endpoint would have to accept the
question as a query parameter, which would put it in logs and URL history.

**What happens to a half-received frame?**
It stays in `buffer` until its blank-line terminator arrives, and is then parsed
as one frame. That is deliberate: parsing per read would see truncated JSON.

**How does the client tell a stop apart from a failure?**
`streamAsk` rethrows the abort untouched instead of wrapping it in an
`ApiError`; the panel checks `controller.signal.aborted` and records a *stopped*
turn rather than a failed one ([Thread state](05-thread-state.md)).

**Why is the `error` event in the client's union but not the server's?**
Because the server's `AnswerEvent` type describes what the pipeline yields — and
the pipeline throws rather than yielding an error. The `error` frame is the HTTP
route's invention, added once the response has already begun, so the type that
models the wire has to include it.

**What would need to change to support two questions at once?**
Almost nothing in this file: `streamAsk` is stateless and takes its own signal. The
panel is the part that assumes one question in flight at a time, via its
`isAsking` flag.

## Related

- [Thread state](05-thread-state.md) — where these events become a turn.
- [Scaffold and configuration](01-scaffold-and-configuration.md) — `failureMessage`
  and the test HTTP helpers.
- [server: Chat API and event streaming](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/07-chat-api-and-event-streaming.md)
  — the other end of this wire, frame for frame.
