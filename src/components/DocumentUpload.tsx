import { type ChangeEvent, useState } from 'react'
import { errorMessage } from '@/api/client'
import {
  ACCEPTED_EXTENSIONS,
  type DocumentSummary,
  uploadDocument,
  validateDocument,
} from '@/api/documents'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type DocumentUploadProps = {
  /** Called with the stored document once the server has indexed the file. */
  onUploaded: (document: DocumentSummary) => void
}

export function DocumentUpload({ onUploaded }: DocumentUploadProps) {
  const [problem, setProblem] = useState<string | null>(null)
  const [isIndexing, setIsIndexing] = useState(false)

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

  return (
    <div className="flex flex-col gap-2">
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
      {isIndexing ? (
        <p role="status" className="text-sm text-muted-foreground">
          Indexing…
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  )
}
