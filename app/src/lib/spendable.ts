// USDC is the gas token on Arc, so the balance that funds a trade is the same balance that pays
// for it. A wallet showing "3.08 USDC" can still fail a 3 USDC deposit once gas is taken out.
// Max/100% chips must use `spendable`, never the raw balance.
import { useQuery } from '@tanstack/react-query'
import { usePublicClient } from 'wagmi'
import { arcTestnet } from 'viem/chains'
import { erc20Abi } from 'viem'
import { ADDR } from './contracts'

/** Held back for gas, in USDC units (6dp). Enough for several approvals plus a swap. */
export const GAS_RESERVE = 250_000n // 0.25 USDC

export type Spendable = { balance: bigint; reserved: bigint; spendable: bigint; lowGas: boolean }

export function useSpendable(account: `0x${string}` | undefined) {
  const client = usePublicClient({ chainId: arcTestnet.id })
  return useQuery<Spendable>({
    queryKey: ['spendable', account],
    enabled: Boolean(client && account),
    refetchInterval: 15_000,
    queryFn: async (): Promise<Spendable> => {
      const balance = await client!.readContract({ address: ADDR.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [account!] })
      const spendable = balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n
      return { balance, reserved: GAS_RESERVE, spendable, lowGas: balance <= GAS_RESERVE }
    },
  })
}

/** Cap a requested amount at what is actually spendable, when spending USDC. */
export const capToSpendable = (want: bigint, s: Spendable | undefined) =>
  s ? (want > s.spendable ? s.spendable : want) : want
