import { type FormEvent, useState } from 'react'
import { askQuestion, type ChatAnswer } from '@/api/chat'
import { errorMessage } from '@/api/client'
import { SourceEvidence } from '@/components/SourceEvidence'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function ChatPanel() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<ChatAnswer | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [isAsking, setIsAsking] = useState(false)

  const asked = question.trim()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (asked === '') return

    setIsAsking(true)
    setProblem(null)

    try {
      setAnswer(await askQuestion(asked))
    } catch (cause) {
      setProblem(errorMessage(cause))
    } finally {
      setIsAsking(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="question">Your question</Label>
        <Textarea
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What does the sourcebook say about…?"
          rows={3}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={isAsking || asked === ''}>
          Ask
        </Button>
        {isAsking ? (
          <p role="status" className="text-sm text-muted-foreground">
            Asking the sourcebook…
          </p>
        ) : null}
      </div>

      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      {answer ? <Answer answer={answer} /> : null}
    </form>
  )
}

function Answer({ answer }: { answer: ChatAnswer }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Answer</h3>
        <p className="text-sm whitespace-pre-wrap">{answer.answer}</p>
      </div>

      {answer.citations.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 id="sources-heading" className="text-sm font-medium">
            Sources
          </h3>
          <ul aria-labelledby="sources-heading" className="flex flex-wrap gap-2">
            {answer.citations.map((citation) => (
              <li key={`${citation.documentId}-${citation.chunkIndex}`}>
                <Badge variant="secondary">
                  {citation.filename} · chunk {citation.chunkIndex + 1}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <SourceEvidence chunks={answer.retrievedChunks} />
    </div>
  )
}
