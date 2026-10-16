# 9. Deployment

> A static build on Vercel, a server URL baked in at build time, and a CORS pair
> that has to be kept in step by hand.

## What it does

Builds the Vite app to static files and serves them from
**<https://rag-sourcebook-client.vercel.app>**, talking to the server at
**<https://rag-sourcebook-server.onrender.com>**. There is no client-side runtime,
no server rendering, and no environment variable read at run time.

## How it works

### The pipeline

Vercel is linked to the client's Git repository and runs the repository's own
build:

```json
"build": "tsc -b && vite build"
```

`tsc -b` type-checks all three projects first ([Scaffold and
configuration](01-scaffold-and-configuration.md)); `vite build` writes `dist/`
with the HTML shell, a hashed JS bundle, the stylesheet, and the two Fontsource
font faces. Vercel serves `dist/` from its CDN.

Vite's content hashing gives every build a new filename — the deployed bundle
observed during verification was `assets/index-CGmVmyz2.js`, while a later local
build produced `assets/index-DdgVcpF3.js` — so cache invalidation is automatic and
a stale bundle cannot be served under the old URL. The hash is also how a smoke
test confirms it is exercising the build it thinks it is: the console errors, the
trace rows, and the answer all came from that one file.

There is **no `vercel.json`**. It is not needed: the app is a single HTML page
with no client-side routing, so no rewrite-to-index rule is required. The only
route that exists is `/`, and everything else the browser asks for is a real file
under `dist/`.

### The one build-time variable

```sh
# set in the Vercel project, for production and preview
VITE_API_BASE_URL=https://rag-sourcebook-server.onrender.com
```

Vite inlines `import.meta.env.VITE_*` at build time — the value is substituted
into the bundle, not read from the environment when the page loads. Three
consequences:

1. **Changing the server URL requires a rebuild**, not a restart. There is no
   runtime environment on a static host to change.
2. **The value is public.** It is in the JavaScript anyone can download. Nothing
   secret can live in a `VITE_*` variable.
3. **Local development reads the same name** from `.env.local`
   (`VITE_API_BASE_URL=http://localhost:3000`), so the code path is identical in
   both environments ([Scaffold and configuration](01-scaffold-and-configuration.md)).

### The CORS pair

The two deployments are coupled through exactly one setting, on the server:

```sh
# server, Render dashboard
CLIENT_ORIGIN=https://rag-sourcebook-client.vercel.app
```

The server allows one browser origin ([server: Scaffold and
configuration](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/01-scaffold-and-configuration.md)). The deployed
client's origin is that value, so the browser's cross-origin requests to Render
are permitted and the video reverse-proxy is not needed. Changing the client's
domain means changing `CLIENT_ORIGIN` and restarting the server.

The client half of the pair is `VITE_API_BASE_URL`; the server half is
`CLIENT_ORIGIN`. They are two independent settings in two dashboards, and nothing
checks that they agree.

### What a production smoke test observed

Against the deployed pair, with the console open:

| Check | Observed |
| --- | --- |
| Cold load | Static assets from Vercel's CDN; no client-side errors on load |
| Grounded question | A `search_documents` row (Complete, 2.0 s), "Answered in 3.8 s", an answer citing `[chunk-1]`, badge `vercel-smoke.md · chunk 1`, "1 retrieved passage" |
| Off-topic question | A Complete tool row in 698 ms, "Nothing in the sourcebook matched, so no answer was written.", and the abstention answer — no model call |
| Console | Zero errors or warnings on either path |

The off-topic result is the one that proves the cost story end to end: a browser,
a CDN, an origin-checked POST, a retrieval that scored below the floor, and a
refusal — in under a second, with no provider request.

## Decisions and rejected alternatives

- **A static site, not a server-rendered app.** Nothing in the UI needs a server
  at request time: the data comes from the API, and the app has one route. Static
  files on a CDN are the cheapest way to serve it and cannot fail the way a
  runtime can.
