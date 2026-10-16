# 1. Scaffold and configuration

> The Vite app, the one module that knows how to talk to the server, and the
> build/test configuration that proves both.

## What it does

A single-page React app with no router, no state library, and no data-fetching
library:

- **`src/main.tsx`** mounts `App` into `#root` under `StrictMode`.
- **`src/App.tsx`** is the whole layout: a header, a *Documents* column
  (`DocumentUpload` + `DocumentLibrary`), and an *Ask* column (`ChatPanel`).
- **`src/api/client.ts`** is the only place that knows the server's URL and how a
  failure becomes a readable message.
- **`src/components/ui/`** holds the shadcn/ui components, vendored into the
  repository rather than installed as a library.

## How it works

### The workspace

| File | Responsibility |
| --- | --- |
| `index.html` | The document shell: `<div id="root">`, `class="dark"` on `<html>`, and the `color-scheme`/`theme-color` metas that make the first paint dark. |
| `src/main.tsx` | `createRoot` + `StrictMode`; imports the stylesheet. |
| `src/App.tsx` | Composition and the one piece of cross-component state (`libraryVersion`). |
| `vite.config.ts` | React and Tailwind plugins, the `@` → `./src` alias. |
| `vitest.config.ts` | Merges the Vite config, sets `jsdom`, `css: true`, and the setup file. |
| `src/test/setup.ts` | `jest-dom` matchers plus explicit `cleanup()` between tests. |
| `components.json` | shadcn configuration: `base-nova` style, `neutral` base colour, CSS variables, Lucide icons, `@/` aliases. |
| `package.json` | `dev`, `build`, `preview`, `test`, `test:watch`, `typecheck`, `lint`. |

`main.tsx` in full, because the order matters:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`StrictMode` double-invokes render and effect code in development, which is why
`DocumentLibrary`'s read carries an `isCurrent` guard — the effect runs twice, and
the first run's cleanup must prevent a late write
([Document library](03-document-library.md)).

### One alias, one URL

```ts
resolve: {
  alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
}
```

`@/components/ui/button` works in source, in tests (the Vitest config merges this
one), and in the build. The mapping is declared in three files that have to agree:
`vite.config.ts` (the bundler, and the tests that merge it), `tsconfig.app.json`
(the project that compiles `src`), and `tsconfig.json` (for tooling that starts at
the repository root, such as the shadcn CLI).

```ts
/**
 * Read at call time rather than at module load, so a missing value fails the
 * request that needs it instead of the whole app.
 */
export function apiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL

  if (typeof configured !== 'string' || configured.trim() === '') {
    throw new ApiError(
      'VITE_API_BASE_URL is not set, so the client cannot reach the server.',
      0,
    )
  }

  return configured.trim().replace(/\/+$/, '')
}
```

Three decisions live in those ten lines:

1. **Call time, not module load.** A module-level `throw` would white-screen the
   app; instead the app renders and the first request reports exactly what is
   missing.
2. **Trailing slashes are stripped** so that `${apiBaseUrl()}/api/documents`
   cannot become `…//api/documents`, which some proxies treat as a different
   path.
3. **The failure is an `ApiError` with status `0`.** There is no HTTP status
   because there was no request — the same convention the network-failure path
   uses.

### One request wrapper

```ts
export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response

  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    })
  } catch (cause) {
    if (cause instanceof ApiError) throw cause

    throw new ApiError(
      'Could not reach the server. Check that it is running, then try again.',
      0,
      { cause },
    )
  }

  if (!response.ok) {
    throw new ApiError(await failureMessage(response), response.status)
  }

  const body = await readJson(response)

  if (body === undefined) {
    throw new ApiError('The server returned an empty response.', response.status)
  }

  return body as T
}
```

Every JSON call in the app goes through this. It handles four cases that would
otherwise be repeated at each call site: a URL that was never configured
(rethrown untouched, so it keeps its specific message), a network failure, a
non-2xx response, and a 2xx response with an empty body.

Reading the server's own reason is layered so that a *non-JSON* error response
never becomes a parse crash:

```ts
export async function failureMessage(response: Response): Promise<string> {
  return serverMessage(await readJson(response)) ?? `The server returned ${response.status}.`
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text === '') return undefined
  try { return JSON.parse(text) } catch { return undefined }
}

/** The server reports failures as `{ error: string }`. */
function serverMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null
  const { error } = body as { error: unknown }
  return typeof error === 'string' && error.trim() !== '' ? error : null
}
```

`readJson` never throws: an HTML error page from a proxy, a truncated body, or a
204 all yield `undefined`, and the caller decides what that means. The server's
`{ error }` wins when it exists — that is why a 400 from the document rules shows
the server's exact sentence rather than "The server returned 400."

Components never see `ApiError`:

```ts
export function errorMessage(cause: unknown): string {
  return cause instanceof ApiError ? cause.message : 'Something went wrong. Please try again.'
}
```

### Three tsconfigs and a merged test config

`pnpm typecheck` is `tsc -b`, which builds the project references: 
`tsconfig.app.json` (the app, `src`), `tsconfig.node.json` (the config files), and
`tsconfig.json` (the solution). The app project is strict in a specific way:

```jsonc
"moduleResolution": "bundler",
"verbatimModuleSyntax": true,   // `import type` must be explicit
"erasableSyntaxOnly": true,     // no enums, namespaces, or parameter properties
"noUnusedLocals": true,
"noUnusedParameters": true,
```

`erasableSyntaxOnly` is the interesting one: it rejects TypeScript syntax that
cannot be stripped away, leaving code whose types are purely annotation — which
is what makes type erasure (rather than compilation) a viable future path.

