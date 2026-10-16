import { useEffect, useState } from 'react'
import { errorMessage } from '@/api/client'
import { type DocumentSummary, listDocuments } from '@/api/documents'
import { Skeleton } from '@/components/ui/skeleton'

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
      .then((loaded) => {
        if (isCurrent) setDocuments(loaded)
      })
      .catch((cause: unknown) => {
        if (isCurrent) setProblem(errorMessage(cause))
      })

    return () => {
      isCurrent = false
    }
  }, [])

  if (problem) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {problem}
      </p>
    )
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
        <li
          key={document.id}
          className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0"
        >
          <span className="truncate font-medium">{document.filename}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {describeChunkCount(document.chunkCount)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function describeChunkCount(count: number): string {
  return count === 1 ? '1 chunk' : `${count} chunks`
}
