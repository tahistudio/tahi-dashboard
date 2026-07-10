'use client'

/**
 * TeamAccessPane - Settings > Team & access, the full control surface.
 *
 * Three tabs (Team members / Clients / Roles), search, a change-history view,
 * and a master-detail editor: role assignment, data scope (all / by plan /
 * specific clients - the real teamMemberAccess rule), per-feature overrides
 * via the slide-over, copy-access, and preview-as (the existing impersonation
 * machinery: client view sets the portal cookie, team view simulates scoping).
 *
 * Server is the gate; this surface only writes intent through the audited
 * permissions APIs. Everything is optimistic with toasts, reconciling on the
 * server response.
 */

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR, { useSWRConfig } from 'swr'
import { Building2, Search, Shield, Users, X } from 'lucide-react'
import { apiPath } from '@/lib/api'
// The pane also renders standalone on /permissions, so it owns the CSS import.
import '@/app/(dashboard)/settings/settings.css'
import { useToasts, Toasts, SlideSeg } from '@/components/tahi/settings/primitives'
import {
  setImpersonation,
  setTeamMemberImpersonation,
  type TeamMemberAccessRule,
} from '@/components/tahi/impersonation-banner'
import { FeatureSlideOver, overridesKey, type OverrideSubject } from './feature-slideover'
import { RolesMatrix } from './roles-matrix'
import { ChangeHistory } from './change-history'
import { CopyDialog } from './copy-dialog'
import { SubjectDetail, ContactDetail, scopeLine } from './subject-detail'
import {
  RoleChip,
  SubjAvatar,
  humanisePlan,
  humaniseRole,
  permissionTeaserKey,
  SCOPED_ROLES,
  type SubjectMember,
  type SubjectsResponse,
} from './shared'

const ROLE_RANK = ['super_admin', 'admin', 'project_manager', 'task_handler', 'viewer']

type Tab = 'team' | 'clients' | 'roles'

