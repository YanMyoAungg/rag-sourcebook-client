import { type FormEvent, useEffect, useRef, useState } from "react";
import { streamAsk } from "@/api/chat";
import { errorMessage } from "@/api/client";
import { ActivityTrace } from "@/components/ActivityTrace";
import {
  applyEvent,
  failTurn,
  newTurn,
  stopTurn,
} from "@/components/chatThread";
import type { ChatTurn } from "@/components/chatThread";
import { SourceEvidence } from "@/components/SourceEvidence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ChatPanel() {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [isAsking, setIsAsking] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  // Follow the answer only while the reader is already at the end of the thread.
  const followsThread = useRef(true);

  const asked = question.trim();

  useEffect(() => {
    const thread = threadRef.current;
    if (thread !== null && followsThread.current) {
      thread.scrollTop = thread.scrollHeight;
    }
  }, [exchanges]);

  function handleScroll() {
    const thread = threadRef.current;
    if (thread === null) return;

    followsThread.current =
      thread.scrollHeight - thread.scrollTop - thread.clientHeight < 40;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (asked === "" || isAsking) return;

    const id = crypto.randomUUID();
    setExchanges((previous) => [...previous, { id, turn: newTurn(id, asked) }]);
    setQuestion("");
    setIsAsking(true);
    followsThread.current = true;

    const controller = new AbortController();
    abortRef.current = controller;

    const update = (change: (turn: ChatTurn) => ChatTurn) =>
      setExchanges((previous) =>
        previous.map((exchange) =>
          exchange.id === id
            ? { ...exchange, turn: change(exchange.turn) }
            : exchange,
        ),
      );

    try {
      await streamAsk(
        asked,
        (event) => update((turn) => applyEvent(turn, event)),
        controller.signal,
      );
    } catch (cause) {
      // A stop is the reader's own doing; anything else is worth reporting.
      update((turn) =>
        controller.signal.aborted
          ? stopTurn(turn)
          : failTurn(turn, errorMessage(cause)),
      );
    } finally {
      abortRef.current = null;
      setIsAsking(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={threadRef}
        onScroll={handleScroll}
        className="flex max-h-[60vh] min-h-40 flex-col gap-5 overflow-y-auto"
      >
        {exchanges.length === 0 ? <EmptyThread /> : null}
        {exchanges.map((exchange) => (
          <Exchange key={exchange.id} turn={exchange.turn} />
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 border-t border-border pt-4"
      >
        <Label htmlFor="question">Your question</Label>
        <Textarea
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          // Enter sends, as it does in a chat box; Shift+Enter keeps a line break.
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="What does the sourcebook say about…?"
          rows={2}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={isAsking || asked === ""}>
            Ask
          </Button>
          {isAsking ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => abortRef.current?.abort()}
            >
              Stop
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

type Exchange = { id: string; turn: ChatTurn };

/** One question, the trace of how it was answered, and the answer itself. */
function Exchange({ turn }: { turn: ChatTurn }) {
  return (
    <article className="flex flex-col gap-3">
      <p className="text-sm font-medium">{turn.question}</p>

      <div className="flex flex-col gap-3 border-l border-border pl-4">
        <ActivityTrace turn={turn} />

        {turn.answer === "" ? null : (
          <p className="text-sm whitespace-pre-wrap">{turn.answer}</p>
        )}

        {turn.error === null ? null : (
          <p role="alert" className="text-sm text-destructive">
            {turn.error}
          </p>
        )}

        {turn.result !== null && turn.result.citations.length > 0 ? (
          <ul aria-label="Sources" className="flex flex-wrap gap-2">
            {turn.result.citations.map((citation) => (
              <li key={`${citation.documentId}-${citation.chunkIndex}`}>
                <Badge variant="secondary">
                  {citation.filename} · chunk {citation.chunkIndex + 1}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}

        {turn.result === null ? null : (
          <SourceEvidence chunks={turn.result.retrievedChunks} />
        )}
      </div>
    </article>
  );
}

function EmptyThread() {
  return (
    <p className="py-1 text-sm text-muted-foreground text-balance">
      Ask about anything in the documents you have indexed. Every answer cites
      the passages it used, and says so when nothing in them matches.
    </p>
  );
}
