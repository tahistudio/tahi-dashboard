'use client'

/**
 * /permissions — the granular-permissions builder.
 *
 * The "admins can toggle everything for anyone" surface. Three audiences,
 * one builder:
 *   - Team members : assign a level role + per-feature allow/deny overrides
 *   - Clients      : per-feature allow/deny overrides (client-portal surfaces only)
 *   - Roles        : per-feature allow/deny overrides applied to everyone in the role
 *
 * Permission resolution lives server-side (lib/permissions). This screen only
 * writes intent: role assignments via /assign-role, and feature overrides via
 * /feature-visibility (effect 'inherit' clears an override back to the default
 * for that level). Everything is optimistic with a toast, reconciling on the
 * server response.
 *
 * Visual language matches the locked reference pages (docs, financial-reports):
 * PageHeader + Card + SlideOver + Badge + TahiButton, tokens only, no hardcoded
 * hex, dark-mode compatible.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Users, Building2, Shield, SlidersHorizontal, RefreshCw } from 'lucide-react'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import { SlideOver } from '@/components/tahi/slide-over'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { EmptyState } from '@/components/tahi/empty-state'
import { useToast } from '@/components/tahi/toast'
import { apiPath } from '@/lib/api'
import {
  FEATURE_TREE,
  featureChildren,
  type FeatureAudience,
  type FeatureNode,
} from '@/lib/feature-tree'

// ── Types (mirror the API contract) ──────────────────────────────────────────

interface RoleSummary {
  id: string
  name: string
  description: string | null
  isSystem: boolean | number
}

interface MemberRole {
  roleId: string
  roleName: string
}

interface TeamMember {
  id: string
  name: string
  email: string
  roles: MemberRole[]
}

interface OrgSummary {
  id: string
  name: string
}

interface SubjectsResponse {
  teamMembers: TeamMember[]
  orgs: OrgSummary[]
  roles: RoleSummary[]
}

type Effect = 'allow' | 'deny'

interface Override {
  id: string
  featureKey: string
  effect: Effect
  reason: string | null
  updatedAt: string
}

type SubjectType = 'team_member' | 'organisation' | 'role'
type TabKey = 'team' | 'clients' | 'roles'

interface PanelSubject {
  type: SubjectType
  id: string
  name: string
  /** Which feature audience to show for this subject. */
  audience: FeatureAudience
}

// The single "level role" choice. Sent as roleId (or null to clear).
type ThreeWay = 'inherit' | Effect

// ── Role label humanising ────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  project_manager: 'Project manager',
  task_handler: 'Task handler',
  viewer: 'Viewer',
}

function humaniseRole(name: string): string {
  if (ROLE_LABELS[name]) return ROLE_LABELS[name]
  // Fallback: snake/kebab to sentence case.
  const spaced = name.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function roleTone(name: string): BadgeTone {
  switch (name) {
    case 'super_admin': return 'purple'
    case 'admin': return 'brand'
    case 'project_manager': return 'info'
    case 'task_handler': return 'teal'
    case 'viewer': return 'neutral'
    default: return 'neutral'
  }
}

// Sentinel value for the "no role" option in the SearchableSelect, since the
// select speaks string | null but we want a distinct, selectable null entry.
const NO_ROLE = '__none__'

// ── Tabs config ──────────────────────────────────────────────────────────────

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'team', label: 'Team members', icon: <Users size={14} aria-hidden="true" /> },
  { key: 'clients', label: 'Clients', icon: <Building2 size={14} aria-hidden="true" /> },
  { key: 'roles', label: 'Roles', icon: <Shield size={14} aria-hidden="true" /> },
]

// ── Component ────────────────────────────────────────────────────────────────

