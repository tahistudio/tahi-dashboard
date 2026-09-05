import { NotFoundPanel } from '@/components/tahi/not-found-panel'

export const metadata = { title: 'Page not found - Tahi Dashboard' }

/**
 * Dashboard 404. Catches notFound() thrown from inside the group (e.g. a
 * detail page whose record is gone, or /sitemap for a caller who is not
 * allowlisted) so it lands inside the shell, with the sidebar and top nav
 * still there to leave by.
 */
export default function DashboardNotFound() {
  return <NotFoundPanel />
}