`vitest.config.ts` merges the Vite config instead of restating it, so the `@`
alias and the React plugin are shared rather than duplicated:

```ts
export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // src/styles.test.ts reads the stylesheet with a `?raw` import, which the
    // default CSS stub would replace with an empty string.
    css: true,
  },
}))
```

And because Vitest runs without globals, React Testing Library cannot register
its automatic cleanup — so `src/test/setup.ts` does it explicitly:

```ts
afterEach(() => { cleanup() })
```

### Tests stub the network, not the modules

`src/test/http.ts` replaces the global `fetch` with a controllable handler:

```ts
export function stubServer(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return handler(url, init)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
```

plus `jsonResponse`, `sseFrame`, `sseResponse(chunks)`, and
`openSseResponse(chunk, signal)`. `sseResponse` is what lets a test choose exactly
where a stream's bytes split — how the parser's partial-frame handling is proved.
`openSseResponse` is different: it delivers its frame and then stays open until
the request is aborted, which is how the *stop* path is exercised
([Streaming client](04-streaming-client.md)).

Mocking `fetch` rather than `@/api/chat` means the tests exercise the real URL
construction, the real error translation, the real frame parser, and the real
reducers. `sseResponse` delivers frames in whatever chunk sizes the test chooses,
so "a read can end inside a frame" is reproduced rather than assumed.

## Decisions and rejected alternatives

- **Native `fetch` with no client library.** The API is five endpoints with JSON
  bodies. `requestJson` is 30 lines; Axios would add a dependency and its own
  error type to translate.
- **Local React state, no state library.** The only cross-component state is
  `libraryVersion` in `App`. One `useState` is a smaller thing to explain than a
  store, and nothing here has the shape that Redux or React Query solves.
- **No router.** One page. Adding routing would introduce URL state, a second
  rendering path, and a decision about deep links, for no feature.
- **shadcn/ui copied in, not a dependency.** `components.json` plus
  `src/components/ui/*` means the components are source the project owns and can
  edit — `ToolCallRow` uses `Collapsible` from there. The cost is that upstream
  fixes are manual.
- **`base-nova` + `cn` from the `cn` package.** `src/lib/utils.ts` is a one-line
  re-export, so `cn` sits where every shadcn file expects it.
- **A component-facing `errorMessage()` instead of exposing `ApiError`.** The UI
  has no use for a status code; it needs a sentence. Keeping the type behind the
  helper means a component cannot accidentally render `[object Object]`.
- **`VITE_API_BASE_URL` via `import.meta.env`.** The Vite-native mechanism; the
  alternative (a runtime `window.__CONFIG__`) would let one build target many
  servers, which this project does not need.

## Where it can bite you

- **`VITE_*` values are inlined at build time.** Changing `VITE_API_BASE_URL`
  requires a rebuild — a restart of `pnpm dev`, a redeploy in production. Setting
  it as a runtime environment variable on a static host does nothing at all.
- **`status: 0` means "there was no HTTP response",** and it covers two different
  situations: the URL is not configured, and the server is unreachable. The
  messages differ; the status does not. Anything keying on `status === 0` will
  treat them as one case.
- **The alias is declared in three files** — `vite.config.ts`,
  `tsconfig.app.json`, and `tsconfig.json`. Changing one and not the others
  produces a build that works and tooling that does not (or vice versa).
- **`css: true` in Vitest is load-bearing.** Without it `styles.css?raw` resolves
  to an empty string and `styles.test.ts` fails with a message about reading zero
  characters, which looks like a broken test rather than a config setting.
- **`readJson` swallowing parse errors means a broken server response is
  reported as a missing message,** not as malformed JSON. The status code in the
  message ("The server returned 502.") is the only clue.
- **No global error boundary.** An unexpected render-time throw in a component
  blanks the page; the error handling here covers requests, not rendering.

## Questions this invites

**Why is there no state management library?**
Because there is no shared state to manage: `App` holds a counter used to remount
a list, each component owns its own `useState`, and the chat thread lives in
`ChatPanel`. React Query solves caching and revalidation across many components —
this app reads a list on mount and streams one request at a time.

**Why does the client keep its own copy of the server's types?**
The two repositories are independent — the client never imports from `../server`
(the summary in `../README.md` says so explicitly). Both sides declare the shapes
and each points at the other's source in a comment, so a drift is findable by
grep. The alternative — a shared package — would couple the deployments and
require publishing infrastructure for five types.

**What happens if `VITE_API_BASE_URL` is missing in a deployed build?**
The app renders; the first request fails with "VITE_API_BASE_URL is not set, so
the client cannot reach the server." That is a deliberate trade: a visible,
explainable failure at the point of use instead of a blank page on load.

**Why does the fetch mock resolve `RequestInfo | URL` to a string?**
Because tests assert on URLs, and the three input forms (`string`, `URL`,
`Request`) are all legal `fetch` arguments. Resolving them in one helper means no
test has to care which form the app used.

**Why `erasableSyntaxOnly`?**
It keeps the source limited to syntax that a type-stripper can remove — no
`enum`, no `namespace`, no constructor parameter properties. It is a small,
cheap constraint now that avoids a large mechanical change if the build ever
moves to type erasure.

## Related

- [Document upload](02-document-upload.md) and
  [Document library](03-document-library.md) — the two consumers of
  `requestJson`.
- [Streaming client](04-streaming-client.md) — the one call that does not use
  `requestJson`, because its response is a stream.
- [Deployment](09-deployment.md) — where `VITE_API_BASE_URL` is set in
  production.
