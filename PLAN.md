# RAG Sourcebook Client Plan

**Goal:** Build a small browser UI for managing text documents and asking grounded questions through the RAG Sourcebook server.

**Architecture:** This is an independent React/Vite TypeScript project. It talks to the separately hosted server using HTTP and does not import backend code. Deploy its static build to Vercel.

**Stack:** React, Vite, TypeScript, Tailwind CSS, shadcn/ui, Lucide icons, Vitest, React Testing Library, `@testing-library/user-event`, and pnpm.

Use shadcn/ui components copied into this repository; do not add Material UI or a second component system. Use native `fetch` helpers and local React state for the small API surface; no Axios, Redux, or React Query is needed.

## API contract consumed

The matching contract is maintained in `../server/PLAN.md`; do not import backend code or add a shared directory.

- `GET /api/health` → `{ status: "ok" }`
- `GET /api/documents` → `{ documents: DocumentSummary[] }`
- `POST /api/documents` → JSON `{ filename: string; content: string }` → indexed document summary
- `POST /api/chat` → `{ question: string }` → `{ answer: string; citations: Citation[]; retrievedChunks: SearchHit[] }`
- `POST /api/chat/stream` → `{ question: string }` → Server-Sent Events: `tool-call`, `tool-result`, `text-delta`, `finish` (carrying the `POST /api/chat` body), and `error`.
- Configure the server origin with `VITE_API_BASE_URL`.

## Scope

- Upload `.txt` and `.md` files; show validation, indexing, and server errors clearly.
- List indexed documents and their chunk counts.
- Ask a question and render the answer, source citations, and retrieved chunk evidence.
- Provide loading, empty, and error states; work at desktop and narrow mobile widths.
- Deploy to Vercel and set `VITE_API_BASE_URL` to the selected backend’s public URL.

## Tasks

### Task 1. Scaffold the client repository

**Files:** `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/lib/utils.ts`, `src/components/ui/`, `.gitignore`, `.env.example`, `README.md`, `vitest.config.ts`.

- [x] Write a failing test that renders the app shell and document-upload control.
- [x] Run the test and confirm it fails because the UI is absent.
- [x] Create the Vite/React/TypeScript app, configure Tailwind CSS, initialize shadcn/ui, and implement the smallest accessible app shell.
- [x] Run `pnpm test`, `pnpm typecheck`, and `pnpm build`.

### Task 2. Implement document upload and library

**Files:** `src/api/documents.ts`, `src/components/DocumentLibrary.tsx`, `src/components/DocumentUpload.tsx`, related tests.

- [x] Test accepted extensions, rejected extensions, empty files, upload success, and server failure states.
- [x] Implement file reading and send `{ filename, content }` to `POST /api/documents`; refresh the list from `GET /api/documents` after success.
- [x] Run the focused tests and then the full client suite.

### Task 3. Implement chat and evidence display

**Files:** `src/api/chat.ts`, `src/components/ChatPanel.tsx`, `src/components/SourceEvidence.tsx`, related tests.

- [x] Test submission, loading/error feedback, answer rendering, citations, and retrieved chunks.
- [x] Implement chat against `POST /api/chat`; display source filename and chunk index for each citation.
- [x] Run the focused tests and then the full client suite.

### Task 4. Verify and deploy the client

- [x] Smoke-test upload, answerable question, citation inspection, and unsupported question against the local server.
- [x] Check keyboard access, visible focus, labels, responsive layout, and readable contrast.
- [x] Deploy the Vite build to Vercel and set `VITE_API_BASE_URL` to the backend URL.
- [x] Verify the deployed client can reach the server and that server CORS allows only the client’s production origin.

### Task 5. Stream the answer and show the tool activity

**Files:** `src/api/chat.ts`, `src/components/ChatPanel.tsx`, `src/components/ActivityTrace.tsx`, `src/components/ToolCallRow.tsx`, `src/components/chatThread.ts`, `src/components/ui/collapsible.tsx`, related tests.

- [x] Test the SSE frame parser: frames split across reads, multi-line data, and the finish and error events.
- [x] Test the turn reducer: ordered steps, streamed text, abstention with no step, and the error state.
- [x] Read `POST /api/chat/stream` with native `fetch` and a `ReadableStream` reader, abortable through `AbortController`.
- [x] Render one collapsible row per tool call showing status, duration, parameters, and result; summarise each row once it finishes.
- [x] Turn the panel into a conversation thread with autoscroll, a stop control, an empty state, and the existing evidence panel.

### Task 6. Apply the Geist dark theme and redeploy

- [x] Re-tokenise the palette as a single dark set on Geist's values: near-black canvas, white-alpha borders, one functional blue accent.
- [x] Set `color-scheme: dark` and a matching `theme-color`, and use Geist Mono with tabular numerals for tool names, filenames, durations, and relevance scores.
- [x] Extend the palette contrast test to the new values; check keyboard access, focus, reduced motion, and 375/768/1440 widths.
- [x] Redeploy to Vercel and smoke-test the live trace, an abstention, and citation evidence against the deployed server.

## Out of scope

- Authentication, client-side document persistence, direct database access, server-side RAG logic, and a client-hosted MCP implementation.
- Cross-session conversation history: the thread lives in memory for the tab and is not stored.
