'use client'

/**
 * Who owns each account.
 *
 * The clients list endpoint does not carry an owner, but the repo already has
 * one definition of the word and it is reachable without touching a route:
 * GET /api/admin/clients/[id]/pm resolves the owner as the team member holding
 * a `project_manager` access rule linked to that client. Asking it once per
 * row would be one request per client, so this reads the same fact the other
 * way round: the roster once, then each member's access rules once, and turns
 * the org links inside out into an orgId -> owner map.
 *
 * The studio is two people today, so that is three small reads, cached for the
 * session and never revalidated on focus. The follow-up that deletes this file
 * is putting `pmId` on GET /api/admin/clients; until then the fan-out is
 * bounded and read-only.
 *
 * A failure is reported rather than swallowed. An empty map and an unreadable
 * map look identical, and rendering "Unassigned" for a client that does have an
 * owner is the same class of lie as printing "Not set" over a real figure.
 */

import useSWR from 'swr'
import { apiPath } from '@/lib/api'
import { mapLimit } from '@/lib/concurrency'
import type { ClientOwner } from './clients-views'

interface TeamRosterRow {
  id?: string | null
  name?: string | null
}

interface AccessRuleRow {
  role?: string | null
  orgIds?: string[] | null
}

export interface ClientOwnerIndex {
  /** orgId -> the team member who holds it. */
  byOrg: ReadonlyMap<string, ClientOwner>
  /** Every member holding at least one client, by name, for the rail. */
  owners: readonly ClientOwner[]
  /** False while the read is in flight or after it failed, so a cell can say
   *  "Unknown" instead of asserting that nobody owns the account. */
  known: boolean
}

const EMPTY: ClientOwnerIndex = { byOrg: new Map(), owners: [], known: false }

/** At most this many access reads in flight at once. */
const FAN_OUT = 4

async function readOwners(): Promise<ClientOwnerIndex> {
  const rosterRes = await fetch(apiPath('/api/admin/team'))
  if (!rosterRes.ok) throw new Error('Failed to load the team roster')
  const roster = ((await rosterRes.json()) as { items?: TeamRosterRow[] }).items ?? []

  const members = roster
    .filter((m): m is { id: string; name?: string | null } => typeof m.id === 'string' && m.id.length > 0)
    .map(m => ({ id: m.id, name: (m.name ?? '').trim() || 'Unnamed teammate' }))

  const links = await mapLimit(members, FAN_OUT, async member => {
    const res = await fetch(apiPath(`/api/admin/team/${member.id}/access`))
    if (!res.ok) return { member, orgIds: [] as string[] }
    const rules = ((await res.json()) as { rules?: AccessRuleRow[] }).rules ?? []
    const orgIds = rules
      .filter(rule => rule.role === 'project_manager')
      .flatMap(rule => rule.orgIds ?? [])
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
    return { member, orgIds }
  })

  const byOrg = new Map<string, ClientOwner>()
  const owners: ClientOwner[] = []
  for (const { member, orgIds } of links) {
    if (orgIds.length === 0) continue
    owners.push(member)
    // First rule wins, which is the same row /api/admin/clients/[id]/pm would
    // return for a client two people somehow both claim.
    for (const orgId of orgIds) if (!byOrg.has(orgId)) byOrg.set(orgId, member)
  }
  owners.sort((a, b) => a.name.localeCompare(b.name))

  return { byOrg, owners, known: true }
}

/**
 * The owner index, or the empty one while it is loading or after it failed.
 * Never throws, never blocks the list: the page renders without owners and the
 * cells say so.
 */
export function useClientOwners(enabled = true): ClientOwnerIndex {
  const { data } = useSWR<ClientOwnerIndex>(
    enabled ? 'admin/clients/owner-index' : null,
    readOwners,
    { revalidateOnFocus: false, revalidateIfStale: false, shouldRetryOnError: false },
  )
  return data ?? EMPTY
}
