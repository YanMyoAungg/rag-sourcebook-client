# RAG Sourcebook Client

A small browser UI for the RAG Sourcebook server: upload `.txt` and `.md`
documents, list what is indexed, and ask questions that come back with citations
and the retrieved passages they were drawn from.

The client is an independent React/Vite/TypeScript app. It talks to the server
over HTTP and never imports server code. The API contract is maintained in
[`../server/PLAN.md`](../server/PLAN.md).

## Stack

React 19, Vite, TypeScript, Tailwind CSS v4, shadcn/ui components vendored into
`src/components/ui`, Lucide icons, Vitest with React Testing Library, and pnpm.

## Prerequisites

- Node.js 20 or newer and pnpm
- A running RAG Sourcebook server. For local work, start one from `../server`
  and leave it listening on port 3000.

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

`pnpm dev` serves the app on <http://localhost:5173>, which is the origin the
server allows by default (`CLIENT_ORIGIN`).

## Environment

| Variable | Example | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:3000` | Base URL of the RAG Sourcebook server. No trailing slash. Vite inlines `VITE_*` values at build time, so a change needs a restart (and a rebuild for production). |

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Vite dev server with hot reload |
| `pnpm build` | Type-checks and writes the static build to `dist/` |
| `pnpm preview` | Serves the built `dist/` locally |
| `pnpm test` | Runs the Vitest suite once |
| `pnpm test:watch` | Runs Vitest in watch mode |
| `pnpm typecheck` | `tsc -b` over the app and config projects |
| `pnpm lint` | oxlint |

## API contract consumed

| Request | Response |
| --- | --- |
| `GET /api/health` | `{ status: "ok" }` |
| `GET /api/documents` | `{ documents: DocumentSummary[] }` |
| `POST /api/documents` with `{ filename, content }` | The indexed `DocumentSummary` |
| `POST /api/chat` with `{ question }` | `{ answer, citations, retrievedChunks }` |

## Deployment

Deploy the static build to Vercel as a Vite project (`pnpm build`, output
`dist/`), set `VITE_API_BASE_URL` to the deployed server URL, and set the
server's `CLIENT_ORIGIN` to the deployed client origin — the server allows only
that one browser origin through CORS.
