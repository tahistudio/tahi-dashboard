import { redirect } from 'next/navigation'
import { requirePageManage } from '@/lib/page-guard'
import { getViewAudience } from '@/lib/view-audience'
import { TeamAccessPane } from '@/components/tahi/settings/team-access/pane'

export const metadata = { title: 'Permissions - Tahi Dashboard' }

// Admin+ only. Non-managers are redirected by the guard. Renders the same
// Team & access pane as Settings > Team & access - one permissions surface.
export default async function PermissionsPage() {
  // Studio-only surface. Client view (the tahi-impersonate-org cookie) leaves
  // it the same way a real client does, so a preview cannot show one client
  // the whole team roster. See lib/view-audience.ts.
  const { isAdmin, isPreviewingClient } = await getViewAudience()
  if (!isAdmin || isPreviewingClient) redirect('/overview')
  await requirePageManage()
  return (
    <div style={{ maxWidth: '68rem', margin: '0 auto', padding: '32px clamp(18px, 2.4vw, 30px) 72px' }}>
      <TeamAccessPane />
    </div>
  )
}
