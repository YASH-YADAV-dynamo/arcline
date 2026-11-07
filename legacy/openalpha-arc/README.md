# OpenAlpha on Arc (testnet)

Arc is OpenAlpha's settlement layer. Two contracts on **Arc Testnet** (chain id 5042002), built and deployed in Arc Studio:

- **OpenAlphaBountyVault**: funders escrow USDC (ERC-20 interface, 6 decimals) per research issue. A settler (our backend or a CRE forwarder) posts payees and basis points; payees pull their share; funders refund after expiry or take back the unallocated part.
- **OpenAlphaBasketLedger**: a proof log of each research-driven rebalance of the **paper** basket (weights in bps, research hash, accepted-findings hash). Holds no funds.

Interfaces: [`IOpenAlpha.sol`](IOpenAlpha.sol). The web app codes against these.

## Build and deploy with Arc Studio

```bash
arc-studio login --paste          # once, in a normal terminal (never paste the token anywhere else)
bash arc/run-studio.sh            # sends PROMPT.md + IOpenAlpha.sol + contracts/INTERFACES.md
```

The script saves the raw result to `arc/studio-result.json` and copies `deployments[]` and `webUrl` into `arc/deployments.json`. It never generates addresses: if Studio reported none, the fields stay `null`. Follow-up turns: `arc-studio run "..." --session openalpha-arc --output json`.

## Connect the web app

`web/src/lib/integrations/arc.ts` reads addresses from `arc/deployments.json`, or from env (env wins):

| Variable | Meaning |
|---|---|
| `ARC_BOUNTY_VAULT_ADDRESS` | OpenAlphaBountyVault |
| `ARC_BASKET_LEDGER_ADDRESS` | OpenAlphaBasketLedger |
| `ARC_RPC_URL` | default `https://rpc.testnet.arc.io` |
| `ARC_PRIVATE_KEY` | throwaway testnet key that holds the settler and recorder roles |

**Simulated** until a key and at least one address exist. **Live** then: when every shard of a bounty issue is done, the backend calls `settle` on the vault (only if the issue was funded on Arc); when the paper basket rebalances, it calls `recordRebalance`. Grant the backend wallet the roles first: `setSettler(<wallet>, true)` and `setRecorder(<wallet>, true)` from the owner. Status: `/proof` and `GET /api/v1/arc`.

Arc specifics: USDC is native gas (18 decimals) but the ERC-20 at `0x3600…0000` uses 6; the app only ever shows the 6-decimal ERC-20 figure. Writes use `maxFeePerGas` ≥ 20 gwei. Test USDC: https://faucet.circle.com.
