# RAG Sourcebook Client — implementation guide

These docs explain the browser app feature by feature, so the code can be
re-derived rather than merely trusted. [`../PLAN.md`](../PLAN.md) is the build
plan: what was asked, in what order, and the evidence each task was closed on.
This folder describes the app as it stands, and why it is shaped that way.

## The client in one paragraph

A React 19 + Vite app with no state library, no data-fetching library, and no
routing: one page, native `fetch`, and local component state. It uploads `.txt`
and `.md` files to the server, lists what is indexed, and asks questions over
Server-Sent Events so each answer arrives as it is written, with the tool calls
the server made shown above it. Components come from shadcn/ui copied into the
repository, themed with a single dark palette.

## Reading order

Each doc is self-contained, but they build on each other in this order.

| # | Doc | What you can explain afterwards |
| --- | --- | --- |
| 1 | [Scaffold and configuration](01-scaffold-and-configuration.md) | How the app is built and started, where the server URL comes from, how every failure becomes one readable message. |
| 2 | [Document upload](02-document-upload.md) | Which files are refused before a request is sent, why the client validates at all, and why the file input is cleared. |
| 3 | [Document library](03-document-library.md) | How the list is read once on mount, why callers remount it instead of refreshing it, and its loading and error states. |
| 4 | [Streaming client](04-streaming-client.md) | How SSE frames are read off a `ReadableStream`, why a partial frame must be buffered, and how a stop aborts the request. |
| 5 | [Thread state](05-thread-state.md) | The turn reducer, why status is derived rather than stored, and how a running tool call is updated in place when it completes. |
| 6 | [Tool trace UI](06-tool-trace-ui.md) | The collapsible row per tool call: status chip, duration, parameters, result, and the abstention row. |
| 7 | [Answer, citations, and evidence](07-answer-citations-evidence.md) | How a finished turn renders its answer, why citations and retrieved passages are separate disclosures, and the wording used for each ending. |
| 8 | [Dark theme and design tokens](08-dark-theme-and-tokens.md) | The single palette, the contrast test that guards it, Geist and Geist Mono, and the accessibility rules the UI follows. |
| 9 | [Deployment](09-deployment.md) | How the static build reaches Vercel, why `VITE_API_BASE_URL` is baked in at build time, and how the CORS pair is kept in step. |

## How the pieces depend on each other

```text
App ─┬─ DocumentUpload ─▶ validateDocument ─▶ POST /api/documents
     │                        (local)              │ onUploaded
     └─ DocumentLibrary ◀── GET /api/documents     ▼
                                              remount by key

ChatPanel ─┬─ ChatPanel state: exchanges, isAsking, abortRef
           │        │ applyEvent
           │        ▼
           │   chatThread.ts   (newTurn · applyEvent · failTurn · stopTurn · turnStatus)
           │        ▲
           │        │ AnswerEvent
           │   streamAsk ─▶ readEvents ─▶ POST /api/chat/stream  (SSE)
           │
           └─ Exchange ─▶ ActivityTrace ─▶ ToolCallRow
                      ─▶ answer text
                      ─▶ citation badges
                      ─▶ SourceEvidence
```

Two things are worth noticing in that picture:

- `ChatPanel` owns the thread; everything below it renders one turn and is given
  the data it needs. No component below `ChatPanel` fetches anything.
- The event types in `src/api/chat.ts` mirror the server's `AnswerEvent` union
  exactly, plus one `error` member the client adds for failures the server can
  only report after the response has already started.

## The contract with the server

The server lives in a separate repository,
[`rag-sourcebook-server`](https://github.com/YanMyoAungg/rag-sourcebook-server),
and has no shared code with this one. Both sides keep private copies of these
types; the contract is documented in
[the server's implementation guide](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/README.md)
and mirrored in the API table of [`../README.md`](../README.md).

## Running it locally

The server must be running first; `VITE_API_BASE_URL` points at it and its
`CLIENT_ORIGIN` must name this app's origin (by default `http://localhost:5173`).

```bash
pnpm install
cp .env.example .env.local    # VITE_API_BASE_URL=http://localhost:3000
pnpm dev                      # http://localhost:5173
```

```bash
pnpm test                     # vitest, jsdom, 9 files
pnpm typecheck && pnpm lint && pnpm build
```

Tests stub `fetch` (see `src/test/http.ts`) rather than mocking the API modules,
so the real request code, the real SSE parser, and the real reducers all run.