export function PermissionsBuilder() {
  const { showToast } = useToast()

  const [data, setData] = useState<SubjectsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [tab, setTab] = useState<TabKey>('team')

  // The subject whose feature panel is open (null = panel closed).
  const [panelSubject, setPanelSubject] = useState<PanelSubject | null>(null)

  const fetchSubjects = useCallback(async () => {
    setLoading(true)
    setErrored(false)
    try {
      const res = await fetch(apiPath('/api/admin/permissions/subjects'))
      if (!res.ok) throw new Error('Failed')
      const json = (await res.json()) as SubjectsResponse
      setData({
        teamMembers: json.teamMembers ?? [],
        orgs: json.orgs ?? [],
        roles: json.roles ?? [],
      })
    } catch {
      setData(null)
      setErrored(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchSubjects()
  }, [fetchSubjects])

  // Assign (or clear) a member's level role. Optimistic: patch local state,
  // toast, and reconcile on the server response.
  const assignRole = useCallback(
    async (member: TeamMember, roleId: string | null) => {
      const roles = data?.roles ?? []
      const role = roleId ? roles.find(r => r.id === roleId) ?? null : null
      const label = role ? humaniseRole(role.name) : 'No role'

      // Optimistic local patch.
      setData(prev => {
        if (!prev) return prev
        return {
          ...prev,
          teamMembers: prev.teamMembers.map(m =>
            m.id === member.id
              ? { ...m, roles: role ? [{ roleId: role.id, roleName: role.name }] : [] }
              : m,
          ),
        }
      })

      try {
        const res = await fetch(apiPath('/api/admin/permissions/assign-role'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teamMemberId: member.id, roleId }),
        })
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(j?.error ?? 'Failed')
        }
        showToast(`${member.name} set to ${label}`, 'success')
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not update role'
        showToast(msg, 'error')
        // Revert by refetching authoritative state.
        void fetchSubjects()
      }
    },
    [data?.roles, fetchSubjects, showToast],
  )

  const openPanel = useCallback((subject: PanelSubject) => {
    setPanelSubject(subject)
  }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', paddingBottom: 'var(--space-8)' }}>
      <PageHeader
        title="Permissions"
        subtitle="Control exactly what each team member and client can see"
      >
        <TahiButton
          variant="secondary"
          size="sm"
          onClick={() => void fetchSubjects()}
          iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Refresh
        </TahiButton>
      </PageHeader>

      <Segmented value={tab} onChange={setTab} />

      {loading ? (
        <ListSkeleton />
      ) : errored ? (
        <Card padding="none">
          <EmptyState
            icon={<SlidersHorizontal className="w-6 h-6" />}
            title="Could not load permissions"
            description="Something went wrong fetching team members, clients, and roles. Try again."
            ctaLabel="Retry"
            onCtaClick={() => void fetchSubjects()}
          />
        </Card>
      ) : (
        <>
          {tab === 'team' && (
            <TeamTab
              members={data?.teamMembers ?? []}
              roles={data?.roles ?? []}
              onAssignRole={assignRole}
              onConfigure={openPanel}
            />
          )}
          {tab === 'clients' && (
            <ClientsTab orgs={data?.orgs ?? []} onConfigure={openPanel} />
          )}
          {tab === 'roles' && (
            <RolesTab roles={data?.roles ?? []} onConfigure={openPanel} />
          )}
        </>
      )}

      <FeaturePanel
        subject={panelSubject}
        onClose={() => setPanelSubject(null)}
      />
    </div>
  )
}

// ── Segmented control ────────────────────────────────────────────────────────

function Segmented({ value, onChange }: { value: TabKey; onChange: (v: TabKey) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Permission audience"
      className="h-scroll scrollbar-hide"
      style={{
        display: 'inline-flex',
        gap: 'var(--space-1)',
        padding: 'var(--space-1)',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        width: 'fit-content',
        maxWidth: '100%',
      }}
    >
      {TABS.map(t => {
        const active = t.key === value
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: '0 var(--space-3)',
              minHeight: '2.5rem',
              fontSize: 'var(--text-sm)',
              fontWeight: active ? 600 : 500,
              whiteSpace: 'nowrap',
              color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
              background: active ? 'var(--color-bg)' : 'transparent',
              border: active ? '1px solid var(--color-border)' : '1px solid transparent',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
              transition: 'background 150ms ease, color 150ms ease, border-color 150ms ease',
            }}
            onMouseEnter={e => {
              if (!active) {
                e.currentTarget.style.color = 'var(--color-text)'
                e.currentTarget.style.background = 'var(--color-bg-tertiary)'
              }
            }}
            onMouseLeave={e => {
              if (!active) {
                e.currentTarget.style.color = 'var(--color-text-muted)'
                e.currentTarget.style.background = 'transparent'
              }
            }}
          >
            <span style={{ display: 'inline-flex', color: active ? 'var(--color-brand)' : 'inherit' }}>
              {t.icon}
            </span>
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Shared row scaffolding ───────────────────────────────────────────────────

function RowShell({
  primary,
  secondary,
  badges,
  control,
  action,
}: {
  primary: React.ReactNode
  secondary?: React.ReactNode
  badges?: React.ReactNode
  control?: React.ReactNode
  action: React.ReactNode
}) {
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center"
      style={{
        gap: 'var(--space-3)',
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: 'var(--color-text)',
            }}
          >
            {primary}
          </span>
          {badges}
        </div>
        {secondary && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              marginTop: 'var(--space-0-5)',
            }}
          >
            {secondary}
          </div>
        )}
      </div>
      {control && (
        <div style={{ width: '100%', maxWidth: '16rem', flexShrink: 0 }}>{control}</div>
      )}
      <div style={{ flexShrink: 0 }}>{action}</div>
    </div>
  )
}

