// Agent sub-accounts: a separate wallet the user's agent controls.
//
// SECURITY MODEL
//   - The private key is generated in the browser and handed to the caller ONCE (createAgent's return value).
//   - It is never written to localStorage / sessionStorage / cookies / the URL, and it is not part of the store below.
//   - Only the PUBLIC address and a user label are persisted (localStorage, wrapped in try/catch with an in-memory fallback).
import { useSyncExternalStore } from 'react'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { isAddress } from 'viem'

export type Hex = `0x${string}`
export type SavedAgent = { address: Hex; label: string; createdAt: number }
type State = { agents: SavedAgent[]; persisted: boolean }

const STORAGE_KEY = 'arc.agents.v1'
export const MAX_AGENTS = 10
export const RPC_URL = 'https://rpc.testnet.arc.io'
export const CHAIN_ID = 5042002

function parse(raw: string | null): SavedAgent[] {
  if (!raw) return []
  try {
    const j: unknown = JSON.parse(raw)
    if (!Array.isArray(j)) return []
    const out: SavedAgent[] = []
    for (const x of j as unknown[]) {
      const o = x as Partial<SavedAgent> | null
      if (o && typeof o.address === 'string' && isAddress(o.address) && typeof o.label === 'string') {
        out.push({ address: o.address, label: o.label.slice(0, 32), createdAt: Number(o.createdAt) || 0 })
      }
    }
    return out.slice(0, MAX_AGENTS)
  } catch {
    return []
  }
}

function load(): State {
  try {
    return { agents: parse(window.localStorage.getItem(STORAGE_KEY)), persisted: true }
  } catch {
    return { agents: [], persisted: false }
  }
}

let state: State | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const snapshot = (): State => (state ??= load())

function commit(agents: SavedAgent[]) {
  let persisted = true
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(agents))
  } catch {
    persisted = false // private window / blocked storage: keep the list for this session only
  }
  state = { agents, persisted }
  emit()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) { state = load(); emit() }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

/** Saved agents (public address + label only). `persisted` is false when this browser blocked storage. */
export function useAgents(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * Generate a fresh agent wallet. The returned `privateKey` is the ONLY copy: show it once, then drop the reference.
 * Only the address and label are saved.
 */
export function createAgent(label: string): { agent: SavedAgent; privateKey: Hex } {
  const privateKey = generatePrivateKey()
  const address = privateKeyToAccount(privateKey).address
  const agent: SavedAgent = { address, label: label.trim().slice(0, 32) || 'Agent', createdAt: Date.now() }
  commit([agent, ...snapshot().agents].slice(0, MAX_AGENTS))
  return { agent, privateKey }
}

/** Forget the saved address. Never touches funds. */
export function removeAgent(address: Hex) {
  commit(snapshot().agents.filter((a) => a.address.toLowerCase() !== address.toLowerCase()))
}

/** Contents of the downloadable .env file. */
export const envFileText = (privateKey: Hex) =>
  `ARC_AGENT_PRIVATE_KEY=${privateKey}\nARC_RPC_URL=${RPC_URL}\nARC_CHAIN_ID=${CHAIN_ID}\n`

/** Save text as a file in the browser (Blob URL, revoked right after). */
export function downloadText(filename: string, text: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
