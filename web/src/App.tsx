import { useEffect, useState } from 'react'
import { client } from './api/client'
import ThemeToggle from './ThemeToggle'

export default function App() {
  const [health, setHealth] = useState<string>('checking...')

  useEffect(() => {
    client
      .GET('/health')
      .then(({ data, error }) => {
        setHealth(data ? `${data.status} (v${data.version})` : `error: ${JSON.stringify(error)}`)
      })
      .catch(() => setHealth('unreachable'))
  }, [])

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold">Canonico</h1>
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-3xl p-8">
        <p className="text-sm text-muted-foreground">
          API health: <span className="font-mono text-foreground">{health}</span>
        </p>
      </main>
    </div>
  )
}