function ConfigureButton({ onClick }: { onClick: () => void }) {
  return (
    <TahiButton
      variant="secondary"
      size="sm"
      onClick={onClick}
      iconLeft={<SlidersHorizontal className="w-3.5 h-3.5" />}
    >
      Configure features
    </TahiButton>
  )
}

// ── Team members tab ─────────────────────────────────────────────────────────

function TeamTab({
  members,
  roles,
  onAssignRole,
  onConfigure,
}: {
  members: TeamMember[]
  roles: RoleSummary[]
  onAssignRole: (member: TeamMember, roleId: string | null) => void
  onConfigure: (subject: PanelSubject) => void
}) {
  const roleOptions = useMemo(
    () => [
      { value: NO_ROLE, label: 'No role (default admin)', subtitle: 'Full admin access' },
      ...roles.map(r => ({
        value: r.id,
        label: humaniseRole(r.name),
        subtitle: r.description ?? undefined,
      })),
    ],
    [roles],
  )

  if (members.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={<Users className="w-6 h-6" />}
          title="No team members"
          description="Add team members first, then assign roles and feature access here."
        />
      </Card>
    )
  }

  return (
    <Card padding="none">
      {members.map(member => {
        const current = member.roles[0] ?? null
        return (
          <RowShell
            key={member.id}
            primary={member.name}
            secondary={member.email}
            badges={
              current ? (
                <Badge tone={roleTone(current.roleName)} size="sm">
                  {humaniseRole(current.roleName)}
                </Badge>
              ) : (
                <Badge tone="neutral" size="sm" variant="outline">
                  No role
                </Badge>
              )
            }
            control={
              <SearchableSelect
                size="sm"
                value={current?.roleId ?? NO_ROLE}
                options={roleOptions}
                placeholder="Assign role"
                searchPlaceholder="Search roles"
                emptyMessage="No roles"
                onChange={v => onAssignRole(member, v === NO_ROLE ? null : v)}
              />
            }
            action={
              <ConfigureButton
                onClick={() =>
                  onConfigure({
                    type: 'team_member',
                    id: member.id,
                    name: member.name,
                    audience: 'team',
                  })
                }
              />
            }
          />
        )
      })}
    </Card>
  )
}

// ── Clients tab ──────────────────────────────────────────────────────────────

function ClientsTab({
  orgs,
  onConfigure,
}: {
  orgs: OrgSummary[]
  onConfigure: (subject: PanelSubject) => void
}) {
  if (orgs.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={<Building2 className="w-6 h-6" />}
          title="No clients yet"
          description="Once you have client organisations, control their portal feature access here."
        />
      </Card>
    )
  }

  return (
    <Card padding="none">
      {orgs.map(org => (
        <RowShell
          key={org.id}
          primary={org.name}
          secondary="Client portal access"
          action={
            <ConfigureButton
              onClick={() =>
                onConfigure({
                  type: 'organisation',
                  id: org.id,
                  name: org.name,
                  audience: 'client',
                })
              }
            />
          }
        />
      ))}
    </Card>
  )
}

