import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Copy text to the clipboard; resolves false when the browser blocks it. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function CopyButton({ text, label = 'Copy', className = 'btn-ghost h-8 px-2.5 text-xs' }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const onClick = () => {
    void copyText(text).then((ok) => {
      setState(ok ? 'ok' : 'fail')
      setTimeout(() => setState('idle'), 1800)
    })
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {state === 'ok' ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      <span aria-live="polite">{state === 'ok' ? 'Copied' : state === 'fail' ? 'Copy failed' : label}</span>
    </button>
  )
}

/** Mono code block. The code scrolls horizontally inside its own box, never the page. */
export function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-xl border border-line bg-panel2">
      <figcaption className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="eyebrow truncate">{title}</span>
        <CopyButton text={code} />
      </figcaption>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-ink" tabIndex={0} aria-label={title}>
        <code>{code}</code>
      </pre>
    </figure>
  )
}
