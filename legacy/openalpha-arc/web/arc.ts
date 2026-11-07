// Circle Arc (testnet) settlement layer: OpenAlphaBountyVault (USDC escrow + pull payouts) and
// OpenAlphaBasketLedger (proof log of paper-basket rebalances). Interfaces: arc/IOpenAlpha.sol.
//
// Modes
//   simulated  no ARC_PRIVATE_KEY, or no contract address: the calls we WOULD send are logged here,
//              labelled "simulated (not sent)". Nothing touches the chain.
//   live       ARC_PRIVATE_KEY + an address: a fully-done bounty issue funded on Arc gets settle(),
//              and every paper-basket rebalance gets recordRebalance(). The wallet must hold the
//              settler / recorder roles (setSettler / setRecorder from the owner).
//
// Addresses: env ARC_BOUNTY_VAULT_ADDRESS / ARC_BASKET_LEDGER_ADDRESS win; otherwise arc/deployments.json
// (copied from Arc Studio's result by arc/run-studio.sh, never typed in). RPC: ARC_RPC_URL, default public.
// Arc rules honoured: USDC ERC-20 at 0x3600…0000 has 6 decimals (the only balance we show), every write
// sets maxFeePerGas >= 20 gwei, no native value is ever sent. The key is never logged or returned.
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";
import { createHash } from "crypto";
import { createPublicClient, createWalletClient, formatUnits, http, isAddress, keccak256, parseAbi, parseGwei, toBytes, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet } from "viem/chains";
import { engineState } from "../engine";
import { creInputs } from "./cre";
import { subscribe, type EngineEvent } from "./events";
import { registerIntegration, type IntegrationStatus } from "./registry";

export const ARC_CHAIN_ID = 5042002;
const DEFAULT_RPC = "https://rpc.testnet.arc.io";
const EXPLORER = "https://explorer.testnet.arc.io";
const USDC = "0x3600000000000000000000000000000000000000" as const; // ERC-20 interface, 6 decimals
const USDC_DECIMALS = 6;
const MIN_FEE = parseGwei("20"); // below this Arc silently drops the tx
export const BASKET_ID = keccak256(toBytes("openalpha:paper-basket:v1"));
export const issueKey = (issueId: string) => keccak256(toBytes(issueId)); // same as IssueRegistry + Studio UI
const MAX_PAYEES = 10;
const REBALANCE_COOLDOWN_MS = 20_000;
const READ_CACHE_MS = 15_000;
const LOG_CAP = 20;