// ── Roles tab ────────────────────────────────────────────────────────────────

function RolesTab({
  roles,
  onConfigure,
}: {
  roles: RoleSummary[]
  onConfigure: (subject: PanelSubject) => void
}) {
  if (roles.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={<Shield className="w-6 h-6" />}
          title="No roles defined"
          description="Roles let you set defaults that apply to every team member assigned to them."
        />
      </Card>
    )
  }

  return (
    <Card padding="none">
      {roles.map(role => (
        <RowShell
          key={role.id}
          primary={humaniseRole(role.name)}
          secondary={role.description ?? 'No description'}
          badges={
            role.isSystem ? (
              <Badge tone="info" size="sm" variant="outline">
                System
              </Badge>
            ) : (
              <Badge tone={roleTone(role.name)} size="sm">
                Custom
              </Badge>
            )
          }
          action={
            <ConfigureButton
              onClick={() =>
                onConfigure({
                  type: 'role',
                  id: role.id,
                  name: humaniseRole(role.name),
                  audience: 'team',
                })
              }
            />
          }
        />
      ))}
    </Card>
  )
}

// ── List loading skeleton ────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <Card padding="none">
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading...</span>
        {[0, 1, 2, 3, 4].map(i => (
          <div
            key={i}
            className="flex items-center animate-pulse"
            style={{
              gap: 'var(--space-3)',
              padding: 'var(--space-4) var(--space-5)',
              borderBottom: i < 4 ? '1px solid var(--color-border-subtle)' : 'none',
            }}
          >
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ height: '0.75rem', width: '40%', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-tertiary)' }} />
              <div style={{ height: '0.625rem', width: '55%', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-secondary)' }} />
            </div>
            <div style={{ height: '2rem', width: '11rem', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-tertiary)' }} />
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── Feature panel (slide-over) ───────────────────────────────────────────────

function FeaturePanel({
  subject,
  onClose,
}: {
  subject: PanelSubject | null
  onClose: () => void
}) {
  const { showToast } = useToast()

  // Map featureKey -> override effect. Absence = inherit (default for the level).
  const [overrides, setOverrides] = useState<Map<string, Effect>>(new Map())
  const [reasons, setReasons] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [errored, setErrored] = useState(false)

  const open = subject !== null

  const loadOverrides = useCallback(async (s: PanelSubject) => {
    setLoading(true)
    setErrored(false)
    try {
      const res = await fetch(
        apiPath(`/api/admin/permissions/feature-visibility?subjectType=${encodeURIComponent(s.type)}&subjectId=${encodeURIComponent(s.id)}`),
      )
      if (!res.ok) throw new Error('Failed')
      const json = (await res.json()) as { overrides: Override[] }
      const nextEffects = new Map<string, Effect>()
      const nextReasons = new Map<string, string>()
      for (const o of json.overrides ?? []) {
        nextEffects.set(o.featureKey, o.effect)
        if (o.reason) nextReasons.set(o.featureKey, o.reason)
      }
      setOverrides(nextEffects)
      setReasons(nextReasons)
    } catch {
      setOverrides(new Map())
      setReasons(new Map())
      setErrored(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on open / subject change.
  useEffect(() => {
    if (!subject) return
    void loadOverrides(subject)
  }, [subject, loadOverrides])

  // Top-level feature nodes relevant to this subject's audience, in tree order.
  const topNodes = useMemo<FeatureNode[]>(() => {
    if (!subject) return []
    return FEATURE_TREE.filter(
      n => n.parent === null && n.appliesTo.includes(subject.audience),
    )
  }, [subject])

  const setEffect = useCallback(
    async (featureKey: string, next: ThreeWay) => {
      if (!subject) return

      const prevEffect = overrides.get(featureKey)
      const reason = reasons.get(featureKey) ?? ''

      // Optimistic local patch.
      setOverrides(prev => {
        const m = new Map(prev)
        if (next === 'inherit') m.delete(featureKey)
        else m.set(featureKey, next)
        return m
      })
      if (next === 'inherit') {
        setReasons(prev => {
          const m = new Map(prev)
          m.delete(featureKey)
          return m
        })
      }

      try {
        const res = await fetch(apiPath('/api/admin/permissions/feature-visibility'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subjectType: subject.type,
            subjectId: subject.id,
            featureKey,
            effect: next,
            reason: next === 'inherit' ? null : reason.trim() || null,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        const label = next === 'inherit' ? 'inheriting default' : next === 'allow' ? 'allowed' : 'denied'
        showToast(`Saved: ${label}`, 'success')
      } catch {
        showToast('Could not save change', 'error')
        // Revert the single key to its previous effect.
        setOverrides(prev => {
          const m = new Map(prev)
          if (prevEffect) m.set(featureKey, prevEffect)
          else m.delete(featureKey)
          return m
        })
      }
    },
    [subject, overrides, reasons, showToast],
  )

  // Persist a reason edit (only meaningful when there is an active allow/deny).
  const commitReason = useCallback(
    async (featureKey: string) => {
      if (!subject) return
      const effect = overrides.get(featureKey)
      if (!effect) return // no active override, nothing to attach a reason to
      const reason = reasons.get(featureKey) ?? ''
      try {
        const res = await fetch(apiPath('/api/admin/permissions/feature-visibility'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subjectType: subject.type,
            subjectId: subject.id,
            featureKey,
            effect,
            reason: reason.trim() || null,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        showToast('Reason saved', 'success')
      } catch {
        showToast('Could not save reason', 'error')
      }
    },
    [subject, overrides, reasons, showToast],
  )

  const subjectTypeLabel =
    subject?.type === 'team_member' ? 'Team member'
    : subject?.type === 'organisation' ? 'Client'
    : 'Role'

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      icon={<SlidersHorizontal size={15} />}
      title={subject?.name ?? 'Feature access'}
      subtitle={subject ? `${subjectTypeLabel} · ${topNodes.length} features` : undefined}
      maxWidth="34rem"
    >
      <SlideOver.Body>
        {/* Legend: what the three states mean. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text)' }}>
            Inherit uses the default for this level
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Set Allow or Deny to override the default just for this {subjectTypeLabel.toLowerCase()}. Denying a parent
            also hides its sub-features.
          </span>
        </div>

        {loading ? (
          <PanelSkeleton />
        ) : errored ? (
          <EmptyState
            variant="inline"
            icon={<SlidersHorizontal className="w-5 h-5" />}
            title="Could not load access"
            description="Try closing and reopening this panel."
          />
        ) : topNodes.length === 0 ? (
          <EmptyState
            variant="inline"
            icon={<SlidersHorizontal className="w-5 h-5" />}
            title="No features for this audience"
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {topNodes.map(node => {
              const children = featureChildren(node.key).filter(c =>
                subject ? c.appliesTo.includes(subject.audience) : false,
              )
              return (
                <div key={node.key}>
                  <FeatureRow
                    node={node}
                    effect={overrides.get(node.key) ?? 'inherit'}
                    reason={reasons.get(node.key) ?? ''}
                    onEffect={setEffect}
                    onReasonChange={(v) =>
                      setReasons(prev => {
                        const m = new Map(prev)
                        m.set(node.key, v)
                        return m
                      })
                    }
                    onReasonCommit={() => void commitReason(node.key)}
                  />
                  {children.length > 0 && (
                    <div
                      style={{
                        marginTop: 'var(--space-2)',
                        marginLeft: 'var(--space-4)',
                        paddingLeft: 'var(--space-3)',
                        borderLeft: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-2)',
                      }}
                    >
                      {children.map(child => (
                        <FeatureRow
                          key={child.key}
                          node={child}
                          indented
                          effect={overrides.get(child.key) ?? 'inherit'}
                          reason={reasons.get(child.key) ?? ''}
                          onEffect={setEffect}
                          onReasonChange={(v) =>
                            setReasons(prev => {
                              const m = new Map(prev)
                              m.set(child.key, v)
                              return m
                            })
                          }
                          onReasonCommit={() => void commitReason(child.key)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SlideOver.Body>
      <SlideOver.Footer>
        <span style={{ flex: 1, fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          Changes save automatically
        </span>
        <TahiButton variant="secondary" size="sm" onClick={onClose}>
          Done
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}

// ── A single feature row inside the panel ────────────────────────────────────

function FeatureRow({
  node,
  effect,
  reason,
  indented = false,
  onEffect,
  onReasonChange,
  onReasonCommit,
}: {
  node: FeatureNode
  effect: ThreeWay
  reason: string
  indented?: boolean
  onEffect: (featureKey: string, next: ThreeWay) => void
  onReasonChange: (value: string) => void
  onReasonCommit: () => void
}) {
  const showReason = effect === 'allow' || effect === 'deny'
  return (
    <div
      style={{
        padding: indented ? 'var(--space-2) 0' : 'var(--space-3) 0',
        borderBottom: indented ? 'none' : '1px solid var(--color-border-subtle)',
      }}
    >
      <div
        className="flex flex-col sm:flex-row sm:items-start sm:justify-between"
        style={{ gap: 'var(--space-3)' }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: indented ? 'var(--text-xs)' : 'var(--text-sm)',
              fontWeight: 600,
              color: 'var(--color-text)',
            }}
          >
            {node.label}
          </div>
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              marginTop: 'var(--space-0-5)',
              lineHeight: 1.5,
            }}
          >
            {node.description}
          </div>
        </div>
        <ThreeWayControl
          value={effect}
          onChange={next => onEffect(node.key, next)}
        />
      </div>
      {showReason && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <input
            type="text"
            value={reason}
            onChange={e => onReasonChange(e.target.value)}
            onBlur={onReasonCommit}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              }
            }}
            placeholder="Reason (optional)"
            aria-label={`Reason for ${node.label} override`}
            className="tahi-input"
            style={{
              width: '100%',
              height: '2.25rem',
              padding: 'var(--space-1-5) var(--space-3)',
              fontSize: 'var(--text-xs)',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--color-text)',
              outline: 'none',
              transition: 'border-color 150ms ease, box-shadow 150ms ease',
            }}
          />
        </div>
      )}
    </div>
  )
}

// ── Three-way segmented control [Inherit | Allow | Deny] ─────────────────────

const THREE_WAY: { value: ThreeWay; label: string; activeBg: string; activeText: string }[] = [
  { value: 'inherit', label: 'Inherit', activeBg: 'var(--color-bg-tertiary)', activeText: 'var(--color-text)' },
  { value: 'allow', label: 'Allow', activeBg: 'var(--color-brand)', activeText: '#ffffff' },
  { value: 'deny', label: 'Deny', activeBg: 'var(--color-danger)', activeText: '#ffffff' },
]

function ThreeWayControl({
  value,
  onChange,
}: {
  value: ThreeWay
  onChange: (next: ThreeWay) => void
}) {
  return (
    <div
      role="group"
      aria-label="Access effect"
      style={{
        display: 'inline-flex',
        flexShrink: 0,
        padding: '0.1875rem',
        gap: '0.1875rem',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      {THREE_WAY.map(opt => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            style={{
              minHeight: '1.875rem',
              padding: '0 0.625rem',
              fontSize: 'var(--text-xs)',
              fontWeight: active ? 600 : 500,
              color: active ? opt.activeText : 'var(--color-text-muted)',
              background: active ? opt.activeBg : 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'background 150ms ease, color 150ms ease',
            }}
            onMouseEnter={e => {
              if (!active) {
                e.currentTarget.style.color = 'var(--color-text)'
                e.currentTarget.style.background = 'var(--color-bg-tertiary)'
              }
            }}
            onMouseLeave={e => {
              if (!active) {
                e.currentTarget.style.color = 'var(--color-text-muted)'
                e.currentTarget.style.background = 'transparent'
              }
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Panel loading skeleton ───────────────────────────────────────────────────

function PanelSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <span className="sr-only">Loading...</span>
      {[0, 1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="flex items-start animate-pulse"
          style={{ gap: 'var(--space-3)', paddingBottom: 'var(--space-3)', borderBottom: '1px solid var(--color-border-subtle)' }}
        >
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ height: '0.75rem', width: '35%', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-tertiary)' }} />
            <div style={{ height: '0.625rem', width: '70%', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-secondary)' }} />
          </div>
          <div style={{ height: '2.25rem', width: '11rem', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-tertiary)' }} />
        </div>
      ))}
    </div>
  )
}
