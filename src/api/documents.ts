import { requestJson } from './client'

/** Mirrors the rules the server enforces in `../server/src/documents/ingest.ts`. */
export const ACCEPTED_EXTENSIONS = ['.txt', '.md'] as const
export const MAX_DOCUMENT_BYTES = 1024 * 1024

export type DocumentSummary = {
  id: string
  filename: string
  chunkCount: number
  createdAt: string
}

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

export async function listDocuments(): Promise<DocumentSummary[]> {
  const body = await requestJson<{ documents: DocumentSummary[] }>('/api/documents')

  return body.documents
}

export async function uploadDocument(file: File): Promise<DocumentSummary> {
  return requestJson<DocumentSummary>('/api/documents', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, content: await file.text() }),
  })
}
