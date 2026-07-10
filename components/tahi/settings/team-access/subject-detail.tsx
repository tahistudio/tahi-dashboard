'use client'

/**
 * SubjectDetail - the right-hand card of the Team & access master-detail.
 *
 * Team members get: role select (assign-role), data scope (the real
 * teamMemberAccess rule via /api/admin/team/[id]/access), feature-override
 * summary, and a change-history teaser. Clients get the override summary and
 * teaser only (their access IS the client-safe defaults minus overrides).
 *
 * Admin-level members (super_admin / admin / no role) always see every client,
 * so the scope control renders as a locked "All clients" statement for them -
 * anything else would lie about what the server enforces.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import {
  ArrowLeft,
  Copy,
  Eye,
  MoreVertical,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react'
import { getFeatureNode } from '@/lib/feature-tree'
import { SlideSeg, TaSelect } from '@/components/tahi/settings/primitives'
import { overridesKey, type OverrideSubject } from './feature-slideover'
import {
  RoleChip,
  SubjAvatar,
  humaniseAudit,
  humanisePlan,
  humaniseRole,
  formatWhen,
  permissionTeaserKey,
  SCOPED_ROLES,
  type AuditItem,
  type MemberScope,
  type Override,
  type RoleSummary,
  type SubjectContact,
  type SubjectMember,
  type SubjectOrg,
} from './shared'

// ── Role select (the design .ta-select with role chips + descriptions) ────────

function RoleSelect({
  roles,
  value,
  onChange,
}: {
  roles: RoleSummary[]
  value: string | null // roleId
  onChange: (roleId: string | null) => void
}) {
  const current = roles.find((r) => r.id === value) ?? null
  return (
    <TaSelect
      value={value}
      ariaLabel="Role"
      display={
        current ? (
          <RoleChip roleName={current.name} />
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>No role (full admin)</span>
        )
      }
      opts={[
        {
          value: null,
          title: 'No role (full admin)',
          desc: 'Tahi default - unrestricted until a role scopes them',
        },
        ...roles.map((r) => ({
          value: r.id,
          title: <RoleChip roleName={r.name} />,
          desc: r.description ?? humaniseRole(r.name),
        })),
      ]}
      onChange={onChange}
    />
  )
}

// ── Data scope control ────────────────────────────────────────────────────────

const SCOPE_SEG = [
  { v: 'all_clients', label: 'All clients' },
  { v: 'plan_type', label: 'By plan' },
  { v: 'specific_clients', label: 'Specific clients' },
]

function ScopeControl({
  member,
  orgs,
  onSave,
}: {
  member: SubjectMember
  orgs: SubjectOrg[]
  onSave: (scope: { scopeType: string; planType: string | null; orgIds: string[] }) => void
}) {
  const scope = member.scope
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const f = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false)
    }
    if (addOpen) document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [addOpen])

  const total = orgs.length
  const planOptions = useMemo(() => {
    const set = new Set<string>()
    for (const o of orgs) {
      if (o.planType && o.planType !== 'none') set.add(o.planType)
    }
    return [...set].sort()
  }, [orgs])

  const scopeType = scope?.scopeType ?? null
  const orgIds = scope?.orgIds ?? []
  const planType = scope?.planType ?? null

  const count =
    scopeType === 'all_clients' || scopeType === null
      ? total
      : scopeType === 'plan_type'
        ? orgs.filter((o) => o.planType === planType).length
        : orgIds.length

  const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? 'Unknown client'
  const available = orgs.filter((o) => !orgIds.includes(o.id))

  return (
    <div>
      <SlideSeg
        ariaLabel="Data scope"
        value={scopeType ?? ''}
        onChange={(v) =>
          onSave({
            scopeType: v,
            planType: v === 'plan_type' ? planType ?? planOptions[0] ?? null : null,
            orgIds: v === 'specific_clients' ? orgIds : [],
          })
        }
        opts={SCOPE_SEG}
      />
      {scopeType === 'plan_type' && (
        <div className="ta-scope-reveal">
          {planOptions.map((p) => {
            const on = planType === p
            return (
              <button
                key={p}
                type="button"
                className={on ? 'ta-multichip' : 'ta-addchip'}
                onClick={() => onSave({ scopeType: 'plan_type', planType: p, orgIds: [] })}
              >
                {humanisePlan(p)}
                {on && (
                  <span aria-hidden="true">
                    <X size={13} />
                  </span>
                )}
              </button>
            )
          })}
          {planOptions.length === 0 && (
            <span className="ta-empty-note" style={{ margin: 0 }}>
              No client has a plan set yet.
            </span>
          )}
        </div>
      )}
      {scopeType === 'specific_clients' && (
        <div className="ta-scope-reveal" ref={addRef} style={{ position: 'relative' }}>
          {orgIds.map((id) => (
            <span key={id} className="ta-multichip">
              {orgName(id)}
              <button
                type="button"
                onClick={() =>
                  onSave({ scopeType: 'specific_clients', planType: null, orgIds: orgIds.filter((x) => x !== id) })
                }
                aria-label={'Remove ' + orgName(id)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
          <button type="button" className="ta-addchip" onClick={() => setAddOpen((o) => !o)}>
            + Add client
          </button>
          {addOpen && (
            <div className="ta-select-menu" style={{ left: 'auto', right: 0, minWidth: 200 }}>
              {available.length ? (
                available.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className="ta-select-opt"
                    onClick={() => {
                      onSave({ scopeType: 'specific_clients', planType: null, orgIds: [...orgIds, o.id] })
                      setAddOpen(false)
                    }}
                  >
                    <b>{o.name}</b>
                  </button>
                ))
              ) : (
                <div style={{ padding: '10px 11px', color: 'var(--text-faint)', font: '500 12.5px Manrope' }}>
                  All added
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="ta-scope-count" aria-live="polite">
        {scopeType === null
          ? 'No scope rule yet - this teammate sees no clients until you pick one.'
          : scopeType === 'all_clients'
            ? 'Will see all clients'
            : 'Will see ' + count + ' of ' + total + ' clients'}
      </div>
      {(scopeType === null || (count === 0 && scopeType !== 'all_clients')) && (
        <div className="ta-warn" role="status">
          <span className="wic">
            <TriangleAlert size={16} aria-hidden="true" />
          </span>
          This teammate will see no clients.
        </div>
      )}
    </div>
  )
}

// ── Detail card ───────────────────────────────────────────────────────────────

export function SubjectDetail({
  tab,
  member,
  org,
  roles,
  orgs,
  onBack,
  onAssignRole,
  onSaveScope,
  onConfigure,
  onPreview,
  onCopy,
  onHistory,
}: {
  tab: 'team' | 'clients'
  member: SubjectMember | null
  org: SubjectOrg | null
  roles: RoleSummary[]
  orgs: SubjectOrg[]
  onBack: () => void
  onAssignRole: (member: SubjectMember, roleId: string | null) => void
  onSaveScope: (member: SubjectMember, scope: { scopeType: string; planType: string | null; orgIds: string[] }) => void
  onConfigure: () => void
  onPreview: () => void
  onCopy: () => void
  onHistory: () => void
}) {
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const f = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false)
    }
    if (menu) document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [menu])

  const isClient = tab === 'clients'
  const name = isClient ? org?.name ?? '' : member?.name ?? ''
  const subjectId = isClient ? org?.id ?? '' : member?.id ?? ''

  const subject: OverrideSubject = useMemo(
    () => ({
      type: isClient ? 'organisation' : 'team_member',
      id: subjectId,
      name,
      audience: isClient ? 'client' : 'team',
    }),
    [isClient, subjectId, name],
  )

  // Override summary for the card (same cache key the slide-over uses).
  const { data: ovData } = useSWR<{ overrides: Override[] }>(subjectId ? overridesKey(subject) : null)
  const overrides = ovData?.overrides ?? []

  // Per-subject change-history teaser (the pane revalidates this key after
  // every role / scope / override change so the teaser reflects it live).
  const teaserKey =
    subjectId && subject.type !== 'role' ? permissionTeaserKey(subject.type, subjectId) : null
  const { data: teaserData } = useSWR<{ items: AuditItem[] }>(teaserKey)
  const teaser = (teaserData?.items ?? []).slice(0, 2)

  if (!member && !org) return null

  const roleName = member?.roles[0]?.roleName ?? null
  const roleId = member?.roles[0]?.roleId ?? null
  const scoped = !!roleName && SCOPED_ROLES.has(roleName)
  const firstName = name.split(' ')[0]

  return (
    <div className="ta-detail">
      <button type="button" className="btn2 mb-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </button>
      <div className="ta-idhead">
        <div className="ih-top">
          <SubjAvatar name={name} size={40} />
          <div className="ih-top-r">
            {isClient ? (
              <span className="chip neutral">{humanisePlan(org?.planType)}</span>
            ) : (
              <RoleChip roleName={roleName} />
            )}
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button type="button" className="ta-icobtn" onClick={() => setMenu((m) => !m)} aria-label="More actions">
                <MoreVertical size={18} aria-hidden="true" />
              </button>
              {menu && (
                <div className="ta-select-menu" style={{ left: 'auto', right: 0, minWidth: 220 }}>
                  <button
                    type="button"
                    className="ta-select-opt"
                    onClick={() => {
                      setMenu(false)
                      onPreview()
                    }}
                  >
                    <b>
                      <Eye size={15} aria-hidden="true" /> {isClient ? 'View portal as ' + firstName : 'Preview as ' + firstName}
                    </b>
                  </button>
                  <button
                    type="button"
                    className="ta-select-opt"
                    onClick={() => {
                      setMenu(false)
                      onCopy()
                    }}
                  >
                    <b>
                      <Copy size={15} aria-hidden="true" /> Copy access from...
                    </b>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="ih-t">
          <div className="ih-name">
            <b>{name}</b>
          </div>
          <span className="ih-sub">{isClient ? 'Client portal access' : member?.email}</span>
        </div>
      </div>
      <div className="ta-rule" />

      {!isClient && member && (
        <div className="ta-block">
          <span className="led">Role</span>
          <RoleSelect roles={roles} value={roleId} onChange={(rid) => onAssignRole(member, rid)} />
        </div>
      )}

      {!isClient && member && (
        <div className="ta-block">
          <span className="led">Data scope</span>
          {scoped ? (
            <ScopeControl member={member} orgs={orgs} onSave={(s) => onSaveScope(member, s)} />
          ) : (
            <p className="ta-empty-note" style={{ marginBottom: 0 }}>
              {roleName ? humaniseRole(roleName) : 'Full admin'} access - sees all clients. Assign a scoped role
              (Project manager, Task handler, or Viewer) to limit which clients they see.
            </p>
          )}
        </div>
      )}

      <div className="ta-block">
        <span className="led">
          Feature overrides
          {overrides.length > 0 && <span className="cbadge">{overrides.length}</span>}
        </span>
        {overrides.length === 0 ? (
          <p className="ta-empty-note">
            {isClient
              ? 'No overrides - inherits the client-safe defaults.'
              : 'No overrides - inherits the ' + (roleName ? humaniseRole(roleName) : 'full admin') + ' defaults.'}
          </p>
        ) : (
          <>
            {overrides.slice(0, 3).map((o) => (
              <div key={o.featureKey} className="ta-ovr">
                <b>{getFeatureNode(o.featureKey)?.label ?? o.featureKey}</b>
                <span className={'st ' + (o.effect === 'deny' ? 'deny' : 'allow')}>
                  - {o.effect === 'deny' ? 'denied' : 'allowed'}
                </span>
              </div>
            ))}
            {overrides.length > 3 && <div className="ta-ovr-more">+{overrides.length - 3} more</div>}
          </>
        )}
        <button type="button" className="btn2" style={{ marginTop: 12 }} onClick={onConfigure}>
          <SlidersHorizontal size={15} aria-hidden="true" />
          Configure features
        </button>
      </div>

      <div className="ta-block">
        <span className="led">Change history</span>
        <button type="button" className="btn-ghost" style={{ float: 'right', marginTop: -22 }} onClick={onHistory}>
          View all
        </button>
        <div className="ta-teaser">
          {teaser.map((h) => {
            const who = h.actorName?.split(' ')[0] ?? 'System'
            return (
              <div key={h.id} className="ta-teaser-row">
                <span className="tt-when">{formatWhen(h.createdAt).split(',')[0]}</span>
                <span className="tt-txt">
                  <b>{who}</b> - {humaniseAudit(h)}
                </span>
              </div>
            )
          })}
          {teaser.length === 0 && (
            <div className="ta-teaser-row">
              <span className="tt-txt" style={{ color: 'var(--text-faint)' }}>
                No changes yet.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Contact (person within a client org) detail ───────────────────────────────

const PORTAL_ROLE_SEG = [
  { v: 'admin', label: 'Admin' },
  { v: 'member', label: 'Member' },
]

export function ContactDetail({
  contact,
  orgName,
  onBack,
  onSetPortalRole,
  onConfigure,
  onHistory,
}: {
  contact: SubjectContact
  orgName: string
  onBack: () => void
  onSetPortalRole: (role: 'admin' | 'member') => void
  onConfigure: () => void
  onHistory: () => void
}) {
  const subject: OverrideSubject = useMemo(
    () => ({ type: 'contact', id: contact.id, name: contact.name, audience: 'client' }),
    [contact.id, contact.name],
  )

  const { data: ovData } = useSWR<{ overrides: Override[] }>(overridesKey(subject))
  const overrides = ovData?.overrides ?? []

  const { data: teaserData } = useSWR<{ items: AuditItem[] }>(permissionTeaserKey('contact', contact.id))
  const teaser = (teaserData?.items ?? []).slice(0, 2)

  return (
    <div className="ta-detail">
      <button type="button" className="btn2 mb-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </button>
      <div className="ta-idhead">
        <div className="ih-top">
          <SubjAvatar name={contact.name} size={40} />
          <div className="ih-top-r">
            <span className={'chip ' + (contact.portalRole === 'admin' ? 'brand' : 'neutral')}>
              {contact.portalRole === 'admin' ? 'Admin' : 'Member'}
            </span>
            {contact.pending && <span className="chip outline">Pending</span>}
          </div>
        </div>
        <div className="ih-t">
          <div className="ih-name">
            <b>{contact.name}</b>
          </div>
          <span className="ih-sub">
            {contact.email}
            {orgName ? ' - ' + orgName : ''}
          </span>
        </div>
      </div>
      <div className="ta-rule" />

      <div className="ta-block">
        <span className="led">Portal role</span>
        <SlideSeg
          ariaLabel="Portal role"
          value={contact.portalRole === 'admin' ? 'admin' : 'member'}
          onChange={(v) => onSetPortalRole(v === 'admin' ? 'admin' : 'member')}
          opts={PORTAL_ROLE_SEG}
        />
        <p className="ta-empty-note" style={{ marginTop: 10, marginBottom: 0 }}>
          {contact.portalRole === 'admin'
            ? 'Administers the portal for their org - manages people and sees billing.'
            : 'Sees their own scoped portal view only.'}
        </p>
      </div>

      <div className="ta-block">
        <span className="led">
          Feature overrides
          {overrides.length > 0 && <span className="cbadge">{overrides.length}</span>}
        </span>
        {overrides.length === 0 ? (
          <p className="ta-empty-note">No overrides - inherits {orgName || 'the org'}&apos;s client access.</p>
        ) : (
          <>
            {overrides.slice(0, 3).map((o) => (
              <div key={o.featureKey} className="ta-ovr">
                <b>{getFeatureNode(o.featureKey)?.label ?? o.featureKey}</b>
                <span className={'st ' + (o.effect === 'deny' ? 'deny' : 'allow')}>
                  - {o.effect === 'deny' ? 'denied' : 'allowed'}
                </span>
              </div>
            ))}
            {overrides.length > 3 && <div className="ta-ovr-more">+{overrides.length - 3} more</div>}
          </>
        )}
        <button type="button" className="btn2" style={{ marginTop: 12 }} onClick={onConfigure}>
          <SlidersHorizontal size={15} aria-hidden="true" />
          Configure features
        </button>
      </div>

      <div className="ta-block">
        <span className="led">Change history</span>
        <button type="button" className="btn-ghost" style={{ float: 'right', marginTop: -22 }} onClick={onHistory}>
          View all
        </button>
        <div className="ta-teaser">
          {teaser.map((h) => {
            const who = h.actorName?.split(' ')[0] ?? 'System'
            return (
              <div key={h.id} className="ta-teaser-row">
                <span className="tt-when">{formatWhen(h.createdAt).split(',')[0]}</span>
                <span className="tt-txt">
                  <b>{who}</b> - {humaniseAudit(h)}
                </span>
              </div>
            )
          })}
          {teaser.length === 0 && (
            <div className="ta-teaser-row">
              <span className="tt-txt" style={{ color: 'var(--text-faint)' }}>
                No changes yet.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Re-export for the pane's list line ("Sees N clients").
export function scopeLine(member: SubjectMember, totalOrgs: number, orgs: SubjectOrg[]): string {
  const roleName = member.roles[0]?.roleName ?? null
  if (!roleName || !SCOPED_ROLES.has(roleName)) return 'Sees all clients'
  const scope: MemberScope | null = member.scope
  if (!scope) return 'Sees no clients'
  if (scope.scopeType === 'all_clients') return 'Sees all clients'
  if (scope.scopeType === 'plan_type') {
    const n = orgs.filter((o) => o.planType === scope.planType).length
    return n ? 'Sees ' + n + ' of ' + totalOrgs + ' clients' : 'Sees no clients'
  }
  const n = scope.orgIds.length
  return n ? 'Sees ' + n + ' client' + (n === 1 ? '' : 's') : 'Sees no clients'
}
