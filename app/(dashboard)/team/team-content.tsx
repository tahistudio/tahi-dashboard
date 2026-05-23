'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useUser } from '@clerk/nextjs'
import {
  Plus, UserCog, Mail, Shield, RefreshCw, Clock, Trash2,
  Pencil, Link2, GitBranch, Eye, User, Briefcase, Save,
} from 'lucide-react'
import { OrgChart } from '@/components/tahi/org-chart'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { SlideOver } from '@/components/tahi/slide-over'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import { Avatar } from '@/components/tahi/avatar'
import { Badge } from '@/components/tahi/badge'
import { Input } from '@/components/tahi/input'
import { apiPath } from '@/lib/api'
import { setTeamMemberImpersonation, type TeamMemberAccessRule } from '@/components/tahi/impersonation-banner'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/tahi/page-header'

// -- Types --

interface TeamMember {
  id: string
  name: string
  email: string
  title: string | null
  role: string
  skills: string | null
  avatarUrl: string | null
  weeklyCapacityHours: number | null
  isContractor: boolean | null
  createdAt: string
}

interface AccessRule {
  id: string
  teamMemberId: string
  role: string
  scopeType: string
  planType: string | null
  trackType: string
  orgIds: string[]
}

interface OrgOption {
  id: string
  name: string
}

// -- Helpers --

function parseSkills(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string')
    return []
  } catch {
    return []
  }
}

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin', tone: 'brand' as const },
  { value: 'member', label: 'Member', tone: 'neutral' as const },
]

const ROLE_BY_VALUE = new Map(ROLE_OPTIONS.map(r => [r.value, r]))

// Native select styled to match Input — used inside SlideOvers where the
// Select primitive's inline-block layout breaks the 2-col grid.
const selectStyle: React.CSSProperties = {
  width: '100%',
  height: '2.25rem',
  padding: '0 var(--space-3)',
  fontSize: 'var(--text-sm)',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text)',
  outline: 'none',
  cursor: 'pointer',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.625rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
  marginBottom: '0.3125rem',
}

// -- Member Form (shared by Add + Edit) --

function MemberForm({
  name, onName,
  email, onEmail,
  title, onTitle,
  role, onRole,
  skillsInput, onSkillsInput,
  weeklyCapacity, onWeeklyCapacity,
  isContractor, onIsContractor,
  error,
}: {
  name: string; onName: (v: string) => void
  email: string; onEmail: (v: string) => void
  title: string; onTitle: (v: string) => void
  role: string; onRole: (v: string) => void
  skillsInput: string; onSkillsInput: (v: string) => void
  weeklyCapacity: string; onWeeklyCapacity: (v: string) => void
  isContractor: boolean; onIsContractor: (v: boolean) => void
  error: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      {error && (
        <div
          className="text-sm px-3 py-2 rounded-lg"
          role="alert"
          aria-live="polite"
          style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <label htmlFor="member-name" style={labelStyle}>
            Name <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <Input
            id="member-name"
            type="text"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Jane Smith"
            leadingIcon={<User size={14} aria-hidden="true" />}
          />
        </div>

        <div>
          <label htmlFor="member-email" style={labelStyle}>
            Email <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <Input
            id="member-email"
            type="email"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            placeholder="jane@tahi.studio"
            leadingIcon={<Mail size={14} aria-hidden="true" />}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.75rem' }}>
        <div>
          <label htmlFor="member-title" style={labelStyle}>Job title</label>
          <Input
            id="member-title"
            type="text"
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            placeholder="Senior Designer"
            leadingIcon={<Briefcase size={14} aria-hidden="true" />}
          />
        </div>

        <div>
          <label htmlFor="member-role" style={labelStyle}>Role</label>
          <select
            id="member-role"
            value={role}
            onChange={(e) => onRole(e.target.value)}
            style={selectStyle}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="member-skills" style={labelStyle}>
          Skills <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--color-text-subtle)' }}>· comma-separated</span>
        </label>
        <Input
          id="member-skills"
          type="text"
          value={skillsInput}
          onChange={(e) => onSkillsInput(e.target.value)}
          placeholder="Design, Development, Strategy"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', alignItems: 'end' }}>
        <div>
          <label htmlFor="member-capacity" style={labelStyle}>Weekly capacity (hours)</label>
          <Input
            id="member-capacity"
            type="number"
            min={0}
            step={1}
            value={weeklyCapacity}
            onChange={(e) => onWeeklyCapacity(e.target.value)}
            placeholder="40"
            leadingIcon={<Clock size={14} aria-hidden="true" />}
          />
        </div>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text)',
            cursor: 'pointer',
            height: '2.25rem',
            padding: '0 var(--space-3)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg)',
          }}
        >
          <input
            type="checkbox"
            checked={isContractor}
            onChange={(e) => onIsContractor(e.target.checked)}
            style={{ width: '1rem', height: '1rem', accentColor: 'var(--color-brand)' }}
          />
          Contractor
        </label>
      </div>
    </div>
  )
}