const vaultAbi = parseAbi([
  "function settle(bytes32 issueId, address[] payees, uint16[] bps, bytes32 evidenceHash)",
  "function bountyOf(bytes32 issueId) view returns (uint256 total, uint64 expiresAt, bool settled, uint16 allocatedBps, bytes32 evidenceHash)",
  "function totalEscrowed() view returns (uint256)",
  "function isSettler(address) view returns (bool)",
]);
const ledgerAbi = parseAbi([
  "function recordRebalance(bytes32 basketId, uint64 seq, string[] symbols, uint16[] weightsBps, bytes32 researchHash, bytes32 findingsHash)",
  "function lastSeq(bytes32 basketId) view returns (uint64)",
  "function isRecorder(address) view returns (bool)",
  "function LABEL() view returns (string)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export const arcTx = (h: string) => `${EXPLORER}/tx/${h}`;
export const arcAddr = (a: string) => `${EXPLORER}/address/${a}`;
const mask = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmtUsdc = (v: bigint) => `${Number(formatUnits(v, USDC_DECIMALS)).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC (testnet)`;

// ---------- config ----------
type DeployFile = { webUrl: string | null; bountyVault: string | null; basketLedger: string | null; status: string | null };
const gf = globalThis as unknown as { __oa_arc_file?: { mtime: number; data: DeployFile | null } };
const deployPath = () => path.resolve(process.cwd(), "..", "arc", "deployments.json");

function deployFile(): DeployFile | null {
  const p = deployPath();
  if (!existsSync(p)) return null;
  try {
    const mtime = statSync(p).mtimeMs;
    if (gf.__oa_arc_file?.mtime === mtime) return gf.__oa_arc_file.data;
    const j = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" && v ? v : null);
    const web = s(j.webUrl);
    const data: DeployFile = {
      webUrl: web && /^https:\/\/[^\s]+$/.test(web) ? web : null,
      bountyVault: s(j.bountyVault),
      basketLedger: s(j.basketLedger),
      status: s(j.status),
    };
    gf.__oa_arc_file = { mtime, data };
    return data;
  } catch {
    return null;
  }
}

function cfg() {
  const f = deployFile();
  const pick = (envName: string, fromFile: string | null) => {
    const v = process.env[envName]?.trim() || fromFile;
    return v && isAddress(v) ? (v as Hex) : null;
  };
  const rpcEnv = process.env.ARC_RPC_URL?.trim();
  const key = process.env.ARC_PRIVATE_KEY?.trim() ?? "";
  return {
    vault: pick("ARC_BOUNTY_VAULT_ADDRESS", f?.bountyVault ?? null),
    ledger: pick("ARC_BASKET_LEDGER_ADDRESS", f?.basketLedger ?? null),
    addressSource: process.env.ARC_BOUNTY_VAULT_ADDRESS || process.env.ARC_BASKET_LEDGER_ADDRESS ? "env" : f ? "arc/deployments.json" : null,
    rpc: rpcEnv && /^https:\/\/[^\s]+$/.test(rpcEnv) ? rpcEnv : DEFAULT_RPC,
    key: /^0x[0-9a-fA-F]{64}$/.test(key) ? (key as Hex) : null,
    keyMalformed: key !== "" && !/^0x[0-9a-fA-F]{64}$/.test(key),
    webUrl: f?.webUrl ?? null,
    studioStatus: f?.status ?? null,
  };
}

export function arcMode(): "live" | "simulated" {
  const c = cfg();
  return c.key && (c.vault || c.ledger) ? "live" : "simulated";
}

// ---------- clients (cached per rpc + key fingerprint; the key itself is never stored in the signature) ----------
type Clients = { pub: ReturnType<typeof makePub>; wallet: ReturnType<typeof makeWallet> | null; writer: Hex | null };
const makePub = (rpc: string) => createPublicClient({ chain: arcTestnet, transport: http(rpc, { timeout: 15_000 }) });
const makeWallet = (rpc: string, key: Hex) => createWalletClient({ chain: arcTestnet, transport: http(rpc, { timeout: 30_000 }), account: privateKeyToAccount(key) });
const gc = globalThis as unknown as { __oa_arc_clients?: { sig: string; c: Clients } };

function clients(): Clients {
  const c = cfg();
  const sig = `${c.rpc}|${c.key ? createHash("sha256").update(c.key).digest("hex") : ""}`;
  if (gc.__oa_arc_clients?.sig === sig) return gc.__oa_arc_clients.c;
  const wallet = c.key ? makeWallet(c.rpc, c.key) : null;
  const out: Clients = { pub: makePub(c.rpc), wallet, writer: wallet?.account.address ?? null };
  gc.__oa_arc_clients = { sig, c: out };
  return out;
}

/** Error text safe to show: short message only, RPC URL (may carry an API key) scrubbed. */
function safeErr(e: unknown): string {
  const m = e && typeof e === "object" && "shortMessage" in e && typeof e.shortMessage === "string" ? e.shortMessage : e instanceof Error ? e.message : "failed";
  return m.split(cfg().rpc).join("<rpc>").replace(/https?:\/\/\S+/g, "<url>").slice(0, 160);
}

// ---------- state ----------
export type ArcCall = { kind: "settle" | "rebalance"; label: string; at: string; sent: boolean; txHash: string | null; ok: boolean | null; note: string | null };
type RebalanceCall = { h: number; symbols: string[]; bps: number[]; researchHash: Hex; findingsHash: Hex; reason: string };
type SettleCall = { key: string; issueId: string; payees: Hex[]; bps: number[]; evidenceHash: Hex };
type ArcState = {
  calls: ArcCall[];
  settledKeys: Set<string>; // issue keys we settled or found settled / not funded (don't retry every event)
  pendingRebalance: RebalanceCall | null;
  pendingSettles: Map<string, SettleCall>;
  busy: boolean;
  lastRebalanceAt: number;
  rebalancesSeen: number;
};
const gs = globalThis as unknown as { __oa_arc?: ArcState };
const st = (): ArcState =>
  (gs.__oa_arc ??= { calls: [], settledKeys: new Set(), pendingRebalance: null, pendingSettles: new Map(), busy: false, lastRebalanceAt: 0, rebalancesSeen: 0 });

function note(c: Omit<ArcCall, "at">) {
  const s = st();
  s.calls.unshift({ ...c, at: new Date().toISOString() });
  if (s.calls.length > LOG_CAP) s.calls.length = LOG_CAP;
}

// ---------- building calls ----------
function toBps(weights: Record<string, number>): { symbols: string[]; bps: number[] } {
  const symbols = Object.keys(weights);
  const bps = symbols.map((s) => Math.max(0, Math.floor(weights[s] * 10_000)));
  const top = bps.indexOf(Math.max(...bps));
  bps[top] += 10_000 - bps.reduce((a, b) => a + b, 0); // contract requires an exact 10000 sum
  return { symbols, bps };
}

function buildRebalance(ev: Extract<EngineEvent, { type: "basket.rebalanced" }>): RebalanceCall {
  const { symbols, bps } = toBps(ev.weights);
  const accepted = engineState()
    .findings.filter((f) => f.review.status === "accepted")
    .map((f) => f.id)
    .sort();
  const research = JSON.stringify({ v: 1, h: ev.h, reason: ev.reason, contributors: [...ev.contributors].sort((a, b) => (a.thesisId < b.thesisId ? -1 : 1)) });
  return { h: ev.h, symbols, bps, researchHash: keccak256(toBytes(research)), findingsHash: keccak256(toBytes(accepted.join(","))), reason: ev.reason };
}

// Same split as cre/shared/formula.ts oa-bounty-v1 for "issue:<id>": wallets with positive ledger points on the
// issue's accepted findings, floor bps, zero-bps payees dropped, remainder to the top payee (sum = 10000).
function settleableIssues(): SettleCall[] {
  const snap = creInputs();
  const out: SettleCall[] = [];
  for (const i of snap.issues) {
    if (!i.bounty || !i.units || i.unitsDone < i.units) continue;
    const key = `issue:${i.id}`;
    if (st().settledKeys.has(key)) continue;
    const fids = new Set(snap.findings.filter((f) => f.issueId === i.id).map((f) => f.id));
    const by = new Map<string, number>();
    for (const r of snap.ledger) if (fids.has(r.ref) && r.payee && /^0x[0-9a-f]{40}$/.test(r.payee) && r.points > 0) by.set(r.payee, (by.get(r.payee) ?? 0) + r.points);
    let top = [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_PAYEES);
    for (;;) {
      const t = top.reduce((a, [, p]) => a + p, 0);
      const kept = top.filter(([, p]) => Math.floor((p * 10_000) / t) > 0);
      if (kept.length === top.length) break;
      top = kept;
    }
    const total = top.reduce((a, [, p]) => a + p, 0);
    if (!top.length || total <= 0) continue;
    const bps = top.map(([, p]) => Math.floor((p * 10_000) / total));
    bps[0] += 10_000 - bps.reduce((a, b) => a + b, 0);
    const payees = top.map(([a]) => a as Hex);
    const evidenceHash = keccak256(toBytes(JSON.stringify({ v: "oa-bounty-v1", key, payees, bps, findings: [...fids].sort() })));
    out.push({ key, issueId: i.id, payees, bps, evidenceHash });
  }
  return out;
}

// ---------- writes (serial: one tx in flight) ----------
async function fees(pub: Clients["pub"]) {
  const est = await pub.estimateFeesPerGas().catch(() => null);
  const maxFeePerGas = est?.maxFeePerGas && est.maxFeePerGas > MIN_FEE ? est.maxFeePerGas : MIN_FEE;
  const prio = est?.maxPriorityFeePerGas ?? parseGwei("1");
  return { maxFeePerGas, maxPriorityFeePerGas: prio > maxFeePerGas ? maxFeePerGas : prio };
}

async function sendSettle(c: Clients, vault: Hex, s: SettleCall) {
  const label = `${s.issueId}: ${s.payees.length} payee(s), ${s.bps.map((b) => `${(b / 100).toFixed(2)}%`).join(" / ")}`;
  const id = issueKey(s.issueId);
  const [total, expiresAt, settled] = await c.pub.readContract({ address: vault, abi: vaultAbi, functionName: "bountyOf", args: [id] });
  if (settled || total === BigInt(0) || Number(expiresAt) <= Date.now() / 1000) {
    st().settledKeys.add(s.key);
    note({ kind: "settle", label, sent: false, txHash: null, ok: null, note: settled ? "already settled on Arc" : total === BigInt(0) ? "not funded on Arc: skipped" : "bounty expired on Arc: funders can refund" });
    return;
  }
  const { request } = await c.pub.simulateContract({ address: vault, abi: vaultAbi, functionName: "settle", args: [id, s.payees, s.bps, s.evidenceHash], account: c.wallet!.account, ...(await fees(c.pub)) });
  const hash = await c.wallet!.writeContract(request);
  st().settledKeys.add(s.key);
  const r = await c.pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
  note({ kind: "settle", label, sent: true, txHash: hash, ok: r.status === "success", note: `${fmtUsdc(total)} escrowed` });
}

async function sendRebalance(c: Clients, ledger: Hex, r: RebalanceCall) {
  const label = `h${r.h}: ${r.symbols.map((s, i) => `${s} ${(r.bps[i] / 100).toFixed(1)}%`).join(" ")}`;
  const seq = (await c.pub.readContract({ address: ledger, abi: ledgerAbi, functionName: "lastSeq", args: [BASKET_ID] })) + BigInt(1);
  const { request } = await c.pub.simulateContract({
    address: ledger, abi: ledgerAbi, functionName: "recordRebalance", args: [BASKET_ID, seq, r.symbols, r.bps, r.researchHash, r.findingsHash], account: c.wallet!.account, ...(await fees(c.pub)),
  });
  const hash = await c.wallet!.writeContract(request);
  st().lastRebalanceAt = Date.now();
  const rc = await c.pub.waitForTransactionReceipt({ hash, timeout: 30_000 });
  note({ kind: "rebalance", label, sent: true, txHash: hash, ok: rc.status === "success", note: `seq ${seq}` });
}

async function pump() {
  const s = st();
  if (s.busy) return;
  const c = cfg();
  if (arcMode() !== "live") return;
  s.busy = true;
  try {
    const cl = clients();
    if (!cl.wallet) return;
    for (const [key, call] of s.pendingSettles) {
      s.pendingSettles.delete(key);
      if (!c.vault) break;
      try {
        await sendSettle(cl, c.vault, call);
      } catch (e) {
        note({ kind: "settle", label: call.issueId, sent: false, txHash: null, ok: false, note: safeErr(e) });
      }
    }
    const wait = s.lastRebalanceAt + REBALANCE_COOLDOWN_MS - Date.now();
    if (s.pendingRebalance && c.ledger && wait <= 0) {
      const r = s.pendingRebalance;
      s.pendingRebalance = null;
      try {
        await sendRebalance(cl, c.ledger, r);
      } catch (e) {
        s.lastRebalanceAt = Date.now(); // back off after a failure too
        note({ kind: "rebalance", label: `h${r.h}`, sent: false, txHash: null, ok: false, note: safeErr(e) });
      }
    } else if (s.pendingRebalance && c.ledger) {
      setTimeout(() => void pump(), wait).unref?.();
    }
  } finally {
    s.busy = false;
  }
  if (s.pendingSettles.size || (s.pendingRebalance && Date.now() >= s.lastRebalanceAt + REBALANCE_COOLDOWN_MS)) void pump();
}

// ---------- engine events ----------
subscribe("arc-settlement", (ev) => {
  const s = st();
  const live = arcMode() === "live";
  if (ev.type === "basket.rebalanced") {
    s.rebalancesSeen++;
    const call = buildRebalance(ev);
    if (!live) {
      note({ kind: "rebalance", label: `h${call.h}: ${call.symbols.map((x, i) => `${x} ${(call.bps[i] / 100).toFixed(1)}%`).join(" ")}`, sent: false, txHash: null, ok: null, note: "simulated (not sent)" });
      return;
    }
    s.pendingRebalance = call; // coalesce: only the newest target matters on the proof log
    return pump();
  }
  if (ev.type === "finding.decided" && ev.status === "accepted") {
    for (const call of settleableIssues()) {
      if (!live) {
        s.settledKeys.add(call.key);
        note({ kind: "settle", label: `${call.issueId}: ${call.payees.length} payee(s)`, sent: false, txHash: null, ok: null, note: "simulated (not sent)" });
        continue;
      }
      s.pendingSettles.set(call.key, call);
    }
    if (live) return pump();
  }
});

// ---------- reads ----------
export type ArcReads = { vaultUsdc: bigint | null; escrowed: bigint | null; lastSeq: bigint | null; label: string | null; isSettler: boolean | null; isRecorder: boolean | null; errors: string[] };
const gr = globalThis as unknown as { __oa_arc_reads?: { at: number; sig: string; r: ArcReads } };

async function reads(): Promise<ArcReads> {
  const c = cfg();
  const cl = clients();
  const sig = `${c.vault}|${c.ledger}|${c.rpc}|${cl.writer}`;
  if (gr.__oa_arc_reads && gr.__oa_arc_reads.sig === sig && Date.now() - gr.__oa_arc_reads.at < READ_CACHE_MS) return gr.__oa_arc_reads.r;
  const r: ArcReads = { vaultUsdc: null, escrowed: null, lastSeq: null, label: null, isSettler: null, isRecorder: null, errors: [] };
  const attempt = async (what: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      r.errors.push(`${what}: ${safeErr(e)}`);
    }
  };
  const vault = c.vault;
  const ledger = c.ledger;
  const writer = cl.writer;
  await Promise.all([
    vault &&
      attempt("BountyVault", async () => {
        r.vaultUsdc = await cl.pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [vault] });
        r.escrowed = await cl.pub.readContract({ address: vault, abi: vaultAbi, functionName: "totalEscrowed" });
        if (writer) r.isSettler = await cl.pub.readContract({ address: vault, abi: vaultAbi, functionName: "isSettler", args: [writer] });
      }),
    ledger &&
      attempt("BasketLedger", async () => {
        r.lastSeq = await cl.pub.readContract({ address: ledger, abi: ledgerAbi, functionName: "lastSeq", args: [BASKET_ID] });
        r.label = await cl.pub.readContract({ address: ledger, abi: ledgerAbi, functionName: "LABEL" });
        if (writer) r.isRecorder = await cl.pub.readContract({ address: ledger, abi: ledgerAbi, functionName: "isRecorder", args: [writer] });
      }),
  ]);
  gr.__oa_arc_reads = { at: Date.now(), sig, r };
  return r;
}

