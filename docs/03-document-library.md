# 3. Document library

> Reads the sourcebook once on mount, in four states — and why callers remount it
> instead of asking it to refresh.

## What it does

Lists every indexed document with its chunk count, or says why it cannot: still
loading, nothing indexed yet, or a failure message from the server. It has no
controls and no state of its own beyond the read.

## How it works

```tsx
/**
 * Reads the sourcebook once on mount. Callers that change the collection remount
 * it, so the list never has to be refreshed by hand.
 */
export function DocumentLibrary() {
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let isCurrent = true

    listDocuments()
      .then((loaded) => { if (isCurrent) setDocuments(loaded) })
      .catch((cause: unknown) => { if (isCurrent) setProblem(errorMessage(cause)) })

    return () => { isCurrent = false }
  }, [])
  …
}
```

- **`documents: null` means "not loaded yet"**, which is why the type is
  `DocumentSummary[] | null` rather than an empty array plus a `isLoading` flag.
  An empty array genuinely means "the sourcebook is empty", and the two states
  render differently.
- **The `isCurrent` flag prevents a write after unmount.** `StrictMode`
  double-invokes the effect in development, so the first run's cleanup runs
  before its promise settles. Without the flag, a slow response could write into
  a component that is no longer mounted (and, on a remount, an older response
  could overwrite a newer one).
- **One `try/catch` equivalent, not two states.** A failure and a success are
  mutually exclusive; the render order below enforces that.

The four render states, in order:

```tsx
if (problem) {
  return <p role="alert" className="text-sm text-destructive">{problem}</p>
}

if (documents === null) {
  return (
    <div role="status" aria-label="Loading documents" className="flex flex-col gap-2">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
    </div>
  )
}

if (documents.length === 0) {
  return (
    <p className="text-sm text-muted-foreground">
      No documents yet. Upload a .txt or .md file to start the sourcebook.
    </p>
  )
}

return (
  <ul className="flex flex-col divide-y divide-border">
    {documents.map((document) => (
      <li key={document.id} className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0">
        <span className="truncate font-medium">{document.filename}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {describeChunkCount(document.chunkCount)}
        </span>
      </li>
    ))}
  </ul>
)
```

1. **Error first.** If the read failed there is nothing else to say, and the
   message is the server's own reason when it sent one
   ([Scaffold and configuration](01-scaffold-and-configuration.md)).
2. **Then loading.** The skeleton is wrapped in `role="status"` with an
   `aria-label`, so a screen reader is told that documents are loading rather
   than being shown two empty boxes.
3. **Then empty.** A distinct, actionable sentence — the only place the app
   explains how to get started once the thread's own empty state is on screen.
4. **Then the list.** `key={document.id}` (the server's uuid, not the filename,
   because two documents may share a name); `truncate` so a long filename cannot
   push the chunk count off the row; `shrink-0` on the count so it is never the
   thing that gives way; `divide-y` for separators instead of borders on every
   row.

```ts
function describeChunkCount(count: number): string {
  return count === 1 ? '1 chunk' : `${count} chunks`
}
```

### The remount, from both sides

```tsx
// App.tsx
const [libraryVersion, setLibraryVersion] = useState(0)
…
<DocumentUpload onUploaded={() => setLibraryVersion((version) => version + 1)} />
…
<DocumentLibrary key={libraryVersion} />
```

`key` is React's own mechanism for "this is a different instance": changing it
unmounts the old component and mounts a new one, whose effect runs and reads the
list. The library needs no `refresh()` API, no context, no `onUploaded` prop, and
no knowledge that an upload exists — which is why it has exactly zero props.

## Decisions and rejected alternatives

- **Remount to refresh, rather than a refetch function.** The list is small, and
  the component holds nothing worth preserving across a refresh. In exchange, the
  data-fetching logic stays in one `useEffect` with no imperative escape hatch,
  and there is exactly one code path that reads the list.
- **`null` for "not loaded", not a separate boolean.** One field, no way for
  `isLoading === false` and `documents === null` to disagree.
- **Show the server's message verbatim.** The server's errors are already
  written for a person (`"failed to index document"` is not, but
  `"content exceeds the 1 MiB limit (…) "` is). A generic client message would
  discard information the server took care to send.
- **No polling and no optimistic insert.** The corpus changes on upload, and the
  upload path already triggers a remount through the key. A polling loop would
  talk to a server that spins down, and an optimistic row would need reconciling
  against the server's chunk count.
- **No retry button.** A reload is the retry. A button would need its own state
  and would only help in the case where the server came back between the failure
  and the click.

## Where it can bite you

- **The list is only as fresh as the last mount.** Deleting a document directly
  in the database (there is no delete endpoint) leaves it on screen until a
  reload or an upload changes the key.
- **A truncated filename has no fallback.** The `truncate` class cuts a long name
  with an ellipsis and there is no `title` attribute or tooltip, so the full
  filename cannot be recovered from the UI.
- **A failed initial read offers no path forward but a page reload,** and the
  message for an unreachable server is the client's own
  ("Could not reach the server…") rather than anything from the server.
- **`role="status"` on the skeleton container** announces loading politely; a
  reader who is exploring the page will not hear it, which is correct for a
  transient state but means the state is easy to miss if the read is slow.
- **Chunk count is the only detail shown.** There is no document id, upload
  time, or size on screen — so the id needed to call MCP's `get_document`
  ([MCP endpoint and shared
  tools](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/08-mcp-endpoint-and-shared-tools.md))
  is not visible in the UI at all.

## Questions this invites

**Why does the component have no props?**
Because its only input is "when to read", and that is expressed by the parent's
`key`. A `refreshToken` prop would be a second way to say the same thing, and the
component would then have to decide between an effect dependency and an imperative
call.

**What is the `isCurrent` flag protecting against, given React 18+ no longer
warns about setting state on unmounted components?**
A real bug, not just a warning: with `StrictMode`'s double-invoked effect, two
reads are in flight, and the first one's response could otherwise land last and
overwrite the second. The flag makes only the newest effect's response count.

**Why show the chunk count at all?**
It is the one number that reveals whether indexing worked. A document that
indexed to `0 chunks` — which can happen if the process dies mid-ingest
([server: Database and schema](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/02-database-and-schema.md)) — is
visible here instead of silently unusable.

**What would it take to delete a document from the UI?**
A `DELETE /api/documents/:id` endpoint (the repository already has
`deleteChunksForDocument` and `deleteDocument`), a button per row, a confirmation
step, and a remount on success. The client-side shape is small; the API is the
missing half.

**Why is the empty state here instead of in `ChatPanel`?**
Because both are needed and they say different things: this one explains how to
add material, the chat's explains what a question does
([Answer, citations, and evidence](07-answer-citations-evidence.md)).

## Related

- [Document upload](02-document-upload.md) — what bumps `libraryVersion`.
- [Scaffold and configuration](01-scaffold-and-configuration.md) — `listDocuments`
  and the error translation.
- [server: Chat API](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/07-chat-api-and-event-streaming.md) — the
  `GET /api/documents` contract in context.
