import type { SearchHit } from '@/api/chat'

/**
 * The passages the answer was drawn from, kept behind a disclosure so the answer
 * stays readable but every claim can still be checked.
 */
export function SourceEvidence({ chunks }: { chunks: SearchHit[] }) {
  if (chunks.length === 0) return null

  return (
    <details className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">
        {chunks.length === 1 ? '1 retrieved passage' : `${chunks.length} retrieved passages`}
      </summary>
      <ul className="mt-3 flex flex-col gap-3">
        {chunks.map((chunk) => (
          <li key={`${chunk.documentId}-${chunk.chunkIndex}`} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="font-mono text-xs">
                {chunk.filename} · chunk {chunk.chunkIndex + 1}
              </span>
              <span className="text-xs text-muted-foreground">
                relevance {chunk.relevance.toFixed(2)}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{chunk.content}</p>
          </li>
        ))}
      </ul>
    </details>
  )
}