/** Public, secret-free snapshot for GET /api/v1/arc. */
export async function arcState() {
  const c = cfg();
  const cl = clients();
  const r = c.vault || c.ledger ? await reads() : null;
  const s = st();
  return {
    network: { name: "Arc Testnet", chainId: ARC_CHAIN_ID, explorer: EXPLORER, rpc: c.rpc === DEFAULT_RPC ? DEFAULT_RPC : "custom (ARC_RPC_URL)" },
    mode: arcMode(),
    label: "Testnet only. Bounties settle in test USDC; the basket ledger is a paper proof log and holds no user funds.",
    studio: { webUrl: c.webUrl, status: c.studioStatus },
    contracts: { bountyVault: c.vault, basketLedger: c.ledger, source: c.addressSource, usdc: USDC, basketId: BASKET_ID },
    writer: cl.writer,
    keyConfigured: Boolean(c.key),
    reads: r && {
      vaultUsdc: r.vaultUsdc === null ? null : formatUnits(r.vaultUsdc, USDC_DECIMALS),
      totalEscrowed: r.escrowed === null ? null : formatUnits(r.escrowed, USDC_DECIMALS),
      basketLastSeq: r.lastSeq === null ? null : Number(r.lastSeq),
      ledgerLabel: r.label,
      writerIsSettler: r.isSettler,
      writerIsRecorder: r.isRecorder,
      errors: r.errors,
    },
    rebalancesSeen: s.rebalancesSeen,
    calls: s.calls.map((x) => ({ ...x, href: x.txHash ? arcTx(x.txHash) : null })),
  };
}

