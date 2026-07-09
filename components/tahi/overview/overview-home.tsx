'use client'

/**
 * OverviewHome - the role-aware home switcher.
 *
 * Picks the audience from the real resolved permission level and impersonation
 * state, maps the design's logical route ids to real dashboard paths, and
 * threads read-only (preview) state through the shared OverviewCtx. Each role
 * home (owner / teammate / client) is a self-contained component that reads its
 * own data and formats currency via useOvFormat().
 *
 *   super_admin / admin   -> OwnerHome
 *   team_member (scoped)  -> TeammateHome
 *   client portal session -> ClientHome
 *   impersonating client  -> ClientHome (read-only)
 *   impersonating teammate-> TeammateHome (read-only)
 *
 * Note: a client only reaches /overview once onboarding is complete (the
 * dashboard layout redirects incomplete clients to /onboarding), so the client
 * home runs in its steady state; the design's first-run welcome is retained in
 * ClientHome for completeness but does not trigger for a real completed client.
 */

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { usePermissions } from '@/components/tahi/permissions-context'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import type { OverviewCtx } from '@/components/tahi/overview/ctx'
import { OwnerHome } from '@/components/tahi/overview/homes/owner-home'
import { TeammateHome } from '@/components/tahi/overview/homes/teammate-home'
import { ClientHome } from '@/components/tahi/overview/homes/client-home'

// Design logical id -> real dashboard route. Anything not listed falls back to
// /<id>, which already matches most surfaces (requests, invoices, calls, ...).
const ROUTE_MAP: Record<string, string> = {
  financialreports: '/financial-reports',
  'financial-reports': '/financial-reports',
  content: '/content-studio',
  'content-studio': '/content-studio',
  salesanalytics: '/sales-analytics',
  'sales-analytics': '/sales-analytics',
  plan: '/billing',
  billing: '/billing',
  docs: '/docs',
}

export function OverviewHome({
  userName,
  orgName,
  isAdmin,
}: {
  userName: string
  orgName: string
  isAdmin: boolean
}) {
  const router = useRouter()
  const { level } = usePermissions()
  const {
    isImpersonatingClient,
    isImpersonatingTeamMember,
    impersonatedOrgName,
    impersonatedTeamMemberName,
  } = useImpersonation()

  const go = useCallback(
    (id: string) => {
      const path = ROUTE_MAP[id] ?? '/' + id.replace(/^\/+/, '')
      router.push(path)
    },
    [router],
  )

  // Client portal session (not the Tahi admin org).
  if (!isAdmin) {
    const ctx: OverviewCtx = {
      audience: 'client',
      isReadOnly: false,
      go,
      home: 'steady',
      userName,
      orgName,
    }
    return <ClientHome ctx={ctx} />
  }

  // Admin session previewing a client ("View as client").
  if (isImpersonatingClient) {
    const ctx: OverviewCtx = {
      audience: 'client',
      isReadOnly: true,
      previewName: impersonatedOrgName ?? orgName,
      go,
      home: 'steady',
      userName,
      orgName: impersonatedOrgName ?? orgName,
    }
    return <ClientHome ctx={ctx} />
  }

  // Admin session previewing a team member. Note: the member-scoped endpoints
  // still resolve to the signed-in admin's identity, so this shows the teammate
  // LAYOUT with the admin's own scoped data until the /me routes accept a
  // preview-member param (tracked follow-up).
  if (isImpersonatingTeamMember) {
    const ctx: OverviewCtx = {
      audience: 'teammate',
      isReadOnly: true,
      previewName: impersonatedTeamMemberName ?? userName,
      go,
      userName: impersonatedTeamMemberName ?? userName,
    }
    return <TeammateHome ctx={ctx} />
  }

  // Real audience by resolved permission level.
  if (level === 'team_member') {
    const ctx: OverviewCtx = {
      audience: 'teammate',
      isReadOnly: false,
      go,
      userName,
    }
    return <TeammateHome ctx={ctx} />
  }

  const ctx: OverviewCtx = {
    audience: 'owner',
    isReadOnly: false,
    go,
    userName,
    orgName,
  }
  return <OwnerHome ctx={ctx} />
}
