'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, UserCog, Mail, Shield, RefreshCw, X, ChevronRight, Clock, Trash2 } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { apiPath } from '@/lib/api'

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

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  member: 'Member',
}

// -- Add Team Member Modal --

function AddMemberModal({
  onClose,
  onCreated,
}: {
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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

  const inputCn = 'w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-lg mx-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-member-title"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-2">
          <h2 id="add-member-title" className="text-lg font-bold text-[var(--color-text)]">
            Add Team Member
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-4">
          {error && (
            <div
              className="text-sm px-3 py-2 rounded-lg"
              role="alert"
              aria-live="polite"
              style={{ background: 'var(--color-danger-bg, #fef2f2)', color: 'var(--color-danger, #f87171)' }}
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="member-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Name <span style={{ color: 'var(--color-danger)' }}>*</span>
              </label>
              <input
                id="member-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputCn}
                placeholder="Jane Smith"
              />
            </div>

            <div>
              <label htmlFor="member-email" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Email <span style={{ color: 'var(--color-danger)' }}>*</span>
              </label>
              <input
                id="member-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCn}
                placeholder="jane@tahi.studio"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="member-title" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Job Title
              </label>
              <input
                id="member-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className={inputCn}
                placeholder="Senior Designer"
              />
            </div>

            <div>
              <label htmlFor="member-role" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Role
              </label>
              <select
                id="member-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className={inputCn}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="member-skills" className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Skills (comma-separated)
            </label>
            <input
              id="member-skills"
              type="text"
              value={skillsInput}
              onChange={(e) => setSkillsInput(e.target.value)}
              className={inputCn}
              placeholder="Design, Development, Strategy"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="member-capacity" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Weekly Capacity (hours)
              </label>
              <input
                id="member-capacity"
                type="number"
                min="0"
                step="1"
                value={weeklyCapacity}
                onChange={(e) => setWeeklyCapacity(e.target.value)}
                className={inputCn}
                placeholder="40"
              />
            </div>

            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={isContractor}
                  onChange={(e) => setIsContractor(e.target.checked)}
                  className="rounded border-[var(--color-border)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                  style={{ width: '1rem', height: '1rem', accentColor: 'var(--color-brand)' }}
                />
                Contractor
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <TahiButton variant="secondary" type="button" onClick={onClose}>
              Cancel
            </TahiButton>
            <TahiButton type="submit" loading={saving}>
              Add Member
            </TahiButton>
          </div>
        </form>
      </div>
    </div>
  )
}

// -- Access Panel --

function AccessPanel({
  member,
  onClose,
  onUpdated,
}: {
  member: TeamMember
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
  }, [member.id])

  useEffect(() => {
    fetchAccess()
  }, [fetchAccess])

  async function handleSave() {
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
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className="bg-[var(--color-bg)] rounded-t-xl sm:rounded-xl shadow-xl w-full max-w-lg mx-0 sm:mx-4 max-h-[80vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-panel-title"
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-2 sticky top-0 bg-[var(--color-bg)] z-10">
          <div>
            <h2 id="access-panel-title" className="text-lg font-bold text-[var(--color-text)]">
              Access Rules
            </h2>
            <p className="text-sm text-[var(--color-text-muted)]">{member.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="px-6 pb-6">
            <LoadingSkeleton rows={4} />
          </div>
        ) : (
          <div className="px-6 pb-6 space-y-4">
            {error && (
              <div className="text-sm px-3 py-2 rounded-lg" role="alert" aria-live="polite" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
                {error}
              </div>
            )}

            {rules.length === 0 && (
              <p className="text-sm text-[var(--color-text-muted)] italic">
                No access rules configured. This member cannot see any client data.
              </p>
            )}

            <div>
              <label htmlFor="access-role" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Access Role
              </label>
              <select
                id="access-role"
                value={accessRole}
                onChange={(e) => setAccessRole(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              >
                <option value="project_manager">Project Manager</option>
                <option value="task_handler">Task Handler</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>

            <div>
              <label htmlFor="scope-type" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Client Scope
              </label>
              <select
                id="scope-type"
                value={scopeType}
                onChange={(e) => setScopeType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              >
                <option value="all_clients">All Clients</option>
                <option value="plan_type">By Plan Type</option>
                <option value="specific_clients">Specific Clients</option>
              </select>
            </div>

            {scopeType === 'plan_type' && (
              <div>
                <label htmlFor="plan-type" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                  Plan Type
                </label>
                <select
                  id="plan-type"
                  value={planType}
                  onChange={(e) => setPlanType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
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
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
                  Select Clients
                </label>
                <div className="border border-[var(--color-border)] rounded-lg max-h-48 overflow-y-auto">
                  {orgs.length === 0 ? (
                    <p className="text-sm text-[var(--color-text-muted)] p-3">No clients found</p>
                  ) : (
                    orgs.map((org) => (
                      <label
                        key={org.id}
                        className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--color-bg-secondary)] cursor-pointer text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedOrgIds.includes(org.id)}
                          onChange={() => toggleOrg(org.id)}
                          className="rounded border-[var(--color-border)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                        />
                        <span className="text-[var(--color-text)]">{org.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}

            <div>
              <label htmlFor="track-type" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Track Type
              </label>
              <select
                id="track-type"
                value={trackType}
                onChange={(e) => setTrackType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              >
                <option value="all">All Tracks</option>
                <option value="small">Small Only</option>
                <option value="large">Large Only</option>
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <TahiButton variant="secondary" onClick={onClose}>
                Cancel
              </TahiButton>
              <TahiButton onClick={handleSave} loading={saving}>
                Save Access
              </TahiButton>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// -- Main Component --

export function TeamContent() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [accessMember, setAccessMember] = useState<TeamMember | null>(null)
  const [deleteMember, setDeleteMember] = useState<TeamMember | null>(null)

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

  const handleDeleteMember = useCallback(async () => {
    if (!deleteMember) return
    const res = await fetch(apiPath(`/api/admin/team/${deleteMember.id}`), { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to remove member')
    setDeleteMember(null)
    fetchTeam()
  }, [deleteMember, fetchTeam])

  useEffect(() => {
    fetchTeam()
  }, [fetchTeam])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Team</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Manage team members, roles, and access scoping.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TahiButton variant="secondary" size="sm" onClick={fetchTeam} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
            Refresh
          </TahiButton>
          <TahiButton size="sm" onClick={() => setShowAddModal(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
            Add Member
          </TahiButton>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : members.length === 0 ? (
        <EmptyState
          icon={<UserCog className="w-8 h-8 text-white" />}
          title="No team members yet"
          description="Add your first team member to get started."
          ctaLabel="Add Member"
          onCtaClick={() => setShowAddModal(true)}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {members.map((member) => {
            const skills = parseSkills(member.skills)
            const initials = member.name
              .split(' ')
              .map((w) => w[0])
              .join('')
              .toUpperCase()
              .slice(0, 2)

            return (
              <div
                key={member.id}
                className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-hidden hover:border-[var(--color-brand)] transition-colors group"
              >
                {/* Card header with gradient accent */}
                <div
                  className="h-1.5"
                  style={{
                    background: member.role === 'admin'
                      ? 'linear-gradient(90deg, var(--color-brand), var(--color-brand-light))'
                      : 'var(--color-border)',
                  }}
                />

                <div className="p-5">
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    {member.avatarUrl ? (
                      <img
                        src={member.avatarUrl}
                        alt={member.name}
                        className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <div
                        className="w-11 h-11 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0"
                        style={{
                          background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
                          borderRadius: 'var(--radius-leaf-sm)',
                        }}
                      >
                        {initials}
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-[var(--color-text)] truncate">
                        {member.name}
                      </h3>
                      {member.title && (
                        <p className="text-xs text-[var(--color-text-muted)] truncate mt-0.5">
                          {member.title}
                        </p>
                      )}
                      <div className="flex items-center gap-1 mt-1">
                        <Mail className="w-3 h-3 text-[var(--color-text-subtle)] flex-shrink-0" aria-hidden="true" />
                        <span className="text-xs text-[var(--color-text-muted)] truncate">
                          {member.email}
                        </span>
                      </div>
                    </div>

                    {/* Role badge */}
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{
                        background: member.role === 'admin' ? 'var(--color-brand-50)' : 'var(--color-bg-tertiary)',
                        color: member.role === 'admin' ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                      }}
                    >
                      {ROLE_LABELS[member.role] ?? member.role}
                    </span>
                  </div>

                  {/* Skills */}
                  {skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {skills.map((skill) => (
                        <span
                          key={skill}
                          className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]"
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Capacity and contractor info */}
                  {(member.weeklyCapacityHours || member.isContractor) && (
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-[var(--color-border-subtle)]">
                      {member.weeklyCapacityHours ? (
                        <span className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          {member.weeklyCapacityHours}h/week
                        </span>
                      ) : null}
                      {member.isContractor && (
                        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: '1px solid var(--color-warning)' }}>
                          Contractor
                        </span>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-4">
                    <button
                      onClick={() => setAccessMember(member)}
                      className="flex-1 flex items-center justify-between px-3 py-2.5 rounded-lg border border-[var(--color-border-subtle)] hover:border-[var(--color-brand)] hover:bg-[var(--color-bg-secondary)] transition-colors text-sm text-[var(--color-text-muted)] hover:text-[var(--color-brand)]"
                    >
                      <span className="flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5" aria-hidden="true" />
                        Manage Access
                      </span>
                      <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => setDeleteMember(member)}
                      className="p-2.5 rounded-lg border border-[var(--color-border-subtle)] hover:border-red-300 hover:bg-red-50 text-[var(--color-text-subtle)] hover:text-red-500 transition-colors"
                      aria-label={`Remove ${member.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddMemberModal
          onClose={() => setShowAddModal(false)}
          onCreated={fetchTeam}
        />
      )}

      {accessMember && (
        <AccessPanel
          member={accessMember}
          onClose={() => setAccessMember(null)}
          onUpdated={fetchTeam}
        />
      )}

      <ConfirmDialog
        open={!!deleteMember}
        title="Remove team member"
        description={deleteMember ? `Are you sure you want to remove ${deleteMember.name}? Their access rules will also be deleted.` : ''}
        confirmLabel="Remove"
        onConfirm={handleDeleteMember}
        onCancel={() => setDeleteMember(null)}
      />
    </div>
  )
}
