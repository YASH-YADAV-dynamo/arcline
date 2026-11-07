import { useListingsWatcher } from '@/lib/listings'

/** Render-null: mount once. Watches the AssetRegistry and auto-creates a ticket (toast + feed entry) for each new listing. */
export function ListingsWatcher() {
  useListingsWatcher()
  return null
}

export default ListingsWatcher
