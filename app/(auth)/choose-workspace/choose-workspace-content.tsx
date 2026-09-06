'use client'

/**
 * The chooser itself. Reads the signed-in user's REAL organisation memberships
 * from Clerk and settles the session on one of them.
 *
 * The decision is not made here: it lives in lib/workspace-choice.ts as a pure
 * function so every branch is tested. This file only supplies the inputs
 * (active org, membership list, the studio org id) and performs the verdict.
 */

import * as React from 'react'
import { useAuth, useOrganizationList } from '@clerk/nextjs'
import { Loader2 } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import {
  resolveWorkspaceChoice,
  safeNextPath,
  type WorkspaceMembership,
} from '@/lib/workspace-choice'

/** How long we resolve quietly before offering a way out. */
const STRANDED_AFTER_MS = 6000

/** "org:admin" -> "Admin". Display only, never a permission. */
function roleLabel(role: string | null | undefined): string {
  if (!role) return 'Member'
  const bare = role.replace(/^org:/, '').replace(/[_-]+/g, ' ')
  return bare.charAt(0).toUpperCase() + bare.slice(1)
}

export function ChooseWorkspaceContent() {
  const { isLoaded: authLoaded, orgId } = useAuth()
  const { isLoaded: listLoaded, setActive, userMemberships } = useOrganizationList({
    userMemberships: { infinite: true },
  })

  const [choices, setChoices] = React.useState<WorkspaceMembership[] | null>(null)
  const [activating, setActivating] = React.useState<string | null>(null)
  const [stranded, setStranded] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  // A verdict is acted on exactly once: setActive triggers a re-render with a
  // fresh orgId, which would otherwise re-enter the effect mid-navigation.
  const settled = React.useRef(false)

  // The destination the middleware was carrying when it sent us here.
  const next = React.useMemo(() => {
    if (typeof window === 'undefined') return safeNextPath(null)
    return safeNextPath(new URLSearchParams(window.location.search).get('next'))
  }, [])

  React.useEffect(() => {
    const t = setTimeout(() => setStranded(true), STRANDED_AFTER_MS)
    return () => clearTimeout(t)
  }, [])

  // Clerk pages memberships; pull them all in before deciding, otherwise a
  // person with more than one page could be "activated" into an arbitrary org.
  React.useEffect(() => {
    if (!listLoaded || !userMemberships) return
    if (userMemberships.hasNextPage && !userMemberships.isFetching) {
      userMemberships.fetchNext?.()
    }
  }, [listLoaded, userMemberships])

  React.useEffect(() => {
    if (settled.current) return
    if (!authLoaded || !listLoaded || !userMemberships) return
    if (userMemberships.isLoading || userMemberships.isFetching || userMemberships.hasNextPage) return

    const memberships: WorkspaceMembership[] = (userMemberships.data ?? []).map(m => ({
      organizationId: m.organization.id,
      name: m.organization.name,
      role: m.role,
    }))

    const verdict = resolveWorkspaceChoice({
      activeOrgId: orgId,
      memberships,
      tahiOrgId: process.env.NEXT_PUBLIC_TAHI_ORG_ID ?? null,
    })

    if (verdict.action === 'pick') {
      setChoices(memberships)
      return
    }

    settled.current = true
    if (verdict.action === 'redirect') {
      window.location.assign(next)
      return
    }
    if (verdict.action === 'onboarding') {
      window.location.assign('/onboarding')
      return
    }

    // A full navigation, not a router push: the new session token has to reach
    // the edge middleware, which is what decides the audience.
    void (async () => {
      try {
        if (!setActive) throw new Error('Clerk not ready')
        await setActive({ organization: verdict.organizationId })
        window.location.assign(next)
      } catch {
        settled.current = false
        setFailed(true)
        setChoices(memberships)
      }
    })()
  }, [authLoaded, listLoaded, userMemberships, orgId, next, setActive])

  const pick = React.useCallback(
    async (organizationId: string) => {
      if (!setActive) return
      setActivating(organizationId)
      setFailed(false)
      try {
        await setActive({ organization: organizationId })
        window.location.assign(next)
      } catch {
        setActivating(null)
        setFailed(true)
      }
    },
    [setActive, next],
  )

  if (choices && choices.length > 0) {
    return (
      <div className="w-full">
        <h1
          className="text-[1.125rem] font-semibold text-[var(--color-text)]"
          style={{ letterSpacing: '-0.01em' }}
        >
          Choose a workspace
        </h1>
        <p className="mt-[0.375rem] text-[0.875rem] leading-[1.5] text-[var(--color-text-muted)]">
          You belong to more than one. Pick the one you want to open.
        </p>

        {failed ? (
          <p className="mt-[0.75rem] text-[0.8125rem] text-[var(--color-danger)]">
            That did not open. Try again, or pick another workspace.
          </p>
        ) : null}

        <ul className="mt-[1.25rem] flex flex-col gap-[0.5rem]">
          {choices.map(c => (
            <li key={c.organizationId}>
              <button
                type="button"
                onClick={() => pick(c.organizationId)}
                disabled={activating !== null}
                className="group flex w-full min-h-[2.75rem] items-center justify-between gap-[0.75rem] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] px-[0.875rem] py-[0.625rem] text-left transition-colors hover:bg-[var(--color-bg-secondary)] hover:border-[var(--color-border-strong)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[0.9375rem] font-medium text-[var(--color-text)]">
                    {c.name}
                  </span>
                  <span className="block text-[0.75rem] text-[var(--color-text-subtle)]">
                    {roleLabel(c.role)}
                  </span>
                </span>
                {activating === c.organizationId ? (
                  <Loader2 className="h-[1rem] w-[1rem] shrink-0 animate-spin text-[var(--color-brand)]" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-[1.25rem]">
          <TahiButton
            variant="link"
            size="sm"
            onClick={() => window.location.assign('/onboarding')}
          >
            None of these are mine
          </TahiButton>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col items-center justify-center gap-[0.75rem] py-[3rem] text-center">
      <Loader2 className="h-[1.5rem] w-[1.5rem] animate-spin text-[var(--color-brand)]" />
      <p className="text-[0.9375rem] font-medium text-[var(--color-text)]">
        Opening your workspace
      </p>
      <p className="text-[0.8125rem] text-[var(--color-text-muted)]">
        This usually takes a second.
      </p>
      {stranded ? (
        <TahiButton
          variant="link"
          size="sm"
          onClick={() => window.location.assign('/onboarding')}
        >
          Taking too long? Continue to onboarding
        </TahiButton>
      ) : null}
    </div>
  )
}
