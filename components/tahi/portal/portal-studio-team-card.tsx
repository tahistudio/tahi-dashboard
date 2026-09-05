'use client'

/**
 * PortalStudioTeamCard - the honest replacement for the empty People card on a
 * client's request detail.
 *
 * GET /api/portal/requests/[id] returns { request, messages } and nothing else:
 * no participants. The shared PeoplePanel read that missing key as an answer
 * and printed "No PM assigned", "No assignees yet" and "No followers yet" on a
 * request that demonstrably has a PM, one click after the list showed the
 * client those very avatars. That is a lie, not an empty state.
 *
 * Until the portal detail route returns participants, the client's rail says
 * what the portal CAN answer for: GET /api/portal/team, the studio people
 * actually assigned to this org's work. It is honest about its scope in the
 * copy ("on your account", not "on this request"), it holds a skeleton while
 * the read is in flight, and it renders nothing at all rather than an empty
 * card when the org has nobody assigned yet.
 *
 * Studio-only fields never reach here: /api/portal/team returns name, role and
 * avatar for team members already visible to the client, and no more.
 */

import { useState } from 'react'
import { Users } from 'lucide-react'
import { SidebarCard } from '@/components/tahi/rail/sidebar-card'
import { useResource } from '@/lib/use-resource'
import './home/portal-home.css'

interface PortalTeamItem {
  id: string
  name: string
  role: string
  avatarUrl: string | null
}
interface PortalTeamResp {
  items: PortalTeamItem[]
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** A remote avatar that falls back to initials when the URL will not load,
 *  rather than leaving a broken image frame in the rail. */
function TeamAvatar({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  const [failed, setFailed] = useState(false)
  return (
    <span className="pfh-team-av" aria-hidden="true">
      {avatarUrl && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        initials(name)
      )}
    </span>
  )
}

export function PortalStudioTeamCard() {
  const { data, isLoading, error } = useResource<PortalTeamResp>('/api/portal/team')
  const team = data?.items ?? []

  // Never an empty-state claim while the read is in flight (TASKS CT.3b).
  if (isLoading) {
    return (
      <SidebarCard title="Your team" icon={<Users size={14} />}>
        <div className="pfh-team-rows" aria-busy="true">
          {[0, 1].map(i => (
            <div className="pfh-team-row" key={i}>
              <span className="pfh-team-av tahi-shimmer" aria-hidden="true" />
              <span
                className="tahi-shimmer"
                style={{ height: '0.6875rem', width: i === 0 ? '7rem' : '5.5rem', borderRadius: '0.25rem' }}
              />
            </div>
          ))}
          <span className="sr-only">Loading your team</span>
        </div>
      </SidebarCard>
    )
  }

  // A failed read or an org with nobody assigned gets no card, rather than a
  // card that says nobody is on their work when the truth is unknown.
  if (error || team.length === 0) return null

  return (
    <SidebarCard title="Your team" icon={<Users size={14} />}>
      <div className="pfh-team-rows">
        {team.map(m => (
          <div className="pfh-team-row" key={m.id}>
            <TeamAvatar name={m.name} avatarUrl={m.avatarUrl} />
            <span className="pfh-team-t">
              <b data-private>{m.name}</b>
              <small>{m.role}</small>
            </span>
          </div>
        ))}
      </div>
      <p
        style={{
          margin: '0.625rem 0 0',
          fontSize: '0.71875rem',
          lineHeight: 1.5,
          color: 'var(--color-text-subtle)',
        }}
      >
        The Tahi people on your account. Ask them anything in the thread on this request.
      </p>
    </SidebarCard>
  )
}
