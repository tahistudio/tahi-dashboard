import { NotFoundPanel } from '@/components/tahi/not-found-panel'

export const metadata = { title: 'Page not found - Tahi Dashboard' }

/**
 * Dashboard 404. Catches notFound() thrown from inside the group (e.g. a
 * detail page whose record is gone, or /sitemap for a caller who is not
 * allowlisted) so it lands inside the shell, with the sidebar and top nav
 * still there to leave by.
 *
 * That shell is the point, and it is also the dependency: this boundary
 * renders INSIDE app/(dashboard)/layout.tsx, so a layout that throws takes the
 * branded 404 with it. Two things hold that down. The layout's reads all
 * fail-soft (permissions, portal branding and the client's billing currency
 * are each try/caught and degrade to a default rather than throwing), and an
 * unmatched url never reaches this file at all: it renders app/not-found.tsx,
 * which sits above the group and fetches nothing. A branded 404 is therefore
 * still served when the dashboard shell cannot be built.
 */
export default function DashboardNotFound() {
  return <NotFoundPanel />
}
