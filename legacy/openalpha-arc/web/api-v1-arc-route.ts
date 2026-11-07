import { NextResponse } from "next/server";
import "@/lib/integrations";
import { arcState } from "@/lib/integrations/arc";

export const dynamic = "force-dynamic";

// GET: Arc settlement status. Network, contract addresses (from arc/deployments.json or env), the Arc
// Studio project URL, onchain reads (vault USDC in 6-decimal ERC-20 units, ledger seq) and the recent
// settle / recordRebalance calls (sent, or logged as simulated). Public data only; never the key.
export async function GET() {
  return NextResponse.json(await arcState(), { headers: { "cache-control": "no-store" } });
}
