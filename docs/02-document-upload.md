# 2. Document upload

> Which files are refused before a request is ever sent, why the client checks at
> all when the server checks too, and why the file input is cleared on both paths.

## What it does

Gives the reader a labelled file input that accepts `.txt` and `.md` files,
refuses what the server would refuse, posts the file's text as JSON, reports
"I" while the server indexes it, and tells the app to refresh its library when it
succeeds.

## How it works

### The rules, and why they are duplicated

```ts
/** Mirrors the rules the server enforces in `../server/src/documents/ingest.ts`. */
export const ACCEPTED_EXTENSIONS = ['.txt', '.md'] as const
export const MAX_DOCUMENT_BYTES = 1024 * 1024

/**
 * The checks that can be made from the file alone. Whether the content is
 * usable is the server's call, since it owns the chunking and embedding rules.
 */
export function validateDocument(file: File): string | null {
  const filename = file.name.toLowerCase()

  if (!ACCEPTED_EXTENSIONS.some((extension) => filename.endsWith(extension))) {
    return 'Only .txt and .md files are supported.'
  }

  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_DOCUMENT_BYTES) return 'That file is larger than 1 MiB.'

  return null
}
```

The same three rules the server enforces
([server: Document ingestion](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/04-document-ingestion.md)), for a
reason that is about the network rather than trust: a 1 MiB file that will be
rejected should not be uploaded first. The doc comment states the boundary
explicitly — anything that depends on the *content* (splitting, embedding,
whether the text is usable at all) is the server's decision, and the client's copy
covers only what a `File` object can answer: its name, its size, and nothing else.

`ACCEPTED_EXTENSIONS` is used twice: by `validateDocument`, and as the input's
`accept` attribute so the operating system's file picker filters to those types.

### The request

```ts
export async function uploadDocument(file: File): Promise<DocumentSummary> {
  return requestJson<DocumentSummary>('/api/documents', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, content: await file.text() }),
  })
}
```

JSON with the file's text, not `multipart/form-data` — the server's contract, and
the reason the whole file is read into memory on this side.

### The component

```tsx
async function handleFile(event: ChangeEvent<HTMLInputElement>) {
  // currentTarget is only valid until the first await, and the same file must
  // be selectable again after a failure, so hold the input and clear it later.
  const input = event.currentTarget
  const file = input.files?.[0]
  if (!file) return

  const rejected = validateDocument(file)
  if (rejected) {
    setProblem(rejected)
    input.value = ''
    return
  }

  setProblem(null)
  setIsIndexing(true)

  try {
    onUploaded(await uploadDocument(file))
  } catch (cause) {
    setProblem(errorMessage(cause))
  } finally {
    setIsIndexing(false)
    input.value = ''
  }
}
```

Four things are deliberate:

1. **`const input = event.currentTarget` before the first `await`.** React's
   synthetic event is not safe to read after yielding; more practically, a
   `change` handler that awaits and then reads `event.currentTarget` can find it
   cleared.
2. **`input.value = ''` on both paths.** A file input does not fire `change` when
   the same file is chosen twice. Clearing the value makes a retry after a failure
   actually re-trigger the handler.
3. **`setProblem(null)` before the request**, so a previous failure's message is
   not on screen while a new attempt is in flight.
4. **`onUploaded` receives the server's `DocumentSummary`** — the id, filename,
   chunk count, and creation date the server actually stored. The component does
   not construct a local guess.

The rendered markup is small, and each attribute is doing work:

```tsx
<Label htmlFor="document-upload">Upload document</Label>
<Input
  id="document-upload"
  type="file"
  accept={ACCEPTED_EXTENSIONS.join(',')}
  disabled={isIndexing}
  aria-describedby="document-upload-hint"
  onChange={handleFile}
/>
<p id="document-upload-hint" className="text-xs text-muted-foreground">
  Plain text or Markdown, up to 1 MiB.
</p>
{isIndexing ? <p role="status" className="text-sm text-muted-foreground">Indexing…</p> : null}
{problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
```

- `id`/`htmlFor` tie the label to the control, so clicking the label opens the
  picker and a screen reader announces both together.
- `accept` filters the picker; `validateDocument` is still the enforcement.
- `disabled={isIndexing}` is the concurrency guard — a second file cannot be
  chosen while the first is being embedded.
