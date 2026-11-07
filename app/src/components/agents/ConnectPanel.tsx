import { Download } from 'lucide-react'
import { useAssets } from '@/lib/assets'
import { downloadText } from '@/lib/agent-account'
import { CodeBlock } from './CodeBlock'
import { READ_SNIPPET, RUN_SNIPPET, buildAgentContext } from './context'

export function ConnectPanel() {
  const assets = useAssets()
  const list = assets.data

  const download = () => {
    if (!list) return
    downloadText('arc-agent-context.json', `${JSON.stringify(buildAgentContext(list), null, 2)}\n`, 'application/json')
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5">
        <p className="text-sm text-muted">
          Agents read markets straight from the on-chain AssetRegistry. <code className="font-mono text-ink">priceE8</code> reverts
          when a price is stale, so a missing price means trading is disabled for that asset. A new token address in{' '}
          <code className="font-mono text-ink">assets()</code> is a new market.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className="btn" onClick={download} disabled={!list}>
            <Download size={15} aria-hidden /> Download agent context (.json)
          </button>
          <span className="text-xs text-muted" aria-live="polite">
            {assets.isLoading ? 'Reading the registry…' : assets.isError ? 'Could not read the registry.' : `${list?.length ?? 0} markets in the snapshot`}
          </span>
        </div>
      </div>
      <CodeBlock title="Read markets and watch listings (Node, viem)" code={READ_SNIPPET} />
      <CodeBlock title="Run the example agent" code={RUN_SNIPPET} />
    </div>
  )
}
