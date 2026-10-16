import { useState } from 'react'
import { DocumentLibrary } from '@/components/DocumentLibrary'
import { DocumentUpload } from '@/components/DocumentUpload'
import { Card, CardContent } from '@/components/ui/card'

export default function App() {
  // Bumped after a successful upload; remounting the library re-reads the list.
  const [libraryVersion, setLibraryVersion] = useState(0)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-14">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          RAG Sourcebook
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
          Add .txt and .md documents to the sourcebook, then ask questions and read answers that
          cite the passages they came from.
        </p>
      </header>

      <main className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section aria-labelledby="documents-heading" className="flex flex-col gap-3">
          <h2 id="documents-heading" className="font-heading text-lg font-medium">
            Documents
          </h2>
          <Card>
            <CardContent>
              <DocumentUpload onUploaded={() => setLibraryVersion((version) => version + 1)} />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <DocumentLibrary key={libraryVersion} />
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="ask-heading" className="flex flex-col gap-3">
          <h2 id="ask-heading" className="font-heading text-lg font-medium">
            Ask
          </h2>
          <Card>
            <CardContent className="text-sm text-muted-foreground">
              Questions you ask, and the answers with the passages they cite, appear here.
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  )
}
