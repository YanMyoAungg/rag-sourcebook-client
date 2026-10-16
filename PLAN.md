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
- [ ] Verify the deployed client can reach the server and that server CORS allows only the client’s production origin.

## Out of scope

- Authentication, client-side document persistence, direct database access, server-side RAG logic, and a client-hosted MCP implementation.
