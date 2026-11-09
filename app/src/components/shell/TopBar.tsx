// Wordmark shared by the navbar (SiteNav) and anything else that links home.
import { Link } from '@/lib/router'

export function Wordmark() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2 text-ink" aria-label="Arcline home">
      <span aria-hidden className="relative inline-block h-5 w-5 rounded-md bg-accent">
        <span className="absolute inset-[5px] rounded-[3px] bg-onaccent/90" />
      </span>
      <span className="text-[15px] font-semibold tracking-tight">Arcline</span>
    </Link>
  )
}
