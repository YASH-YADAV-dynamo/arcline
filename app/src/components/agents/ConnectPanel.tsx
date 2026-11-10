import { DownloadSimple } from '@phosphor-icons/react'
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
      <div className="card p-5 sm:p-6">
        <h3 className="title-4">Market list for your agent</h3>
        <p className="mt-2 text-muted body-6">
          Every coin, its venue and its live price come from the registry contract. When a price is too old, reading it fails, which means
          that coin cannot be traded right now. A new address in <code className="font-mono text-ink">assets()</code> is a new market.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button type="button" className="cta-sm disabled:cursor-not-allowed disabled:opacity-40" onClick={download} disabled={!list}>
            <DownloadSimple size={16} weight="bold" aria-hidden /> Download market list (.json)
          </button>
          <span className="text-muted caption-2" aria-live="polite">
            {assets.isLoading ? 'Reading the registry…' : assets.isError ? 'Could not read the registry.' : `${list?.length ?? 0} markets`}
          </span>
        </div>
      </div>
      <CodeBlock title="Read prices and watch for listings (Node and viem)" code={READ_SNIPPET} />
      <CodeBlock title="Run the example agent" code={RUN_SNIPPET} />
    </div>
  )
}
