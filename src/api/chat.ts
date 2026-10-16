import { requestJson } from './client'

/** Mirrors the server's `Citation` in `../server/src/rag/answer.ts`. */
export type Citation = {
  documentId: string
  filename: string
  chunkIndex: number
}

/** Mirrors the server's `SearchHit` in `../server/src/rag/search.ts`. */
export type SearchHit = Citation & {
  content: string
  /** Cosine similarity, normalized so larger values are more relevant. */
  relevance: number
}

export type ChatAnswer = {
  answer: string
  citations: Citation[]
  retrievedChunks: SearchHit[]
}

export async function askQuestion(question: string): Promise<ChatAnswer> {
  return requestJson<ChatAnswer>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ question }),
  })
}
