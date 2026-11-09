import { useLiveFeed } from '@/lib/live'

/** Render-null: mount once. Opens the app's one WebSocket to Arc (blocks + registry events). */
export function LiveFeed() {
  useLiveFeed()
  return null
}
