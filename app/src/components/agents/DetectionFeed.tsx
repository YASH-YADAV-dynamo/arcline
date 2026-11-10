import { useAssets } from '@/lib/assets'
import { clearDetections, useDetections } from '@/lib/listings'
import { Link } from '@/lib/router'

/** Live detection feed: every new registry listing the watcher saw, each with its auto-created ticket (market page). */
export function DetectionFeed() {
  const log = useDetections()
  const assets = useAssets()
  const live = assets.isSuccess && !assets.isError

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-muted caption-2">
          <span aria-hidden className={`size-2 rounded-full ${live ? 'bg-up motion-safe:animate-pulse' : 'bg-faint'}`} />
          <span className="text-ink">{live ? 'Live' : 'Offline'}</span>
          <span>· watching {assets.data?.length ?? 0} markets</span>
        </span>
        {log.length > 0 && (
          <button type="button" className="link-quiet caption-2" onClick={clearDetections}>Clear</button>
        )}
      </div>

      {log.length === 0 ? (
        <p className="mt-4 text-muted body-6">
          Nothing new yet. While this page is open the registry is checked about every 30 seconds, and a new market appears here with a
          trade ticket ready.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line" aria-live="polite">
          {log.map((d) => (
            <li key={`${d.token}-${d.at}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0">
                <p className="truncate title-5">
                  {d.display} <span className="text-muted caption-4">{d.category}</span>
                </p>
                <p className="font-mono text-muted caption-5">{new Date(d.at).toLocaleString()}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs">
                <span className="text-up caption-4">Ticket ready</span>
                <Link to={d.href} className="link-quiet text-accent caption-1 hover:text-ink">
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