- `aria-describedby` reads the size hint as part of the control's description.
- `role="status"` for progress (announced politely, not interrupting) and
  `role="alert"` for problems (announced immediately). The distinction matters
  when someone is listening rather than watching.

### How the library learns about it

```tsx
// App.tsx
const [libraryVersion, setLibraryVersion] = useState(0)
…
<DocumentUpload onUploaded={() => setLibraryVersion((version) => version + 1)} />
…
<DocumentLibrary key={libraryVersion} />
```

The upload component knows nothing about the list. It calls `onUploaded`, `App`
increments a counter, and the list remounts and re-reads
([Document library](03-document-library.md)). One direction of dependency, no
shared store, no refetch API.

## Decisions and rejected alternatives

- **Validate on the client as well as the server.** Cheap, and it prevents
  uploading up to a megabyte of text that is going to be refused. The server
  remains the authority; the client's copy is deliberately limited to what the
  `File` object knows.
- **Read the file with `file.text()`, post JSON.** The server's contract is
  `{ filename, content }`. A `FormData` upload would be a different endpoint
  shape and a different server parser for no benefit at this size.
- **Clear the input rather than managing a preview.** Nothing is shown before the
  upload, so there is nothing to keep the file for.
- **`disabled` during indexing rather than a queue.** One file at a time is the
  honest model: the server embeds every chunk inside the request, and two
  concurrent ingests would compete for the same pipeline.
- **Report progress as an indeterminate "Indexing…"** rather than a percentage.
  `fetch` cannot report upload or processing progress; a percentage would have to
  be invented.
- **Pass the server's stored summary upward, not a locally created one.** The
  chunk count is only knowable after indexing; showing anything before that would
  be a guess.

## Where it can bite you

- **Extension-based acceptance is name-based.** `notes.md.txt` is accepted;
  `report.md` containing HTML is accepted. The server applies the same
  name-based rule, so both agree — and both accept content that is not what the
  extension claims. It is text to pgvector either way.
- **`file.text()` decodes as UTF-8.** A file in a legacy single-byte encoding
  arrives with replacement characters, which will still index and can still be
  retrieved, but the stored text is not the original file's bytes.
- **The client's size check is on `file.size` (bytes),** matching the server's
  `Buffer.byteLength` limit, so the two agree — but a rejection here means the
  server's own byte-limit error is essentially unreachable from the UI.
- **A large upload holds a spinner with no progress and no way to cancel.** A
  1 MiB file is roughly 1200 chunks of CPU-bound embedding; the reader sees
  "Indexing…" for as long as that takes.
- **Errors do not distinguish a refused upload from a server failure** beyond the
  message text: both are a `role="alert"` paragraph.
- **No drag-and-drop and no multi-select.** Both would be features, not
  configuration; `multiple` is not set on the input.

## Questions this invites

**Why does the client check the extension at all?**
To avoid transferring a file the server will refuse. The check is a copy of a
published rule, and `documents.test.ts` covers the same cases the server's own
validation test does — acceptance of `.txt`/`.md` in any case, rejection of
another extension, of an empty file, of one over the limit, and acceptance of one
exactly at the limit.

**What exactly does the server return, and what does the UI do with it?**
`{ id, filename, chunkCount, createdAt }` with a 201. The component hands it to
`onUploaded` and shows nothing itself, so the visible confirmation is the
document appearing in the library with its chunk count.

**What happens if the upload succeeds but the library's re-read fails?**
Two independent outcomes: the upload card reports success (it has the summary),
and the library card shows its own error from a failed `GET /api/documents`. The
document *is* indexed; the list is just not showing it until a reload.

**Why is the input cleared even on success?**
Because the form is not a record of anything — the library list is. Clearing
means picking the same file again after fixing it works as expected.

**Where would upload progress come from?**
Not from `fetch`. It would need `XMLHttpRequest`'s `upload.onprogress` for the
transfer, and something else entirely for the server-side embedding, which is
where the time actually goes. Streaming ingestion progress would mean a job and a
status endpoint ([server: Document ingestion](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/04-document-ingestion.md)
discusses where that seam would be).

## Related

- [Scaffold and configuration](01-scaffold-and-configuration.md) — `requestJson`,
  which turns the server's error body into the message shown here.
- [Document library](03-document-library.md) — what `onUploaded` triggers.
- [server: Document ingestion](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/04-document-ingestion.md) — the
  authority on every rule duplicated here.
