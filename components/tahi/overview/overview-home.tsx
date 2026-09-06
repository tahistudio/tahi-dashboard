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
 * Note: a client only reaches /overview once the ONBOARDING FLOW is complete
 * (the dashboard layout redirects incomplete clients to /onboarding). That is a
 * different thing from the in-portal first-run checklist, which is the studio's
 * side of setup: welcome video, brand assets, first request, billing. So the
 * client home always asks for 'first', and <ClientFirstRun> reads
 * /api/portal/onboarding, which derives the knowable steps and returns
 * firstRunEligible, and renders nothing for an org that is not actually a new
 * client (ship readiness audit, Tier 1 item 19).
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
    previewIsReadOnly,
  } = useImpersonation()

  const go = useCallback(
    (id: string) => {
      const path = ROUTE_MAP[id] ?? '/' + id.replace(/^\/+/, '')
      router.push(path)
    },
    [router],
  )

  // Client portal session (not the Tahi admin org). 'first' opts the checklist
  // in; GET /api/portal/onboarding decides whether it paints. That route
  // derives the knowable steps rather than trusting the onboardingState blob
  // (every import path seeds it '{}') and returns firstRunEligible: false for
  // an org with delivered work or more than a month of history, so an
  // established client is never greeted as a new one.
  if (!isAdmin) {
    const ctx: OverviewCtx = {
      audience: 'client',
      isReadOnly: false,
      go,
      home: 'first',
      userName,
      orgName,
    }
    return <ClientHome ctx={ctx} />
  }

  // Admin session previewing a client ("View as client"). Same checklist. In
  // the read-only mode every control is disabled, because the portal writes
  // underneath answer 403. In Act as client they are live, because those same
  // routes now accept the write and attribute it to the operator. Money is the
  // exception in BOTH modes: the studio does not reach a client's payment page.
  if (isImpersonatingClient) {
    const ctx: OverviewCtx = {
      audience: 'client',
      isReadOnly: previewIsReadOnly,
      isMoneyReadOnly: true,
      previewName: impersonatedOrgName ?? orgName,
      go,
      home: 'first',
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
