'use client'

/**
 * TeamAccessSection - the real Team & access pane, folded into Settings.
 *
 * Rather than linking out to /permissions, this surfaces the built permissions
 * system inline. It composes the existing PermissionsBuilder from the
 * /permissions page wholesale (its own three-tab master-detail of team members,
 * clients, and roles, plus the per-feature Inherit/Allow/Deny slide-over), so
 * there is one source of truth and no reinvented logic. On top of that it adds:
 *   - a glanceable summary (headcounts) in the settings visual language, and
 *   - a link out to the team roster (/team) for add / edit / offboard.
 *
 * Honest scope note: preview-as, copy-access between members, and change
 * history are not built yet anywhere. They are called out as a "Later phase"
 * card rather than faked. When those ship, extend here.
 *
 * Admin-only surface. The settings shell only mounts this for admins; the
 * isAdmin prop lets a non-admin skip the summary fetch instead of spinning.
 */

import Link from 'next/link'
import { Shield, Users, ArrowRight, Eye, Copy, History } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Chip } from '@/components/tahi/settings/primitives'
import { PermissionsBuilder } from '@/app/(dashboard)/permissions/permissions-content'

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

// The advanced surfaces that do not exist yet. Listed honestly so the pane
// never implies they work; remove an entry once it is genuinely built.
const NOT_YET_BUILT: { icon: typeof Eye; label: string; blurb: string }[] = [
  {
    icon: Eye,
    label: 'Preview as',
    blurb: 'See the dashboard exactly as a given member or client would.',
  },
  {
    icon: Copy,
    label: 'Copy access',
    blurb: "Clone one member's role and overrides onto another.",
  },
  {
    icon: History,
    label: 'Change history',
    blurb: 'An audit trail of who changed which permission, and when.',
  },
]

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
      lede="Who is on the team and what each person can see. Access is deny-by-default: members see nothing until a role or rule grants it. Assign roles and per-feature Allow/Deny overrides below."
      action={
        <Link className="btn2" href="/team">
          <Users size={15} />
          Team roster
          <ArrowRight size={15} />
        </Link>
      }
    >
      {/* Glanceable headcounts, in the settings visual language. */}
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

      {/* The real builder, composed wholesale from the /permissions page:
          team / clients / roles master-detail + the Inherit/Allow/Deny panel. */}
      <div style={{ marginTop: 20 }}>
        <PermissionsBuilder />
      </div>

      {/* Honest placeholder: advanced surfaces that are not built yet. */}
      <div className="set-card" style={{ marginTop: 20 }}>
        <div className="set-row" style={{ alignItems: 'flex-start' }}>
          <span className="lrow-ic leaf">
            <Eye size={18} />
          </span>
          <div className="sr-t">
            <b style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Coming later
              <Chip tone="neutral">Later phase</Chip>
            </b>
            <small>
              These are not built yet, so nothing here is live. They will slot in
              alongside the builder above once ready.
            </small>
          </div>
        </div>
        {NOT_YET_BUILT.map((f) => {
          const Icon = f.icon
          return (
            <div key={f.label} className="set-row">
              <span className="lrow-ic">
                <Icon size={16} />
              </span>
              <div className="sr-t">
                <b>{f.label}</b>
                <small>{f.blurb}</small>
              </div>
              <Chip tone="neutral">Not built</Chip>
            </div>
          )
        })}
      </div>
    </SectionShell>
  )
}
