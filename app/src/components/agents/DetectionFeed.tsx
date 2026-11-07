import { useAssets } from '@/lib/assets'
import { clearDetections, useDetections } from '@/lib/listings'
import { Link } from '@/lib/router'

/** Live detection feed: every new registry listing the watcher saw, each with its auto-created ticket (market page). */
export function DetectionFeed() {
  const log = useDetections()
  const assets = useAssets()
  const live = assets.isSuccess && !assets.isError

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden className={`h-2 w-2 rounded-full ${live ? 'bg-up motion-safe:animate-pulse' : 'bg-faint'}`} />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide">{live ? 'Live' : 'Offline'}</span>
          <span className="num">· watching {assets.data?.length ?? 0} markets</span>
        </span>
        {log.length > 0 && (
          <button type="button" className="btn-ghost h-8 px-2.5 text-xs" onClick={clearDetections}>Clear</button>
        )}
      </div>

      {log.length === 0 ? (
        <p className="mt-3 text-sm text-muted">
          No new listings yet. The registry is checked about every 30 seconds while this app is open; a new market appears here
          and gets a ticket automatically.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line" aria-live="polite">
          {log.map((d) => (
            <li key={`${d.token}-${d.at}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {d.display} <span className="badge border border-line text-muted">{d.category}</span>
                </p>
                <p className="num text-xs text-muted">{new Date(d.at).toLocaleString()}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <span className="badge bg-up/15 text-up">Ticket created</span>
                <Link to={d.href} className="font-medium text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  Open market
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
