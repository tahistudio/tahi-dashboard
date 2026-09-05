import { getServerAuth } from '@/lib/server-auth'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { requirePageFeature, requirePageAnyGrant } from '@/lib/page-guard'
import { AdminServicesContent } from './services-content'
import { PortalServices } from '@/components/tahi/portal/services/portal-services'

export const metadata = { title: 'Services - Tahi Dashboard' }

export default async function ServicesPage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')

  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  // 'services' is a client-audience feature, so gate the two branches by their
  // own audience: the client by the feature their org may be denied, the studio
  // side by holding any grant at all (a roleless team member sees nothing).
  if (isAdmin) await requirePageAnyGrant()
  else await requirePageFeature('services')

  // A Tahi login previewing the portal as a client (the impersonation cookie
  // makes the portal routes answer for that org) sees what the client sees:
  // the read-only catalogue, never the admin editor.
  const previewing = isAdmin && Boolean((await cookies()).get('tahi-impersonate-org')?.value)
  return isAdmin && !previewing ? <AdminServicesContent /> : <PortalServices preview={previewing} />
}
