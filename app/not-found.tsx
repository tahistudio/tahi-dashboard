import { NotFoundPanel } from '@/components/tahi/not-found-panel'

export const metadata = { title: 'Page not found - Tahi Dashboard' }

/**
 * Root 404. An unmatched URL renders here under the root layout only, so
 * there is no sidebar and no dashboard data fetching: the standalone variant
 * centres the panel on the page background instead.
 */
export default function NotFound() {
  return <NotFoundPanel standalone />
}
