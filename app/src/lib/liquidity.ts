// Which markets have real depth on Arc Testnet. Only the EURC/USDC pool is a real Uniswap v4 pool with
// meaningful liquidity; every other market settles on a thin, oracle-priced mirror venue, so larger orders
// move the price a lot. Used to show a low-liquidity warning in the ticket.
const DEEP = new Set(['EURC', 'USDC'])

export const isLowLiquidity = (display: string): boolean => !DEEP.has(display)
