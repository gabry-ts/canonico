import { useEffect, useState } from 'react'

type Mode = 'light' | 'dark' | 'system'
const modes: Mode[] = ['light', 'dark', 'system']

function readMode(): Mode {
  try {
    const v = localStorage.getItem('theme')
    if (v === 'light' || v === 'dark') return v
  } catch {
    // storage unavailable
  }
  return 'system'
}

function apply(mode: Mode) {
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(readMode)

  useEffect(() => {
    apply(mode)
    try {
      if (mode === 'system') localStorage.removeItem('theme')
      else localStorage.setItem('theme', mode)
    } catch {
      // storage unavailable
    }
    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => apply('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  return (
    <div role="group" aria-label="Theme" className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs">
      {modes.map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={`rounded-md px-2.5 py-1 capitalize transition-colors ${
            mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  )
}
