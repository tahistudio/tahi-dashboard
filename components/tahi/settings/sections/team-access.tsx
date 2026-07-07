'use client'

/**
 * TeamAccessSection - the settings entry point for who is on the team and what
 * they can see. This is deliberately a summary, not the full permissions
 * builder: it reads a light headcount from /api/admin/permissions/subjects
 * (team members, roles, client orgs) and points to the two pages that own the
 * real work - /permissions for the deny-by-default access rules and /team for
 * the roster itself.
 *
 * Deferred to a later phase (lives on /permissions, not here): the full roles
 * matrix, preview-as, copy-access between members, and the change history.
 *
 * Admin-only surface. Rendered inside the settings shell which already gates on
 * admin; the isAdmin prop lets a non-admin skip the fetch instead of sitting on
 * a spinner.
 */

import Link from 'next/link'
import { Shield, Users, ArrowRight } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Chip } from '@/components/tahi/settings/primitives'

interface SubjectRole {
  roleId: string
  roleName: string
}

interface SubjectMember {
  id: string
  name: string
  email: string
  roles: SubjectRole[]
}

interface SubjectsResponse {
  teamMembers: SubjectMember[]
  orgs: { id: string; name: string }[]
  roles: { id: string; name: string }[]
}

interface Stat {
  label: string
  value: number
  hint: string
}

export function TeamAccessSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  // Admin-only: non-admins skip the fetch and never sit on a spinner.
  const shouldFetch = isAdmin !== false
  const { data, isLoading } = useResource<SubjectsResponse>(
    shouldFetch ? '/api/admin/permissions/subjects' : null,
  )
  const loading = shouldFetch ? isLoading : false

  const members = data?.teamMembers ?? []
  const roles = data?.roles ?? []
  const orgs = data?.orgs ?? []
  const scoped = members.filter((m) => m.roles.length > 0).length

  const stats: Stat[] = [
    {
      label: 'Team members',
      value: members.length,
      hint: scoped + ' with a role assigned',
    },
    {
      label: 'Roles',
      value: roles.length,
      hint: 'Reusable access presets',
    },
    {
      label: 'Client orgs',
      value: orgs.length,
      hint: 'Scoped by access rules',
    },
  ]

  return (
    <SectionShell
      title="Team & access"
      lede="Who is on the team and what each person can see. Access is deny-by-default: members see nothing until a rule grants it."
    >
      <div className="card-grid2">
        {stats.map((s) => (
          <div key={s.label} className="set-card">
            <div className="set-row">
              <span className="lrow-ic leaf">
                <Shield size={18} />
              </span>
              <div className="sr-t">
                <b style={{ font: '600 22px Manrope', color: 'var(--text)' }}>
                  {loading ? '-' : s.value}
                </b>
                <small>
                  {s.label}
                  {!loading && s.hint ? ' - ' + s.hint : ''}
                </small>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="set-card" style={{ marginTop: 16 }}>
        <div className="set-row">
          <span className="lrow-ic leaf">
            <Shield size={18} />
          </span>
          <div className="sr-t">
            <b>Access rules</b>
            <small>Roles, client scoping, and per-feature visibility.</small>
          </div>
          <Link className="btn1" href="/permissions">
            Manage permissions
            <ArrowRight size={15} />
          </Link>
        </div>
        <div className="set-row">
          <span className="lrow-ic leaf">
            <Users size={18} />
          </span>
          <div className="sr-t">
            <b>Team roster</b>
            <small>Add, edit, and offboard team members.</small>
          </div>
          <Link className="btn2" href="/team">
            Manage team
            <ArrowRight size={15} />
          </Link>
        </div>
      </div>

      <div
        className="set-card"
        style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}
      >
        <Chip tone="neutral">Later phase</Chip>
        <small style={{ color: 'var(--text-faint)', font: '500 12.5px Manrope' }}>
          The full roles matrix, preview-as, copy access between members, and change history live on
          the permissions page and are still being built out.
        </small>
      </div>
    </SectionShell>
  )
}