- **Vercel's Git integration, not a CLI deploy.** Every push to the tracked branch
  produces a build and a deployment; the alternative adds a credential to a
  laptop and a step someone has to remember.
- **One `VITE_*` variable, no runtime config.** A `window.__CONFIG__` injected at
  serve time would let one build target many servers. This project has one server,
  and the indirection would be a thing to explain for no benefit.
- **No SPA rewrite rule.** There is one page. Adding a catch-all rewrite would
  hide a genuine 404 (a missing asset) behind an HTML response.
- **The API base URL per environment, not per branch.** Both production and
  preview builds point at the same deployed server, which is deliberate: previews
  are how a change is checked against the real corpus.

## Where it can bite you

- **A CORS rejection looks like a dead server.** The browser refuses the
  cross-origin response and `fetch` rejects opaquely, so `requestJson` reports
  *"Could not reach the server. Check that it is running, then try again."* The
  real cause is visible only in the browser console (a CORS policy message) or by
  checking `CLIENT_ORIGIN` on the server. This is the single most misleading
  failure mode of the deployed pair.
- **Every Vercel *preview* deployment has its own origin, and the server allows
  one.** A preview therefore fails every request with that same misleading
  message until `CLIENT_ORIGIN` is pointed at it. Production works because its
  alias is stable.
- **The two halves of the CORS pair are not checked against each other.**
  A client rebuilt with a new `VITE_API_BASE_URL` and a server that was not
  updated produces a working deployment on paper and a broken one in a browser.
- **The first request after the server spins down waits about a minute** — the
  client renders instantly and then appears to hang, with "Contacting the
  server…" as the only feedback ([server: Deployment and
  operations](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/09-deployment-and-operations.md)).
- **`VITE_API_BASE_URL` is in the bundle.** Anyone can read the server URL, and it
  is also the only place the URL appears — there is no documentation surface that
  would be updated if it changed.
- **No deploy-time check that the server is reachable.** A client deploy succeeds
  whether or not Render or Neon are healthy, because nothing calls them during the
  build.

## Questions this invites

**Why not a runtime environment variable?**
Because there is no runtime. Vercel serves files; the browser downloads them. A
value that must differ per environment has to be substituted when the file is
built, which is exactly what `import.meta.env` does.

**How do the two deployments stay compatible?**
Through the API contract, which is versioned by convention rather than by a
scheme: the client sends `{ question }`, the server answers with
`{ answer, citations, retrievedChunks }` or an `{ error }`, and both sides carry
their own copy of the types with a comment pointing at the other's source
([Scaffold and configuration](01-scaffold-and-configuration.md)). A breaking
change means deploying both.

**What would you check first if the deployed app showed "Could not reach the
server" for every request?**
The browser's console — a CORS message names the origin that was refused — then
the server's `CLIENT_ORIGIN`. "Could not reach the server" is the client's
catch-all for both a network failure and a policy refusal.

**Why is the bundle hash worth mentioning at all?**
Because it is the cheapest way to be sure that a smoke test and a deployment refer
to the same code. If the hash in the browser differs from the one just built, the
test is describing an older deployment.

**What is the rollback story?**
On the client: Vercel keeps previous deployments and can promote one instantly,
and the alias means the server's `CLIENT_ORIGIN` does not change. On the server:
a redeploy of a previous commit, remembering that a rollback also rolls back
whatever schema assumptions came with it
([server: Deployment and operations](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/09-deployment-and-operations.md)).

## Related

- [Scaffold and configuration](01-scaffold-and-configuration.md) — how
  `VITE_API_BASE_URL` is read and what a missing value does.
- [server: Deployment and operations](https://github.com/YanMyoAungg/rag-sourcebook-server/blob/main/docs/09-deployment-and-operations.md)
  — the other half of the pair, including the cold start.
- `../README.md` — the one-paragraph version of this document.