// ---------- status probe ----------
registerIntegration("arc", async (): Promise<IntegrationStatus> => {
  const checkedAt = new Date().toISOString();
  const c = cfg();
  const s = st();
  const base = { id: "arc" as const, name: "Circle Arc", checkedAt };
  const proof: IntegrationStatus["proof"] = [{ label: "Network", value: `Arc Testnet (chain ${ARC_CHAIN_ID}), settles in USDC`, href: EXPLORER }];
  if (c.webUrl) proof.push({ label: "Arc Studio project", value: c.webUrl, href: c.webUrl });
  if (c.vault) proof.push({ label: "BountyVault", value: c.vault, href: arcAddr(c.vault) });
  if (c.ledger) proof.push({ label: "BasketLedger (paper)", value: c.ledger, href: arcAddr(c.ledger) });
  const recent = s.calls.slice(0, 5).map((x) => ({
    label: `${x.kind === "settle" ? "Settle" : "Rebalance"}${x.sent ? (x.ok === false ? " · reverted" : "") : x.ok === false ? " · failed" : ""} · ${x.note ?? ""}`.trim(),
    value: x.txHash ?? x.label,
    ...(x.txHash ? { href: arcTx(x.txHash) } : {}),
  }));

  if (arcMode() === "simulated") {
    const why = c.keyMalformed
      ? "ARC_PRIVATE_KEY is malformed (expected 0x + 64 hex)"
      : !c.vault && !c.ledger
        ? "contracts not deployed yet (run arc/run-studio.sh, or set ARC_BOUNTY_VAULT_ADDRESS / ARC_BASKET_LEDGER_ADDRESS)"
        : "ARC_PRIVATE_KEY not set";
    return { ...base, mode: "simulated", detail: `Simulated: ${why}. Settlements and rebalances are logged as calls we would send, not sent.`, proof: [...proof, ...recent] };
  }

  const r = await reads();
  const cl = clients();
  if (cl.writer) proof.push({ label: "Backend wallet", value: mask(cl.writer), href: arcAddr(cl.writer) });
  if (r.vaultUsdc !== null) proof.push({ label: "Vault USDC", value: fmtUsdc(r.vaultUsdc) });
  if (r.lastSeq !== null) proof.push({ label: "Rebalances on Arc", value: `seq ${r.lastSeq}` });
  if (r.isSettler === false) proof.push({ label: "Settler role", value: "missing: owner must call setSettler(wallet, true)" });
  if (r.isRecorder === false) proof.push({ label: "Recorder role", value: "missing: owner must call setRecorder(wallet, true)" });
  for (const e of r.errors) proof.push({ label: "Read error", value: e });
  proof.push(...recent);
  const failedAll = r.errors.length > 0 && r.vaultUsdc === null && r.lastSeq === null;
  const sent = s.calls.filter((x) => x.sent).length;
  return {
    ...base,
    mode: failedAll ? "error" : "live",
    detail: failedAll
      ? `Arc reads failed (${r.errors[0]}).`
      : `Live on Arc Testnet: ${sent} tx sent this process${r.label ? `; ledger says "${r.label}"` : ""}${r.errors.length ? `; ${r.errors.length} read error(s)` : ""}.`,
    proof,
  };
});

// Live mode: settle bounty issues that were already complete before this process subscribed.
const gb = globalThis as unknown as { __oa_arc_boot?: boolean };
if (!gb.__oa_arc_boot && arcMode() === "live") {
  gb.__oa_arc_boot = true;
  setTimeout(() => {
    try {
      for (const call of settleableIssues()) st().pendingSettles.set(call.key, call);
      void pump();
    } catch {
      // surfaced via the status probe on the next event
    }
  }, 5_000).unref?.();
}