export function TeamAccessPane() {
  const router = useRouter()
  const { toasts, toast } = useToasts()
  const { mutate: mutateKey } = useSWRConfig()

  const [tab, setTab] = useState<Tab>('team')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'list' | 'history'>('list')
  const [selTeam, setSelTeam] = useState<string | null>(null)
  const [selClient, setSelClient] = useState<string | null>(null)
  // A person (contact) selected within the active client org. null = the org
  // itself is the active subject; set = drilled into that person.
  const [selContact, setSelContact] = useState<string | null>(null)
  const [slideOver, setSlideOver] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const [showDetail, setShowDetail] = useState(false) // mobile push

  const { data, isLoading, mutate } = useSWR<SubjectsResponse>('/api/admin/permissions/subjects')
  const members = useMemo(() => data?.teamMembers ?? [], [data])
  const orgs = useMemo(() => data?.orgs ?? [], [data])
  const roles = useMemo(() => data?.roles ?? [], [data])

  const q = search.trim().toLowerCase()
  const teamList = useMemo(() => {
    const rank = (m: SubjectMember) => {
      const r = m.roles[0]?.roleName
      const i = r ? ROLE_RANK.indexOf(r) : 99
      return i === -1 ? 98 : i
    }
    return [...members]
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
      .filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
  }, [members, q])
  // A client org matches if its name OR any of its people match the search, so
  // searching a person surfaces their org (with that person still listed).
  const clientList = useMemo(
    () =>
      [...orgs]
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter(
          (o) =>
            !q ||
            o.name.toLowerCase().includes(q) ||
            o.contacts.some((c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)),
        ),
    [orgs, q],
  )

  const curMember = tab === 'team' ? members.find((m) => m.id === (selTeam ?? teamList[0]?.id)) ?? null : null
  const curOrg = tab === 'clients' ? orgs.find((o) => o.id === (selClient ?? clientList[0]?.id)) ?? null : null
  // The active client person, when one is drilled into (must belong to curOrg).
  const curContact =
    tab === 'clients' && selContact ? curOrg?.contacts.find((c) => c.id === selContact) ?? null : null

  const curId = tab === 'clients' ? (curContact?.id ?? curOrg?.id) : curMember?.id
  const curName = tab === 'clients' ? (curContact?.name ?? curOrg?.name) : curMember?.name

  const overrideSubject: OverrideSubject | null = curId
    ? {
        type: tab === 'clients' ? (curContact ? 'contact' : 'organisation') : 'team_member',
        id: curId,
        name: curName ?? '',
        audience: tab === 'clients' ? 'client' : 'team',
      }
    : null

  // ── writes ──────────────────────────────────────────────────────────────────

  const assignRole = useCallback(
    async (member: SubjectMember, roleId: string | null) => {
      const role = roleId ? roles.find((r) => r.id === roleId) ?? null : null
      const label = role ? humaniseRole(role.name) : 'No role'
      void mutate(
        (prev) =>
          prev
            ? {
                ...prev,
                teamMembers: prev.teamMembers.map((m) =>
                  m.id === member.id ? { ...m, roles: role ? [{ roleId: role.id, roleName: role.name }] : [] } : m,
                ),
              }
            : prev,
        { revalidate: false },
      )
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
        toast(member.name + ' set to ' + label, 'ok')
        void mutate()
        void mutateKey(permissionTeaserKey('team_member', member.id))
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not update role', 'err')
        void mutate()
      }
    },
    [roles, mutate, mutateKey, toast],
  )

  const saveScope = useCallback(
    async (member: SubjectMember, scope: { scopeType: string; planType: string | null; orgIds: string[] }) => {
      const roleName = member.roles[0]?.roleName
      // The scoping table only understands the three scoped roles; anything
      // else never reaches here (admin-level members render a locked note).
      const scopeRole = roleName && SCOPED_ROLES.has(roleName) ? roleName : 'viewer'
      void mutate(
        (prev) =>
          prev
            ? {
                ...prev,
                teamMembers: prev.teamMembers.map((m) =>
                  m.id === member.id
                    ? {
                        ...m,
                        scope: {
                          scopeType: scope.scopeType,
                          planType: scope.planType,
                          trackType: member.scope?.trackType ?? 'all',
                          orgIds: scope.orgIds,
                        },
                      }
                    : m,
                ),
              }
            : prev,
        { revalidate: false },
      )
      try {
        const res = await fetch(apiPath('/api/admin/team/' + member.id + '/access'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: scopeRole,
            scopeType: scope.scopeType,
            planType: scope.planType ?? undefined,
            trackType: member.scope?.trackType ?? 'all',
            orgIds: scope.orgIds,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        toast('Data scope saved', 'ok')
        void mutate()
        void mutateKey(permissionTeaserKey('team_member', member.id))
      } catch {
        toast('Could not save data scope', 'err')
        void mutate()
      }
    },
    [mutate, mutateKey, toast],
  )

  const setPortalRole = useCallback(
    async (contactId: string, portalRole: 'admin' | 'member') => {
      void mutate(
        (prev) =>
          prev
            ? {
                ...prev,
                orgs: prev.orgs.map((o) => ({
                  ...o,
                  contacts: o.contacts.map((c) => (c.id === contactId ? { ...c, portalRole } : c)),
                })),
              }
            : prev,
        { revalidate: false },
      )
      try {
        const res = await fetch(apiPath('/api/admin/permissions/contact-role'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contactId, portalRole }),
        })
        if (!res.ok) throw new Error('Failed')
        toast(portalRole === 'admin' ? 'Set to workspace admin' : 'Set to member', 'ok')
        void mutate()
        void mutateKey(permissionTeaserKey('contact', contactId))
      } catch {
        toast('Could not update portal role', 'err')
        void mutate()
      }
    },
    [mutate, mutateKey, toast],
  )

  // ── preview-as (real impersonation machinery) ───────────────────────────────

  const previewAs = useCallback(async () => {
    if (tab === 'clients' && curOrg) {
      setImpersonation({ orgId: curOrg.id, orgName: curOrg.name })
      router.push('/overview')
      return
    }
    if (curMember) {
      let accessRules: TeamMemberAccessRule[] = []
      try {
        const res = await fetch(apiPath('/api/admin/team/' + curMember.id + '/access'))
        if (res.ok) {
          const j = (await res.json()) as {
            rules: Array<{ role: string; scopeType: string; planType: string | null; trackType: string; orgIds: string[] }>
          }
          accessRules = (j.rules ?? []).map((r) => ({
            role: r.role,
            scopeType: r.scopeType,
            planType: r.planType,
            trackType: r.trackType,
            orgIds: r.orgIds,
          }))
        }
      } catch {
        // Fall through with the most restrictive view (no rules).
      }
      setTeamMemberImpersonation({
        teamMemberId: curMember.id,
        teamMemberName: curMember.name,
        accessRules,
      })
      router.push('/overview')
    }
  }, [tab, curOrg, curMember, router])

  // ── render ──────────────────────────────────────────────────────────────────

  if (view === 'history') {
    return (
      <div className="set-pane">
        <h2 className="set-h2">Team &amp; access</h2>
        <ChangeHistory onBack={() => setView('list')} />
        <Toasts toasts={toasts} />
      </div>
    )
  }

  return (
    <div className="set-pane">
      <h2 className="set-h2">Team &amp; access</h2>
      <p className="set-lede">Who sees what, why, and how much. Every grant has a name, a reason, and a record.</p>

      <div className="ta-switchrow">
        <SlideSeg
          role="tablist"
          optRole="tab"
          ariaLabel="Subject class"
          value={tab}
          onChange={(v) => {
            setTab(v as Tab)
            if (v !== 'roles') setShowDetail(false)
          }}
          opts={[
            { v: 'team', label: 'Team members', icon: <Users size={16} aria-hidden="true" /> },
            { v: 'clients', label: 'Clients', icon: <Building2 size={16} aria-hidden="true" /> },
            { v: 'roles', label: 'Roles', icon: <Shield size={16} aria-hidden="true" /> },
          ]}
        />
        <div className="ta-search">
          <Search size={16} aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'roles' ? 'Search features' : tab === 'clients' ? 'Search clients' : 'Search people'}
            aria-label="Search"
          />
          {search && (
            <button type="button" className="ta-search-x" onClick={() => setSearch('')} aria-label="Clear search">
              <X size={13} aria-hidden="true" />
            </button>
          )}
        </div>
        <button type="button" className="btn-ghost ta-history-link" onClick={() => setView('history')}>
          Change history
        </button>
      </div>

      <div className="ta-anim" key={tab}>
        {tab === 'roles' ? (
          <RolesMatrix search={search} toast={toast} />
        ) : isLoading && !data ? (
          <ListSkeleton />
        ) : (
          <div className={'ta-md' + (showDetail ? ' show-detail' : '')}>
            <div className="ta-list" role="listbox" aria-label={tab === 'clients' ? 'Clients' : 'Team members'}>
              {tab === 'team' &&
                teamList.map((m) => {
                  const sel = m.id === curMember?.id
                  return (
                    <button
                      key={m.id}
                      type="button"
                      className={'subj' + (sel ? ' sel' : '')}
                      aria-current={sel}
                      onClick={() => {
                        setSelTeam(m.id)
                        setShowDetail(true)
                      }}
                    >
                      <SubjAvatar name={m.name} />
                      <div className="subj-t">
                        <div className="subj-l1">
                          <b>{m.name}</b>
                        </div>
                        <span className="subj-l2">{scopeLine(m, orgs.length, orgs)}</span>
                      </div>
                      <span className="subj-chip">
                        <RoleChip roleName={m.roles[0]?.roleName ?? null} />
                      </span>
                    </button>
                  )
                })}
              {tab === 'team' && teamList.length === 0 && (
                <div className="lrow" style={{ color: 'var(--text-faint)', font: '500 13px Manrope' }}>
                  No team members match.
                </div>
              )}
              {tab === 'clients' &&
                clientList.map((o) => {
                  const orgSel = o.id === curOrg?.id && !curContact
                  return (
                    <div key={o.id}>
                      <button
                        type="button"
                        className={'subj' + (orgSel ? ' sel' : '')}
                        aria-current={orgSel}
                        onClick={() => {
                          setSelClient(o.id)
                          setSelContact(null)
                          setShowDetail(true)
                        }}
                      >
                        <SubjAvatar name={o.name} />
                        <div className="subj-t">
                          <div className="subj-l1">
                            <b>{o.name}</b>
                          </div>
                          <span className="subj-l2">
                            {o.contacts.length
                              ? o.contacts.length + ' ' + (o.contacts.length === 1 ? 'person' : 'people')
                              : 'Client portal access'}
                          </span>
                        </div>
                        <span className="subj-chip">
                          <span className="chip neutral">{humanisePlan(o.planType)}</span>
                        </span>
                      </button>
                      {o.contacts.map((c) => {
                        const personSel = c.id === curContact?.id
                        return (
                          <button
                            key={c.id}
                            type="button"
                            className={'subj nested' + (personSel ? ' sel' : '')}
                            aria-current={personSel}
                            onClick={() => {
                              setSelClient(o.id)
                              setSelContact(c.id)
                              setShowDetail(true)
                            }}
                          >
                            <SubjAvatar name={c.name} />
                            <div className="subj-t">
                              <div className="subj-l1">
                                <b>{c.name}</b>
                                {c.pending && <span className="chip outline">Pending</span>}
                              </div>
                              <span className="subj-l2">{c.title || c.email}</span>
                            </div>
                            <span className="subj-chip">
                              <span className={'chip ' + (c.portalRole === 'admin' ? 'brand' : 'neutral')}>
                                {c.portalRole === 'admin' ? 'Admin' : 'Member'}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              {tab === 'clients' && clientList.length === 0 && (
                <div className="lrow" style={{ color: 'var(--text-faint)', font: '500 13px Manrope' }}>
                  No clients match.
                </div>
              )}
            </div>

            <div className="ta-detail-wrap">
              {curContact ? (
                <ContactDetail
                  contact={curContact}
                  orgName={curOrg?.name ?? ''}
                  onBack={() => setShowDetail(false)}
                  onSetPortalRole={(role) => void setPortalRole(curContact.id, role)}
                  onConfigure={() => setSlideOver(true)}
                  onHistory={() => setView('history')}
                />
              ) : (
                <SubjectDetail
                  tab={tab}
                  member={curMember}
                  org={curOrg}
                  roles={roles}
                  orgs={orgs}
                  onBack={() => setShowDetail(false)}
                  onAssignRole={(m, roleId) => void assignRole(m, roleId)}
                  onSaveScope={(m, scope) => void saveScope(m, scope)}
                  onConfigure={() => setSlideOver(true)}
                  onPreview={() => void previewAs()}
                  onCopy={() => setCopyOpen(true)}
                  onHistory={() => setView('history')}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {slideOver && overrideSubject && (
        <FeatureSlideOver
          subject={overrideSubject}
          onClose={() => setSlideOver(false)}
          toast={toast}
          onChanged={() => {
            if (overrideSubject.type !== 'role') {
              void mutateKey(permissionTeaserKey(overrideSubject.type, overrideSubject.id))
            }
          }}
        />
      )}
      {copyOpen && curId && curName && (
        <CopyDialog
          subjectType={tab === 'clients' ? 'organisation' : 'team_member'}
          target={{ id: curId, name: curName }}
          members={members}
          orgs={orgs}
          toast={toast}
          onClose={() => setCopyOpen(false)}
          onCopied={() => {
            void mutate()
            if (overrideSubject) {
              // Refresh the copied subject's overrides + history teaser caches.
              void mutateKey(overridesKey(overrideSubject))
              if (overrideSubject.type !== 'role') {
                void mutateKey(permissionTeaserKey(overrideSubject.type, overrideSubject.id))
              }
            }
          }}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="ta-md">
      <div className="ta-list" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="subj animate-pulse" style={{ cursor: 'default' }}>
            <span className="subj-av" style={{ background: 'var(--bg-secondary)' }} />
            <div className="subj-t" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ height: 11, width: '55%', borderRadius: 6, background: 'var(--bg-tertiary)' }} />
              <div style={{ height: 9, width: '40%', borderRadius: 6, background: 'var(--bg-secondary)' }} />
            </div>
          </div>
        ))}
      </div>
      <div className="ta-detail" aria-hidden="true">
        <div className="animate-pulse" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ height: 40, width: '55%', borderRadius: 9, background: 'var(--bg-secondary)' }} />
          <div style={{ height: 14, width: '35%', borderRadius: 6, background: 'var(--bg-tertiary)' }} />
          <div style={{ height: 100, borderRadius: 12, background: 'var(--bg-secondary)' }} />
        </div>
      </div>
    </div>
  )
}