// -- Add Team Member SlideOver --

function AddMemberSlideOver({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [role, setRole] = useState('member')
  const [skillsInput, setSkillsInput] = useState('')
  const [weeklyCapacity, setWeeklyCapacity] = useState('')
  const [isContractor, setIsContractor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reset form state every time the slide-over is opened so the next
  // "Add member" doesn't carry stale text from a previous abort.
  useEffect(() => {
    if (open) {
      setName(''); setEmail(''); setTitle(''); setRole('member')
      setSkillsInput(''); setWeeklyCapacity(''); setIsContractor(false)
      setError('')
    }
  }, [open])

  async function handleSubmit() {
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const skills = skillsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      const res = await fetch(apiPath('/api/admin/team'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          title: title.trim() || undefined,
          role,
          skills,
          weeklyCapacityHours: weeklyCapacity ? parseFloat(weeklyCapacity) : undefined,
          isContractor,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to create team member')
      }

      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create team member')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      icon={<UserCog size={15} />}
      title="Add team member"
      subtitle="Invite someone to the Tahi team."
      maxWidth="48rem"
    >
      <SlideOver.Body>
        <MemberForm
          name={name} onName={setName}
          email={email} onEmail={setEmail}
          title={title} onTitle={setTitle}
          role={role} onRole={setRole}
          skillsInput={skillsInput} onSkillsInput={setSkillsInput}
          weeklyCapacity={weeklyCapacity} onWeeklyCapacity={setWeeklyCapacity}
          isContractor={isContractor} onIsContractor={setIsContractor}
          error={error}
        />
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </TahiButton>
        <div style={{ flex: 1 }} />
        <TahiButton
          size="sm"
          onClick={handleSubmit}
          disabled={saving}
          iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
        >
          {saving ? 'Adding...' : 'Add member'}
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}

// -- Edit Team Member SlideOver --

function EditMemberSlideOver({
  member,
  onClose,
  onUpdated,
}: {
  member: TeamMember | null
  onClose: () => void
  onUpdated: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [role, setRole] = useState('member')
  const [skillsInput, setSkillsInput] = useState('')
  const [weeklyCapacity, setWeeklyCapacity] = useState('')
  const [isContractor, setIsContractor] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Hydrate the form whenever a new member is loaded into the editor.
  useEffect(() => {
    if (!member) return
    setName(member.name)
    setEmail(member.email)
    setTitle(member.title ?? '')
    setRole(member.role)
    setSkillsInput(parseSkills(member.skills).join(', '))
    setWeeklyCapacity(member.weeklyCapacityHours?.toString() ?? '')
    setIsContractor(member.isContractor ?? false)
    setError('')
  }, [member])

  async function handleSubmit() {
    if (!member) return
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required')
      return
    }
    setSaving(true)
    setError('')
    try {
      const skills = skillsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

      const res = await fetch(apiPath(`/api/admin/team/${member.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          title: title.trim() || null,
          role,
          skills,
          weeklyCapacityHours: weeklyCapacity ? parseFloat(weeklyCapacity) : null,
          isContractor,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to update team member')
      }

      onUpdated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update team member')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlideOver
      open={!!member}
      onClose={onClose}
      icon={<Pencil size={15} />}
      title="Edit team member"
      subtitle={member?.name}
      maxWidth="48rem"
    >
      <SlideOver.Body>
        <MemberForm
          name={name} onName={setName}
          email={email} onEmail={setEmail}
          title={title} onTitle={setTitle}
          role={role} onRole={setRole}
          skillsInput={skillsInput} onSkillsInput={setSkillsInput}
          weeklyCapacity={weeklyCapacity} onWeeklyCapacity={setWeeklyCapacity}
          isContractor={isContractor} onIsContractor={setIsContractor}
          error={error}
        />
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </TahiButton>
        <div style={{ flex: 1 }} />
        <TahiButton
          size="sm"
          onClick={handleSubmit}
          disabled={saving}
          iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        >
          {saving ? 'Saving...' : 'Save changes'}
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}

// -- Access Panel SlideOver --

function AccessPanel({
  member,
  onClose,
  onUpdated,
}: {
  member: TeamMember | null
  onClose: () => void
  onUpdated: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [rules, setRules] = useState<AccessRule[]>([])
  const [orgs, setOrgs] = useState<OrgOption[]>([])

  // Form state
  const [accessRole, setAccessRole] = useState('task_handler')
  const [scopeType, setScopeType] = useState('all_clients')
  const [planType, setPlanType] = useState('')
  const [trackType, setTrackType] = useState('all')
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>([])

  const fetchAccess = useCallback(async () => {
    if (!member) return
    setLoading(true)
    try {
      const [accessRes, orgsRes] = await Promise.all([
        fetch(apiPath(`/api/admin/team/${member.id}/access`)),
        fetch(apiPath('/api/admin/clients')),
      ])

      if (accessRes.ok) {
        const data = await accessRes.json() as { rules: AccessRule[] }
        setRules(data.rules)
        // Pre-fill form from first rule if one exists
        if (data.rules.length > 0) {
          const r = data.rules[0]
          setAccessRole(r.role)
          setScopeType(r.scopeType)
          setPlanType(r.planType ?? '')
          setTrackType(r.trackType)
          setSelectedOrgIds(r.orgIds ?? [])
        }
      }

      if (orgsRes.ok) {
        const data = await orgsRes.json() as { organisations: OrgOption[] }
        setOrgs(data.organisations ?? [])
      }
    } catch {
      setError('Failed to load access rules')
    } finally {
      setLoading(false)
    }
  }, [member])

  useEffect(() => {
    if (member) fetchAccess()
  }, [member, fetchAccess])

  async function handleSave() {
    if (!member) return
    setSaving(true)
    setError('')

    try {
      const res = await fetch(apiPath(`/api/admin/team/${member.id}/access`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: accessRole,
          scopeType,
          planType: scopeType === 'plan_type' ? planType : undefined,
          trackType,
          orgIds: scopeType === 'specific_clients' ? selectedOrgIds : undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to save')
      }

      onUpdated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  function toggleOrg(orgId: string) {
    setSelectedOrgIds((prev) =>
      prev.includes(orgId) ? prev.filter((id) => id !== orgId) : [...prev, orgId]
    )
  }

  return (
    <SlideOver
      open={!!member}
      onClose={onClose}
      icon={<Shield size={15} />}
      title="Access rules"
      subtitle={member?.name}
      maxWidth="48rem"
    >
      <SlideOver.Body>
        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            {error && (
              <div className="text-sm px-3 py-2 rounded-lg" role="alert" aria-live="polite" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
                {error}
              </div>
            )}

            {rules.length === 0 && (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', fontStyle: 'italic', margin: 0 }}>
                No access rules configured. This member cannot see any client data.
              </p>
            )}

            <div>
              <label htmlFor="access-role" style={labelStyle}>Access role</label>
              <select
                id="access-role"
                value={accessRole}
                onChange={(e) => setAccessRole(e.target.value)}
                style={selectStyle}
              >
                <option value="project_manager">Project Manager</option>
                <option value="task_handler">Task Handler</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>

            <div>
              <label htmlFor="scope-type" style={labelStyle}>Client scope</label>
              <select
                id="scope-type"
                value={scopeType}
                onChange={(e) => setScopeType(e.target.value)}
                style={selectStyle}
              >
                <option value="all_clients">All clients</option>
                <option value="plan_type">By plan type</option>
                <option value="specific_clients">Specific clients</option>
              </select>
            </div>

            {scopeType === 'plan_type' && (
              <div>
                <label htmlFor="plan-type" style={labelStyle}>Plan type</label>
                <select
                  id="plan-type"
                  value={planType}
                  onChange={(e) => setPlanType(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">Select plan</option>
                  <option value="maintain">Maintain</option>
                  <option value="scale">Scale</option>
                  <option value="tune">Tune</option>
                  <option value="launch">Launch</option>
                  <option value="hourly">Hourly</option>
                </select>
              </div>
            )}

            {scopeType === 'specific_clients' && (
              <div>
                <label style={labelStyle}>Select clients</label>
                <div style={{
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  maxHeight: '12rem',
                  overflowY: 'auto',
                }}>
                  {orgs.length === 0 ? (
                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', padding: '0.75rem', margin: 0 }}>
                      No clients found
                    </p>
                  ) : (
                    orgs.map((org) => (
                      <label
                        key={org.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.5rem 0.75rem',
                          fontSize: 'var(--text-sm)',
                          color: 'var(--color-text)',
                          cursor: 'pointer',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedOrgIds.includes(org.id)}
                          onChange={() => toggleOrg(org.id)}
                          style={{ accentColor: 'var(--color-brand)' }}
                        />
                        <span>{org.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="track-type" style={labelStyle}>Track type</label>
              <select
                id="track-type"
                value={trackType}
                onChange={(e) => setTrackType(e.target.value)}
                style={selectStyle}
              >
                <option value="all">All tracks</option>
                <option value="small">Small only</option>
                <option value="large">Large only</option>
              </select>
            </div>
          </div>
        )}
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </TahiButton>
        <div style={{ flex: 1 }} />
        <TahiButton
          size="sm"
          onClick={handleSave}
          disabled={saving}
          iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        >
          {saving ? 'Saving...' : 'Save access'}
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}

// -- Main Component --

export function TeamContent() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddSlideOver, setShowAddSlideOver] = useState(false)
  const [editMember, setEditMember] = useState<TeamMember | null>(null)
  const [accessMember, setAccessMember] = useState<TeamMember | null>(null)
  const [deleteMember, setDeleteMember] = useState<TeamMember | null>(null)
  const [linkingAccount, setLinkingAccount] = useState(false)
  const [view, setView] = useState<'members' | 'org-chart'>('members')
  const [search, setSearch] = useState('')
  // FilterBar uses an array of ActiveFilter. We seed with the role
  // filter so it can't be removed (nonRemovable on the def) and the
  // "+ Add filter" button never appears — role is the only filter.
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([
    { id: 'role', values: [] },
  ])
  const { user } = useUser()
  const router = useRouter()

  const fetchTeam = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/team'))
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json() as { items: TeamMember[] }
      setMembers(data.items ?? [])
    } catch {
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Check if the current Clerk user has a linked team member record
  const currentUserLinked = useMemo(() => {
    if (!user || members.length === 0) return true
    return members.some((m) => m.email === user.primaryEmailAddress?.emailAddress)
  }, [members, user])

  const handleLinkAccount = useCallback(async () => {
    if (!user) return
    setLinkingAccount(true)
    try {
      const res = await fetch(apiPath('/api/admin/team'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: user.fullName ?? user.firstName ?? 'Admin',
          email: user.primaryEmailAddress?.emailAddress ?? '',
          title: 'Co-founder',
          role: 'admin',
          skills: [],
          weeklyCapacityHours: 40,
          isContractor: false,
        }),
      })
      if (!res.ok) throw new Error('Failed to create')
      const data = await res.json() as { id: string }
      await fetch(apiPath(`/api/admin/team/${data.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clerkUserId: user.id }),
      })
      fetchTeam()
    } catch {
      // silently fail
    } finally {
      setLinkingAccount(false)
    }
  }, [user, fetchTeam])

  const handleDeleteMember = useCallback(async () => {
    if (!deleteMember) return
    const res = await fetch(apiPath(`/api/admin/team/${deleteMember.id}`), { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to remove member')
    setDeleteMember(null)
    fetchTeam()
  }, [deleteMember, fetchTeam])

  const handleViewAs = useCallback(async (member: TeamMember) => {
    try {
      // Fetch the team member's access rules
      const res = await fetch(apiPath(`/api/admin/team/${member.id}/access`))
      let accessRules: TeamMemberAccessRule[] = []
      if (res.ok) {
        const data = await res.json() as { rules: AccessRule[] }
        accessRules = (data.rules ?? []).map((r) => ({
          role: r.role,
          scopeType: r.scopeType,
          planType: r.planType,
          trackType: r.trackType,
          orgIds: r.orgIds,
        }))
      }

      setTeamMemberImpersonation({
        teamMemberId: member.id,
        teamMemberName: member.name,
        accessRules,
      })

      // Navigate to overview so the admin can see the scoped view
      router.push('/overview')
    } catch {
      // If access fetch fails, still impersonate but with no rules (most restrictive)
      setTeamMemberImpersonation({
        teamMemberId: member.id,
        teamMemberName: member.name,
        accessRules: [],
      })
      router.push('/overview')
    }
  }, [router])

  useEffect(() => {
    fetchTeam()
  }, [fetchTeam])

  // Selected role values from the FilterBar chip.
  const selectedRoles = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'role')
    return new Set(f?.values ?? [])
  }, [activeFilters])

  // Filtered list — applies search across name/email/title and role chip.
  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members.filter(m => {
      if (selectedRoles.size > 0 && !selectedRoles.has(m.role)) return false
      if (q) {
        const inName = m.name.toLowerCase().includes(q)
        const inEmail = m.email.toLowerCase().includes(q)
        const inTitle = (m.title ?? '').toLowerCase().includes(q)
        if (!inName && !inEmail && !inTitle) return false
      }
      return true
    })
  }, [members, search, selectedRoles])

  // FilterBar definition — single multiselect chip pinned to the bar.
  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'role',
      label: 'Role',
      kind: 'multiselect',
      nonRemovable: true,
      options: ROLE_OPTIONS.map(r => ({ value: r.value, label: r.label, tone: r.tone })),
    },
  ]), [])

  // Column defs for the DataTable.
  const columns: DataTableColumn<TeamMember>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: r => r.name.toLowerCase(),
      minWidth: '18rem',
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minWidth: 0 }}>
          <Avatar name={r.name} src={r.avatarUrl} size="md" />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontWeight: 600,
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{r.name}</div>
            <div style={{
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{r.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      sortValue: r => (r.title ?? '').toLowerCase(),
      minWidth: '11rem',
      render: r => r.title
        ? <span style={{ color: 'var(--color-text)' }}>{r.title}</span>
        : <span style={{ color: 'var(--color-text-subtle)' }}>—</span>,
    },
    {
      key: 'role',
      header: 'Role',
      sortable: true,
      sortValue: r => r.role,
      width: '7.5rem',
      render: r => {
        const def = ROLE_BY_VALUE.get(r.role)
        return (
          <Badge tone={def?.tone ?? 'neutral'} variant="soft" size="sm" dot={false}>
            {def?.label ?? r.role}
          </Badge>
        )
      },
    },
    {
      key: 'capacity',
      header: 'Capacity',
      sortable: true,
      sortValue: r => r.weeklyCapacityHours ?? 0,
      width: '7.5rem',
      render: r => r.weeklyCapacityHours ? (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3125rem',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
        }}>
          <Clock size={11} aria-hidden="true" />
          {r.weeklyCapacityHours}h / wk
        </span>
      ) : <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.75rem' }}>—</span>,
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      sortValue: r => (r.isContractor ? 'contractor' : 'employee'),
      width: '7.5rem',
      render: r => r.isContractor
        ? <Badge tone="warning" variant="soft" size="sm" dot={false}>Contractor</Badge>
        : <Badge tone="neutral" variant="soft" size="sm" dot={false}>Employee</Badge>,
    },
    {
      key: 'skills',
      header: 'Skills',
      minWidth: '12rem',
      render: r => {
        const skills = parseSkills(r.skills)
        if (skills.length === 0) {
          return <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}>—</span>
        }
        // Cap visible chips at 2 to keep row height stable.
        const visible = skills.slice(0, 2)
        const overflow = skills.length - visible.length
        return (
          <div style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center', whiteSpace: 'nowrap' }}>
            {visible.map(s => (
              <Badge key={s} tone="neutral" variant="soft" size="sm" dot={false}>{s}</Badge>
            ))}
            {overflow > 0 && (
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                +{overflow}
              </span>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <PageHeader
        title="Team"
        subtitle="Manage team members, roles, and access scoping."
      >
        <TahiButton variant="secondary" size="sm" onClick={fetchTeam} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
        <TahiButton size="sm" onClick={() => setShowAddSlideOver(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
          Add member
        </TahiButton>
      </PageHeader>

      {/* View toggle tabs */}
      <div className="flex gap-1 border-b border-[var(--color-border-subtle)]">
        <button
          onClick={() => setView('members')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
          style={{
            color: view === 'members' ? 'var(--color-brand)' : 'var(--color-text-muted)',
            borderBottom: view === 'members' ? '2px solid var(--color-brand)' : '2px solid transparent',
          }}
        >
          <UserCog style={{ width: '0.875rem', height: '0.875rem' }} />
          Members
        </button>
        <button
          onClick={() => setView('org-chart')}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
          style={{
            color: view === 'org-chart' ? 'var(--color-brand)' : 'var(--color-text-muted)',
            borderBottom: view === 'org-chart' ? '2px solid var(--color-brand)' : '2px solid transparent',
          }}
        >
          <GitBranch style={{ width: '0.875rem', height: '0.875rem' }} />
          Org chart
        </button>
      </div>

      {view === 'org-chart' ? (
        <OrgChart />
      ) : (
        <>
          {/* Self-link banner */}
          {!loading && !currentUserLinked && (
            <div
              className="flex items-center justify-between px-4 py-3 rounded-xl border"
              style={{
                background: 'var(--color-info-bg)',
                borderColor: 'var(--color-info)',
              }}
            >
              <div className="flex items-center gap-3">
                <Link2 className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--color-info)' }} />
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">
                    You are not listed as a team member
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Add yourself so you can be assigned to requests and tasks.
                  </p>
                </div>
              </div>
              <TahiButton size="sm" onClick={handleLinkAccount} loading={linkingAccount}>
                Add me
              </TahiButton>
            </div>
          )}

          {/* Filter row */}
          <FilterBar
            filters={filterDefs}
            active={activeFilters}
            onChange={setActiveFilters}
            search={{
              value: search,
              onChange: setSearch,
              placeholder: 'Search name, email or title',
            }}
            size="sm"
          />

          {/* Table */}
          <Card padding="none">
            <DataTable<TeamMember>
              ariaLabel="Team members"
              columns={columns}
              rows={filteredMembers}
              getRowId={r => r.id}
              defaultSort={{ key: 'name', dir: 'asc' }}
              loading={loading}
              empty={
                <EmptyState
                  icon={<UserCog className="w-6 h-6" />}
                  title={members.length === 0 ? 'No team members yet' : 'No matches'}
                  description={members.length === 0
                    ? 'Add your first team member to get started.'
                    : 'Try clearing a filter or adjusting your search.'}
                  action={
                    members.length === 0 ? (
                      <TahiButton size="sm" onClick={() => setShowAddSlideOver(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
                        Add member
                      </TahiButton>
                    ) : undefined
                  }
                />
              }
              onRowPreview={(r) => setEditMember(r)}
              rowActions={(r) => [
                { label: 'Edit', icon: <Pencil size={14} />, onClick: () => setEditMember(r) },
                { label: 'Manage access', icon: <Shield size={14} />, onClick: () => setAccessMember(r) },
                { label: 'View as', icon: <Eye size={14} />, onClick: () => handleViewAs(r) },
                { label: 'Remove', icon: <Trash2 size={14} />, tone: 'danger', onClick: () => setDeleteMember(r) },
              ]}
            />
          </Card>
        </>
      )}

      {/* Slide-overs */}
      <AddMemberSlideOver
        open={showAddSlideOver}
        onClose={() => setShowAddSlideOver(false)}
        onCreated={fetchTeam}
      />

      <EditMemberSlideOver
        member={editMember}
        onClose={() => setEditMember(null)}
        onUpdated={fetchTeam}
      />

      <AccessPanel
        member={accessMember}
        onClose={() => setAccessMember(null)}
        onUpdated={fetchTeam}
      />

      <ConfirmDialog
        open={!!deleteMember}
        title="Remove team member"
        description={deleteMember ? `Are you sure you want to remove ${deleteMember.name}? Their access rules will also be deleted.` : ''}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={handleDeleteMember}
        onCancel={() => setDeleteMember(null)}
      />
    </div>
  )
}
