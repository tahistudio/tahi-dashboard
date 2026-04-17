'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import { stageColour } from '@/lib/chart-colors'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import {
  Globe,
  Building2,
  Mail,
  User,
  Edit2,
  Check,
  X,
  Plus,
  Layers,
  MessageSquare,
  Clock,
  Activity,
  FileText,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  Users,
  Loader2,
  DollarSign,
  Download,
  File,
  ScrollText,
  Phone,
  Video,
  ExternalLink,
  Eye,
  Tag,
  Trash2,
  TrendingUp,
  Handshake,
  CalendarDays,
  Palette,
  Pencil,
  ListOrdered,
  Percent,
} from 'lucide-react'
import { StatusBadge, PlanBadge, HealthDot } from '@/components/tahi/status-badge'
import { TrackMeter } from '@/components/tahi/track-meter'
import { TahiButton } from '@/components/tahi/tahi-button'
import { RequestCard } from '@/components/tahi/request-card'
import { NewRequestDialog } from '@/components/tahi/new-request-dialog'
import { cn } from '@/lib/utils'
import { TrackQueueView } from '@/components/tahi/track-queue-view'
import type { TrackWithQueue, TrackActiveRequest } from '@/components/tahi/track-queue-view'
import { trackCanHandle } from '@/lib/plan-utils'
import {
  CYCLE_BUNDLED_ADDONS,
  CYCLE_MONTHS,
  PLAN_MONTHLY_RATES,
  calculateBundledSavings,
  type BillingInterval,
} from '@/lib/billing'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Contact {
  id: string
  name: string
  email: string
  role: string | null
  isPrimary: boolean
  clerkUserId: string | null
}

interface Subscription {
  id: string
  planType: string
  status: string
  hasPrioritySupport: boolean
  hasSeoAddon: boolean
  billingInterval: string | null
  includedAddons: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  createdAt: string
}

interface Track {
  id: string
  type: 'small' | 'large'
  isPriorityTrack: boolean
  currentRequestId: string | null
  currentRequestTitle?: string | null
}

interface Organisation {
  id: string
  name: string
  website: string | null
  industry: string | null
  planType: string | null
  status: string
  healthStatus: string | null
  healthNote: string | null
  internalNotes: string | null
  brands: string | null
  preferredCurrency: string | null
  customMrr: number | null
  billingModel: string | null
  defaultHourlyRate: number | null
  retainerStartDate: string | null
  retainerEndDate: string | null
  createdAt: string
  updatedAt: string
}

interface Request {
  id: string
  title: string
  status: string
  type: string
  priority: string
  updatedAt: string
  createdAt: string
}

interface ClientData {
  org: Organisation
  contacts: Contact[]
  subscription: Subscription | null
  tracks: Track[]
  recentRequests: Request[]
}

// ── Tabs ───────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'overview',      label: 'Overview',      icon: Building2 },
  { id: 'requests',      label: 'Requests',      icon: Layers },
  { id: 'trackqueue',    label: 'Track Queue',   icon: ListOrdered },
  { id: 'files',         label: 'Files',         icon: File },
  { id: 'invoices',      label: 'Invoices',      icon: DollarSign },
  { id: 'contracts',     label: 'Contracts',     icon: ScrollText },
  { id: 'contacts',      label: 'Contacts',      icon: Users },
  { id: 'calls',         label: 'Calls',         icon: Phone },
  { id: 'messages',      label: 'Messages',      icon: MessageSquare },
  { id: 'brands',        label: 'Brands',        icon: Palette },
  { id: 'deals',         label: 'Deals',         icon: Handshake },
  { id: 'time',          label: 'Time',          icon: Clock },
  { id: 'crm',           label: 'Activities',    icon: CalendarDays },
  { id: 'revenue',       label: 'Revenue',       icon: TrendingUp },
  { id: 'profitability', label: 'Profitability', icon: Percent },
  { id: 'activity',      label: 'Activity',      icon: Activity },
] as const

type TabId = typeof TABS[number]['id']

// ── Main component ─────────────────────────────────────────────────────────────

export function ClientDetail({ clientId }: { clientId: string }) {
  const router = useRouter()
  const [data, setData] = useState<ClientData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${clientId}`))
      if (!res.ok) { router.push('/clients'); return }
      setData(await res.json() as ClientData)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  useEffect(() => { void load() }, [load])

  if (loading) return <LoadingSkeleton />
  if (!data) return null

  const { org, contacts, subscription, tracks, recentRequests } = data

  return (
    <div className="flex flex-col min-h-0">
      {/* ── Header ── */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="pb-0">
          {/* Breadcrumb */}
          <div style={{ marginBottom: '0.75rem' }}>
            <Breadcrumb items={[{ label: 'Clients', href: '/clients' }, { label: org.name }]} />
          </div>

          {/* Title row */}
          <div className="flex flex-col gap-3 mb-5 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-[var(--color-text)] md:text-2xl break-words">
                  {org.name}
                </h1>
                <div className="flex items-center gap-2 flex-wrap mt-2">
                  <HealthDot health={org.healthStatus} className="w-2.5 h-2.5" />
                  <StatusBadge status={org.status} type="org" />
                  <PlanBadge plan={org.planType} />
                </div>

                {org.website && (
                  <a
                    href={org.website.startsWith('http') ? org.website : `https://${org.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-brand)] mt-1.5"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    {org.website.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0 sm:ml-0">
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const { setImpersonation } = await import('@/components/tahi/impersonation-banner')
                  const primaryContact = contacts[0]
                  setImpersonation({
                    orgId: org.id,
                    orgName: org.name,
                    contactId: primaryContact?.id,
                    contactName: primaryContact?.name,
                  })
                  router.push('/overview')
                }}
              >
                <Eye className="w-3.5 h-3.5 mr-1.5" />
                <span className="hidden sm:inline">View as Client</span>
                <span className="sm:hidden">Client View</span>
              </TahiButton>
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={async () => {
                  try {
                    const res = await fetch(apiPath(`/api/admin/clients/${clientId}/welcome-email`), { method: 'POST' })
                    if (!res.ok) throw new Error('Failed')
                  } catch {
                    // silently fail
                  }
                }}
              >
                <Mail className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Welcome Email</span>
              </TahiButton>
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={() => router.push(`/pipeline?new=1&orgId=${clientId}`)}
              >
                <Handshake className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">New Deal</span>
              </TahiButton>
              <TahiButton variant="secondary" size="sm" onClick={load}>
                <RefreshCw className="w-3.5 h-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Refresh</span>
              </TahiButton>
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const isArchiving = org.status !== 'archived'
                  const verb = isArchiving ? 'Archive' : 'Unarchive'
                  if (!confirm(`${verb} ${org.name}?\n\n${isArchiving ? 'They will be hidden from active client lists. All data will be preserved and can be restored.' : 'They will reappear in your active client lists.'}`)) return
                  try {
                    const res = await fetch(apiPath(`/api/admin/clients/${clientId}`), {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: isArchiving ? 'archived' : 'active' }),
                    })
                    if (!res.ok) throw new Error('Failed')
                    await load()
                  } catch {
                    alert(`Failed to ${verb.toLowerCase()} client. Please try again.`)
                  }
                }}
                aria-label={org.status === 'archived' ? 'Unarchive client' : 'Archive client'}
                title={org.status === 'archived' ? 'Unarchive client' : 'Archive client'}
              >
                {org.status === 'archived' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 sm:mr-1.5" />
                    <span className="hidden sm:inline">Unarchive</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5 sm:mr-1.5" />
                    <span className="hidden sm:inline">Archive</span>
                  </>
                )}
              </TahiButton>
            </div>
          </div>

          {/* Track meter in header for quick glance */}
          {tracks.length > 0 && (
            <div className="mb-4 px-0">
              <TrackMeter tracks={tracks} />
            </div>
          )}

          {/* Tab nav */}
          <nav className="flex gap-0 border-b border-[var(--color-border)] overflow-x-auto scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>
            {TABS.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 -mb-px',
                    isActive
                      ? 'border-[var(--color-brand)] text-[var(--color-brand)] bg-[var(--color-brand-50)]'
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border)]'
                  )}
                  style={{ minHeight: '2.75rem' }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              )
            })}
          </nav>
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-auto py-6 space-y-6">
        {activeTab === 'overview' && (
          <OverviewTab
            org={org}
            contacts={contacts}
            subscription={subscription}
            tracks={tracks}
            recentRequests={recentRequests}
            onUpdated={load}
          />
        )}
        {activeTab === 'requests' && (
          <RequestsTab clientId={clientId} />
        )}
        {activeTab === 'trackqueue' && (
          <TrackQueueTab clientId={clientId} />
        )}
        {activeTab === 'files' && (
          <FilesTab clientId={clientId} />
        )}
        {activeTab === 'invoices' && (
          <InvoicesTab clientId={clientId} />
        )}
        {activeTab === 'contracts' && (
          <ContractsTab clientId={clientId} />
        )}
        {activeTab === 'contacts' && (
          <ContactsTab clientId={clientId} contacts={contacts} onUpdated={load} />
        )}
        {activeTab === 'calls' && (
          <CallsTab clientId={clientId} orgName={org.name} />
        )}
        {activeTab === 'messages' && (
          <MessagesTab clientId={clientId} orgName={org.name} />
        )}
        {activeTab === 'brands' && (
          <BrandsTab clientId={clientId} />
        )}
        {activeTab === 'deals' && (
          <DealsTab clientId={clientId} orgName={org.name} />
        )}
        {activeTab === 'time' && (
          <TimeTab clientId={clientId} />
        )}
        {activeTab === 'crm' && (
          <CrmActivitiesTab clientId={clientId} />
        )}
        {activeTab === 'revenue' && (
          <RevenueTab clientId={clientId} />
        )}
        {activeTab === 'profitability' && (
          <ProfitabilityTab clientId={clientId} />
        )}
        {activeTab === 'activity' && (
          <ActivityTab clientId={clientId} />
        )}

        {/* Mobile bottom nav spacer */}
        <div className="h-28 md:hidden" aria-hidden="true" />
      </div>
    </div>
  )
}

// ── Overview tab ───────────────────────────────────────────────────────────────

function OverviewTab({
  org,
  contacts,
  subscription,
  tracks,
  recentRequests,
  onUpdated,
}: {
  org: Organisation
  contacts: Contact[]
  subscription: Subscription | null
  tracks: Track[]
  recentRequests: Request[]
  onUpdated: () => void
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left column (wide) */}
      <div className="lg:col-span-2 flex flex-col gap-6">
        <OrgDetailsCard org={org} onUpdated={onUpdated} />
        <RecentRequestsCard requests={recentRequests} orgId={org.id} />
      </div>

      {/* Right column (narrow) */}
      <div className="flex flex-col gap-6">
        <ContactsCard contacts={contacts} />
        {subscription && (
          <SubscriptionCard subscription={subscription} tracks={tracks} orgId={org.id} onUpdated={onUpdated} />
        )}
        {!subscription && <NoSubscriptionCard planType={org.planType} />}
        {org.healthNote && <HealthNoteCard note={org.healthNote} health={org.healthStatus} />}
        <BrandsCard org={org} onUpdated={onUpdated} />
        <InternalNotesCard org={org} onUpdated={onUpdated} />
      </div>
    </div>
  )
}

// ── Brands card ────────────────────────────────────────────────────────────────

function BrandsCard({ org, onUpdated }: { org: Organisation; onUpdated: () => void }) {
  const [brands, setBrands] = useState<string[]>(() => {
    try {
      return JSON.parse(org.brands ?? '[]') as string[]
    } catch {
      return []
    }
  })
  const [newBrand, setNewBrand] = useState('')
  const [saving, setSaving] = useState(false)

  const saveBrands = async (updated: string[]) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/clients/${org.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brands: JSON.stringify(updated) }),
      })
      setBrands(updated)
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  const addBrand = () => {
    const name = newBrand.trim()
    if (!name || brands.includes(name)) return
    const updated = [...brands, name]
    setNewBrand('')
    saveBrands(updated)
  }

  const removeBrand = (name: string) => {
    saveBrands(brands.filter(b => b !== name))
  }

  return (
    <div
      className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl"
      style={{ padding: '1.25rem' }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Tag className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-[var(--color-text)]">Brands</h3>
      </div>

      {brands.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {brands.map(b => (
            <span
              key={b}
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full"
              style={{
                background: 'var(--color-brand-50)',
                color: 'var(--color-brand-dark)',
              }}
            >
              {b}
              <button
                onClick={() => removeBrand(b)}
                disabled={saving}
                className="hover:text-[var(--color-danger)] transition-colors"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                aria-label={`Remove brand ${b}`}
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={newBrand}
          onChange={e => setNewBrand(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addBrand() }}
          placeholder="Add brand name..."
          className="flex-1 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
          style={{
            padding: '0.375rem 0.5rem',
            borderRadius: 'var(--radius-input)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            minHeight: '2rem',
          }}
        />
        <button
          onClick={addBrand}
          disabled={!newBrand.trim() || saving}
          className="text-xs font-medium text-white transition-colors"
          style={{
            background: 'var(--color-brand)',
            borderRadius: 'var(--radius-button)',
            border: 'none',
            cursor: !newBrand.trim() || saving ? 'not-allowed' : 'pointer',
            opacity: !newBrand.trim() || saving ? 0.5 : 1,
            padding: '0.375rem 0.75rem',
            minHeight: '2rem',
          }}
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> : 'Add'}
        </button>
      </div>
    </div>
  )
}

// ── MRR inline edit ───────────────────────────────────────────────────────────

function MrrInlineEdit({
  orgId,
  value,
  currency,
  onUpdated,
}: {
  orgId: string
  value: number | null
  currency: string
  onUpdated: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value?.toString() ?? '')
  const [saving, setSaving] = useState(false)

  const formatted = value != null
    ? new Intl.NumberFormat('en-NZ', { style: 'currency', currency }).format(value)
    : null

  const save = async () => {
    setSaving(true)
    try {
      const parsed = draft.trim() === '' ? null : parseFloat(draft)
      if (parsed !== null && isNaN(parsed)) return
      await fetch(apiPath(`/api/admin/clients/${orgId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customMrr: parsed }),
      })
      onUpdated()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          step="0.01"
          min="0"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
          autoFocus
          className="w-28 px-2 py-1 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
          placeholder="0.00"
        />
        <button
          onClick={save}
          disabled={saving}
          className="p-1 text-[var(--color-brand)] hover:text-[var(--color-brand-dark)] disabled:opacity-50"
          aria-label="Save MRR"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => { setEditing(false); setDraft(value?.toString() ?? '') }}
          className="p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          aria-label="Cancel"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => { setDraft(value?.toString() ?? ''); setEditing(true) }}
      className="flex items-center gap-1.5 text-sm text-[var(--color-text)] hover:text-[var(--color-brand)] transition-colors group"
    >
      <span>{formatted ?? '--'}</span>
      <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-[var(--color-text-muted)]" />
    </button>
  )
}

// ── Org details card (editable) ────────────────────────────────────────────────

interface TeamMemberPm {
  id: string
  name: string
}

function OrgDetailsCard({ org, onUpdated }: { org: Organisation; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [teamMembers, setTeamMembers] = useState<TeamMemberPm[]>([])
  const [assignedPm, setAssignedPm] = useState<string | null>(null)
  const [pmLoading, setPmLoading] = useState(false)

  useEffect(() => {
    // Load team members for PM selector
    fetch(apiPath('/api/admin/team-members'))
      .then(r => r.json() as Promise<{ items: TeamMemberPm[] }>)
      .then(d => setTeamMembers(d.items ?? []))
      .catch(() => {})

    // Load current PM assignment
    fetch(apiPath(`/api/admin/clients/${org.id}/pm`))
      .then(r => r.json() as Promise<{ pmId: string | null; pmName: string | null }>)
      .then(d => setAssignedPm(d.pmId))
      .catch(() => {})
  }, [org.id])

  const handlePmChange = async (pmId: string | null) => {
    setPmLoading(true)
    try {
      await fetch(apiPath(`/api/admin/clients/${org.id}/pm`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pmId }),
      })
      setAssignedPm(pmId)
    } catch {
      // silent
    } finally {
      setPmLoading(false)
    }
  }

  const [form, setForm] = useState({
    name: org.name,
    website: org.website ?? '',
    industry: org.industry ?? '',
    status: org.status,
    healthStatus: org.healthStatus ?? 'green',
    healthNote: org.healthNote ?? '',
    billingModel: org.billingModel ?? 'none',
    customMrr: org.customMrr ? String(org.customMrr) : '',
    defaultHourlyRate: org.defaultHourlyRate ? String(org.defaultHourlyRate) : '',
    preferredCurrency: org.preferredCurrency ?? 'NZD',
    retainerStartDate: org.retainerStartDate ?? '',
    retainerEndDate: org.retainerEndDate ?? '',
  })

  const save = async () => {
    setSaving(true)
    try {
      // Build the patch with proper type coercion for numeric fields
      const patch: Record<string, unknown> = {
        ...form,
        customMrr: form.customMrr ? parseFloat(form.customMrr) : null,
        defaultHourlyRate: form.defaultHourlyRate ? parseFloat(form.defaultHourlyRate) : null,
        retainerStartDate: form.retainerStartDate || null,
        retainerEndDate: form.retainerEndDate || null,
      }
      await fetch(apiPath(`/api/admin/clients/${org.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      onUpdated()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const HEALTH_OPTIONS = [
    { value: 'green', label: 'Green (healthy)', colour: 'bg-emerald-400' },
    { value: 'amber', label: 'Amber (watch)', colour: 'bg-amber-400' },
    { value: 'red',   label: 'Red (at risk)',  colour: 'bg-red-400' },
  ]

  const STATUS_OPTIONS = ['prospect', 'active', 'paused', 'churned', 'archived']

  return (
    <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">Organisation details</h2>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <Edit2 className="w-3.5 h-3.5" />
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => { setEditing(false); setForm({ name: org.name, website: org.website ?? '', industry: org.industry ?? '', status: org.status, healthStatus: org.healthStatus ?? 'green', healthNote: org.healthNote ?? '', billingModel: org.billingModel ?? 'none', customMrr: org.customMrr ? String(org.customMrr) : '', defaultHourlyRate: org.defaultHourlyRate ? String(org.defaultHourlyRate) : '', preferredCurrency: org.preferredCurrency ?? 'NZD', retainerStartDate: org.retainerStartDate ?? '', retainerEndDate: org.retainerEndDate ?? '' }) }}
              className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1 text-sm text-[var(--color-brand)] hover:text-[var(--color-brand-dark)] font-medium disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Name</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Website</label>
            <input
              value={form.website}
              onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
              placeholder="https://example.com"
              className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Industry</label>
            <input
              value={form.industry}
              onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
              placeholder="e.g. SaaS, eCommerce"
              className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Status</label>
            <select
              value={form.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Health</label>
            <select
              value={form.healthStatus}
              onChange={e => setForm(f => ({ ...f, healthStatus: e.target.value }))}
              className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              {HEALTH_OPTIONS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Health note (internal)</label>
            <textarea
              value={form.healthNote}
              onChange={e => setForm(f => ({ ...f, healthNote: e.target.value }))}
              rows={2}
              placeholder="Brief note about client health..."
              className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] resize-none"
            />
          </div>

          {/* Billing section */}
          <div className="col-span-2 border-t border-[var(--color-border-subtle)] pt-3 mt-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">Billing</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Billing model</label>
            <select
              value={form.billingModel}
              onChange={e => setForm(f => ({ ...f, billingModel: e.target.value }))}
              className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              <option value="none">None</option>
              <option value="retainer">Retainer</option>
              <option value="hourly">Hourly</option>
              <option value="project">Project</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Currency</label>
            <select
              value={form.preferredCurrency}
              onChange={e => setForm(f => ({ ...f, preferredCurrency: e.target.value }))}
              className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              {['NZD', 'USD', 'GBP', 'EUR', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {(form.billingModel === 'retainer' || form.billingModel === 'none') && (
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">MRR ({form.preferredCurrency})</label>
              <input
                type="number"
                step="0.01"
                value={form.customMrr}
                onChange={e => setForm(f => ({ ...f, customMrr: e.target.value }))}
                placeholder="e.g. 3125"
                className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              />
            </div>
          )}
          {form.billingModel === 'hourly' && (
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Hourly rate ({form.preferredCurrency})</label>
              <input
                type="number"
                step="0.01"
                value={form.defaultHourlyRate}
                onChange={e => setForm(f => ({ ...f, defaultHourlyRate: e.target.value }))}
                placeholder="e.g. 50"
                className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Retainer start</label>
            <input
              type="date"
              value={form.retainerStartDate}
              onChange={e => setForm(f => ({ ...f, retainerStartDate: e.target.value }))}
              className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
              Retainer end <span className="text-xs text-[var(--color-text-subtle)]">(churn date)</span>
            </label>
            <input
              type="date"
              value={form.retainerEndDate}
              onChange={e => setForm(f => ({ ...f, retainerEndDate: e.target.value }))}
              className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            />
            {form.retainerEndDate && (
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-warning)' }}>
                Cash flow forecast will stop counting this MRR after this date.
              </p>
            )}
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Website</dt>
            <dd>
              {org.website ? (
                <a
                  href={org.website.startsWith('http') ? org.website : `https://${org.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[var(--color-brand)] hover:underline"
                >
                  <Globe className="w-3.5 h-3.5" />
                  {org.website.replace(/^https?:\/\//, '')}
                </a>
              ) : (
                <span className="text-[var(--color-text-muted)]">--</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Industry</dt>
            <dd className="text-[var(--color-text)]">{org.industry ?? '--'}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Status</dt>
            <dd><StatusBadge status={org.status} type="org" /></dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Health</dt>
            <dd className="flex items-center gap-1.5">
              <HealthDot health={org.healthStatus} />
              <span className="capitalize text-[var(--color-text)]">
                {org.healthStatus ?? 'Unknown'}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Client since</dt>
            <dd className="text-[var(--color-text)]">
              {new Date(org.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Last updated</dt>
            <dd className="text-[var(--color-text)]">
              {new Date(org.updatedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Billing model</dt>
            <dd className="text-[var(--color-text)] capitalize">{org.billingModel ?? 'none'}</dd>
          </div>
          {org.billingModel === 'retainer' || org.customMrr ? (
            <div>
              <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">MRR</dt>
              <dd className="text-[var(--color-text)] font-medium">
                {org.customMrr
                  ? new Intl.NumberFormat('en-NZ', { style: 'currency', currency: org.preferredCurrency ?? 'NZD', maximumFractionDigits: 0 }).format(org.customMrr)
                  : '--'}
              </dd>
            </div>
          ) : org.billingModel === 'hourly' ? (
            <div>
              <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Hourly rate</dt>
              <dd className="text-[var(--color-text)] font-medium">
                {org.defaultHourlyRate
                  ? `${org.preferredCurrency ?? 'NZD'} ${org.defaultHourlyRate}/hr`
                  : '--'}
              </dd>
            </div>
          ) : null}
          {(org.retainerStartDate || org.retainerEndDate) && (
            <div>
              <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Retainer period</dt>
              <dd className="text-[var(--color-text)]">
                {org.retainerStartDate && <span>{org.retainerStartDate}</span>}
                {org.retainerStartDate && org.retainerEndDate && ' \u2192 '}
                {org.retainerEndDate && (
                  <span style={{ color: 'var(--color-warning)', fontWeight: 500 }}>{org.retainerEndDate}</span>
                )}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-[var(--color-text-muted)] mb-0.5">Project Manager</dt>
            <dd>
              <select
                value={assignedPm ?? ''}
                onChange={e => handlePmChange(e.target.value || null)}
                disabled={pmLoading}
                className="px-2 py-1 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              >
                <option value="">No PM assigned</option>
                {teamMembers.map(tm => (
                  <option key={tm.id} value={tm.id}>{tm.name}</option>
                ))}
              </select>
            </dd>
          </div>
        </dl>
      )}
    </div>
  )
}

// ── Contacts card ──────────────────────────────────────────────────────────────

function ContactsCard({ contacts }: { contacts: Contact[] }) {
  return (
    <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-[var(--color-text)]">Contacts</h3>
        <button className="p-1 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {contacts.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">No contacts yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {contacts.map(contact => (
            <div key={contact.id} className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center text-[var(--color-brand)] text-xs font-bold flex-shrink-0">
                {contact.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-[var(--color-text)] truncate">
                    {contact.name}
                  </span>
                  {contact.isPrimary && (
                    <span className="text-xs text-[var(--color-brand)] bg-[var(--color-brand-50)] px-1.5 py-0.5 rounded-full">
                      Primary
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                  <Mail className="w-3 h-3" />
                  <span className="truncate">{contact.email}</span>
                </div>
                {contact.role && (
                  <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                    <User className="w-3 h-3" />
                    {contact.role}
                  </div>
                )}
                <div className={cn('mt-0.5 w-1.5 h-1.5 rounded-full inline-block', contact.clerkUserId ? 'bg-emerald-400' : 'bg-[var(--color-border)]')} title={contact.clerkUserId ? 'Has portal access' : 'No portal access yet'} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Subscription card ──────────────────────────────────────────────────────────

function SubscriptionCard({ subscription, tracks, orgId, onUpdated }: { subscription: Subscription; tracks: Track[]; orgId: string; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [planType, setPlanType] = useState(subscription.planType)

  const PLAN_OPTIONS = ['maintain', 'scale', 'tune', 'launch', 'hourly', 'custom']

  const savePlan = async () => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/clients/${orgId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planType }),
      })
      onUpdated()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm text-[var(--color-text)]">Subscription</h3>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors flex items-center gap-1"
          >
            <Edit2 className="w-3 h-3" />
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => { setEditing(false); setPlanType(subscription.planType) }}
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Cancel
            </button>
            <button
              onClick={savePlan}
              disabled={saving}
              className="text-xs text-[var(--color-brand)] font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mb-3">
          <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Plan type</label>
          <select
            value={planType}
            onChange={e => setPlanType(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          >
            {PLAN_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-3">
          <PlanBadge plan={subscription.planType} />
          <StatusBadge status={subscription.status} type="org" />
        </div>
      )}

      <div className="flex flex-col gap-1.5 text-xs text-[var(--color-text-muted)] mb-3">
        {subscription.currentPeriodEnd && (
          <div className="flex justify-between">
            <span>Renews</span>
            <span className="text-[var(--color-text)]">
              {new Date(subscription.currentPeriodEnd).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Priority support</span>
          <span className={subscription.hasPrioritySupport ? 'text-emerald-600' : 'text-[var(--color-text-muted)]'}>
            {subscription.hasPrioritySupport ? 'Yes' : 'No'}
          </span>
        </div>
        <div className="flex justify-between">
          <span>SEO add-on</span>
          <span className={subscription.hasSeoAddon ? 'text-emerald-600' : 'text-[var(--color-text-muted)]'}>
            {subscription.hasSeoAddon ? 'Yes' : 'No'}
          </span>
        </div>
      </div>

      {/* Billing interval editor */}
      <BillingIntervalEditor subscription={subscription} onUpdated={onUpdated} />

      <div className="pt-3 border-t border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-[var(--color-text-muted)]">Tracks ({tracks.length})</p>
        </div>
        <TrackMeter tracks={tracks} />
        {tracks.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {tracks.map(track => (
              <div key={track.id} className="flex items-center justify-between text-xs">
                <span className="text-[var(--color-text-muted)] capitalize">{track.type} track</span>
                <span className={track.currentRequestId ? 'text-amber-600' : 'text-emerald-600'}>
                  {track.currentRequestId ? 'Occupied' : 'Available'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Billing interval editor ──────────────────────────────────────────────────

const INTERVAL_LABELS: Record<BillingInterval, string> = {
  monthly: 'Monthly',
  quarterly: '3-Month',
  annual: '12-Month',
}

function BillingIntervalEditor({ subscription, onUpdated }: { subscription: Subscription; onUpdated: () => void }) {
  const currentInterval = (subscription.billingInterval ?? 'monthly') as BillingInterval
  const [selected, setSelected] = useState<BillingInterval>(currentInterval)
  const [saving, setSaving] = useState(false)
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null)

  const hasChanged = selected !== currentInterval
  const bundledAddons = CYCLE_BUNDLED_ADDONS[selected]
  const monthlySavings = calculateBundledSavings(selected)
  const monthlyRate = PLAN_MONTHLY_RATES[subscription.planType] ?? 0
  const cycleMonths = CYCLE_MONTHS[selected]
  const annualSavings = monthlySavings * 12

  const saveInterval = async () => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/subscriptions/${subscription.id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingInterval: selected,
          includedAddons: bundledAddons,
        }),
      })
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="pt-3 border-t border-[var(--color-border)]">
      <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">Billing interval</p>

      {/* Button group */}
      <div className="flex gap-1 mb-2">
        {(['monthly', 'quarterly', 'annual'] as BillingInterval[]).map(interval => {
          const isActive = selected === interval
          const isHovered = hoveredBtn === interval
          return (
            <button
              key={interval}
              onClick={() => setSelected(interval)}
              onMouseEnter={() => setHoveredBtn(interval)}
              onMouseLeave={() => setHoveredBtn(null)}
              className="flex-1 text-xs font-medium py-1.5 rounded-md transition-colors"
              style={{
                background: isActive ? 'var(--color-brand)' : isHovered ? 'var(--color-bg-tertiary)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--color-text-muted)',
                border: isActive ? '1px solid var(--color-brand)' : '1px solid var(--color-border)',
              }}
            >
              {INTERVAL_LABELS[interval]}
            </button>
          )
        })}
      </div>

      {/* Bundled add-ons info */}
      {bundledAddons.length > 0 && (
        <div
          className="rounded-lg p-2.5 mb-2"
          style={{ background: 'var(--color-brand-50)', border: '1px solid var(--color-brand-100)' }}
        >
          <p className="text-xs font-medium" style={{ color: 'var(--color-brand-dark)' }}>
            {selected === 'quarterly' && 'Includes free SEO Dashboard ($150/mo value)'}
            {selected === 'annual' && 'Includes free Extra Track + Priority Support + SEO Dashboard'}
          </p>
          {annualSavings > 0 && (
            <p className="text-xs mt-1" style={{ color: 'var(--color-brand)' }}>
              Annual value of bundled add-ons: ${annualSavings.toLocaleString()}/yr
            </p>
          )}
        </div>
      )}

      {/* Current billing summary */}
      {monthlyRate > 0 && (
        <div className="flex justify-between text-xs text-[var(--color-text-muted)] mb-2">
          <span>{cycleMonths}-month total</span>
          <span className="text-[var(--color-text)] font-medium">
            ${(monthlyRate * cycleMonths).toLocaleString()} NZD
          </span>
        </div>
      )}

      {/* Save button */}
      {hasChanged && (
        <button
          onClick={saveInterval}
          disabled={saving}
          onMouseEnter={() => setHoveredBtn('save')}
          onMouseLeave={() => setHoveredBtn(null)}
          className="w-full text-xs font-medium py-1.5 rounded-md transition-colors disabled:opacity-50"
          style={{
            background: hoveredBtn === 'save' ? 'var(--color-brand-dark)' : 'var(--color-brand)',
            color: '#ffffff',
          }}
        >
          {saving ? 'Saving...' : 'Save billing interval'}
        </button>
      )}
    </div>
  )
}

function NoSubscriptionCard({ planType }: { planType: string | null }) {
  if (!planType || planType === 'none') return null
  return (
    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
      <div className="flex gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-800">No active subscription</p>
          <p className="text-xs text-amber-700 mt-0.5">Plan type is set but no subscription record exists.</p>
        </div>
      </div>
    </div>
  )
}

// ── Health note card ───────────────────────────────────────────────────────────

function HealthNoteCard({ note, health }: { note: string; health: string | null }) {
  const colours =
    health === 'red'   ? 'bg-red-50 border-red-100 text-red-700' :
    health === 'amber' ? 'bg-amber-50 border-amber-100 text-amber-700' :
    'bg-emerald-50 border-emerald-100 text-emerald-700'

  return (
    <div className={cn('rounded-xl border p-4 text-sm', colours)}>
      <p className="font-medium mb-0.5">Health note</p>
      <p className="text-xs opacity-80">{note}</p>
    </div>
  )
}

// ── Internal notes card (editable) ────────────────────────────────────────────

function InternalNotesCard({ org, onUpdated }: { org: Organisation; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(org.internalNotes ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/clients/${org.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ internalNotes: notes }),
      })
      onUpdated()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm text-[var(--color-text)]">Internal notes</h3>
        {!editing ? (
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => { setEditing(false); setNotes(org.internalNotes ?? '') }} className="text-xs text-[var(--color-text-muted)]">Cancel</button>
            <button onClick={save} disabled={saving} className="text-xs text-[var(--color-brand)] font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1 mb-2">Never shown to clients</p>

      {editing ? (
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={4}
          placeholder="Private notes about this client..."
          className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] resize-none"
          autoFocus
        />
      ) : (
        <p className="text-sm text-[var(--color-text-secondary)] whitespace-pre-wrap min-h-[2rem]">
          {notes || <span className="text-[var(--color-text-muted)] italic">No notes yet. Click Edit to add.</span>}
        </p>
      )}
    </div>
  )
}

// ── Recent requests card ───────────────────────────────────────────────────────

function RecentRequestsCard({ requests, orgId }: { requests: Request[]; orgId: string }) {
  const router = useRouter()

  return (
    <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">Recent requests</h2>
        <TahiButton
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/requests?org=${orgId}`)}
          className="text-xs"
        >
          View all <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
        </TahiButton>
      </div>

      {requests.length === 0 ? (
        <div className="text-center py-8">
          <FileText className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-2 opacity-50" />
          <p className="text-sm text-[var(--color-text-muted)]">No requests yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {requests.map(req => (
            <RequestCard
              key={req.id}
              id={req.id}
              title={req.title}
              status={req.status}
              type={req.type}
              priority={req.priority}
              updatedAt={req.updatedAt}
              createdAt={req.createdAt}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Requests tab (full list) ───────────────────────────────────────────────────

function RequestsTab({ clientId }: { clientId: string }) {
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/requests?clientId=${clientId}&status=all`))
      const data = await res.json() as { requests: Request[] }
      setRequests(data.requests ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [clientId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="text-sm text-[var(--color-text-muted)]">Loading requests…</div>

  return (
    <>
    <NewRequestDialog
      open={dialogOpen}
      onClose={() => { setDialogOpen(false); void load() }}
      isAdmin={true}
      defaultOrgId={clientId}
    />
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">All requests</h2>
        <TahiButton variant="primary" size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New request
        </TahiButton>
      </div>

      {requests.length === 0 ? (
        <div className="text-center py-16 bg-[var(--color-bg-secondary)] rounded-xl">
          <FileText className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">No requests for this client yet</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {requests.map(req => (
            <RequestCard
              key={req.id}
              id={req.id}
              title={req.title}
              status={req.status}
              type={req.type}
              priority={req.priority}
              updatedAt={req.updatedAt}
              createdAt={req.createdAt}
            />
          ))}
        </div>
      )}
    </div>
    </>
  )
}

// ── Invoices tab ───────────────────────────────────────────────────────────────

interface InvoiceRow {
  id: string
  orgId: string
  orgName: string | null
  status: string
  totalAmount: number
  currency: string | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

const INVOICE_STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  draft:       { bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-muted)', dot: 'var(--color-text-subtle)' },
  sent:        { bg: 'var(--color-info-bg)', text: 'var(--color-info)', dot: 'var(--color-info)' },
  viewed:      { bg: 'var(--color-info-bg)', text: 'var(--color-info)', dot: 'var(--color-info)' },
  overdue:     { bg: 'var(--color-danger-bg)', text: 'var(--color-danger)', dot: 'var(--color-danger)' },
  paid:        { bg: 'var(--color-success-bg)', text: 'var(--color-success)', dot: 'var(--color-success)' },
  written_off: { bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-muted)', dot: 'var(--color-text-subtle)' },
}

function InvoicesTab({ clientId }: { clientId: string }) {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    setLoading(true)
    fetch(apiPath(`/api/admin/invoices?orgId=${clientId}`))
      .then(r => r.json() as Promise<{ items: InvoiceRow[] }>)
      .then(data => setInvoices(data.items ?? []))
      .catch(() => setInvoices([]))
      .finally(() => setLoading(false))
  }, [clientId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading invoices...
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">Invoices</h2>
        <TahiButton variant="primary" size="sm" onClick={() => router.push('/invoices')}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New invoice
        </TahiButton>
      </div>

      {invoices.length === 0 ? (
        <div className="text-center py-16 bg-[var(--color-bg-secondary)] rounded-xl">
          <DollarSign className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">No invoices for this client yet</p>
        </div>
      ) : (
        <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Currency</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Due date</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Created</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const styles = INVOICE_STATUS_STYLES[inv.status] ?? INVOICE_STATUS_STYLES.draft
                return (
                  <tr
                    key={inv.id}
                    className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-secondary)] cursor-pointer transition-colors"
                    onClick={() => router.push(`/invoices/${inv.id}`)}
                  >
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ background: styles.bg, color: styles.text }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: styles.dot }} />
                        {inv.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text)] font-medium">
                      ${(inv.totalAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {inv.currency ?? 'USD'}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {inv.dueDate
                        ? new Date(inv.dueDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '--'}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {new Date(inv.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Contacts tab ───────────────────────────────────────────────────────────────

function ContactsTab({
  clientId,
  contacts,
  onUpdated,
}: {
  clientId: string
  contacts: Contact[]
  onUpdated: () => void
}) {
  const router = useRouter()
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', role: '', isPrimary: false })
  const [startingDm, setStartingDm] = useState<string | null>(null)

  const handleStartDm = async (contact: Contact) => {
    setStartingDm(contact.id)
    try {
      const res = await fetch(apiPath('/api/admin/conversations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'direct',
          name: contact.name,
          orgId: clientId,
          visibility: 'external',
          participantIds: [{ id: contact.id, type: 'contact' }],
        }),
      })
      if (res.ok) {
        router.push('/messages')
      }
    } catch {
      // silent
    } finally {
      setStartingDm(null)
    }
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim() || !form.email.trim()) return
    setSaving(true)
    setFormError(null)

    try {
      const res = await fetch(apiPath(`/api/admin/clients/${clientId}/contacts`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setFormError(data.error ?? 'Failed to add contact')
        return
      }

      setForm({ name: '', email: '', role: '', isPrimary: false })
      setShowForm(false)
      onUpdated()
    } catch {
      setFormError('Network error. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">
          Contacts ({contacts.length})
        </h2>
        <TahiButton variant="primary" size="sm" onClick={() => setShowForm(s => !s)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add contact
        </TahiButton>
      </div>

      {/* Add contact form */}
      {showForm && (
        <form
          onSubmit={handleAdd}
          className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-5 mb-4"
        >
          <h3 className="font-medium text-sm text-[var(--color-text)] mb-3">New contact</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label htmlFor="contact-name" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Name <span className="text-[var(--color-danger)]">*</span>
              </label>
              <input
                id="contact-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                placeholder="Jane Smith"
                className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="contact-email" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Email <span className="text-[var(--color-danger)]">*</span>
              </label>
              <input
                id="contact-email"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
                placeholder="jane@example.com"
                className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
              />
            </div>
            <div>
              <label htmlFor="contact-role" className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Role
              </label>
              <input
                id="contact-role"
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                placeholder="e.g. Marketing Manager"
                className="w-full px-3 py-2 text-sm border border-[var(--color-border)] rounded-lg bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] focus:border-transparent"
              />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isPrimary}
                  onChange={e => setForm(f => ({ ...f, isPrimary: e.target.checked }))}
                  className="rounded border-[var(--color-border)] text-[var(--color-brand)] focus:ring-[var(--color-brand)]"
                />
                Primary contact
              </label>
            </div>
          </div>

          {formError && (
            <div aria-live="polite" className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg)] border border-[var(--color-danger)] rounded-lg px-3 py-2 mb-3">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <TahiButton variant="secondary" size="sm" onClick={() => { setShowForm(false); setFormError(null) }}>
              Cancel
            </TahiButton>
            <TahiButton variant="primary" size="sm" disabled={saving || !form.name.trim() || !form.email.trim()}>
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                  Saving...
                </>
              ) : (
                'Add contact'
              )}
            </TahiButton>
          </div>
        </form>
      )}

      {/* Contact list */}
      {contacts.length === 0 ? (
        <div className="text-center py-16 bg-[var(--color-bg-secondary)] rounded-xl">
          <Users className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">No contacts for this client yet</p>
          <p className="text-xs text-[var(--color-text-subtle)] mt-1">Add a contact to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {contacts.map(contact => (
            <div
              key={contact.id}
              className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-4 hover:border-[var(--color-brand)] transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center text-[var(--color-brand)] text-sm font-bold flex-shrink-0">
                  {contact.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-medium text-[var(--color-text)] truncate">
                      {contact.name}
                    </span>
                    {contact.isPrimary && (
                      <span className="text-xs text-[var(--color-brand)] bg-[var(--color-brand-50)] px-1.5 py-0.5 rounded-full">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] mt-1">
                    <Mail className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{contact.email}</span>
                  </div>
                  {contact.role && (
                    <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)] mt-0.5">
                      <User className="w-3 h-3 flex-shrink-0" />
                      {contact.role}
                    </div>
                  )}
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full',
                      contact.clerkUserId
                        ? 'bg-[var(--color-success-bg)] text-[var(--color-success)]'
                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-subtle)]'
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', contact.clerkUserId ? 'bg-emerald-400' : 'bg-[var(--color-border)]')} />
                      {contact.clerkUserId ? 'Portal access' : 'No portal access'}
                    </span>
                    <button
                      onClick={() => handleStartDm(contact)}
                      disabled={startingDm === contact.id}
                      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand)] hover:bg-[var(--color-brand-100)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                      aria-label={`Message ${contact.name}`}
                      style={{ minHeight: '1.375rem' }}
                    >
                      <MessageSquare className="w-3 h-3" aria-hidden="true" />
                      {startingDm === contact.id ? 'Opening...' : 'Message'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Files tab ─────────────────────────────────────────────────────────────────

interface FileRow {
  id: string
  filename: string
  mimeType: string | null
  sizeBytes: number | null
  requestId: string | null
  requestTitle?: string | null
  storageKey: string
  createdAt: string
}

// ── Track Queue tab ───────────────────────────────────────────────────────────

interface AdminTrackResponse {
  id: string
  type: 'small' | 'large'
  isPriorityTrack: number | boolean | null
  currentRequestId: string | null
  currentRequestTitle?: string | null
}

interface AdminQueuedRequest {
  id: string
  title: string
  type: string
  status: string
  priority: string
  queueOrder: number | null
  dueDate?: string | null
}

const TRACK_ACTIVE_STATUSES = new Set(['in_progress', 'in_review', 'client_review'])
const TRACK_QUEUED_STATUSES = new Set(['submitted', 'queued'])

function TrackQueueTab({ clientId }: { clientId: string }) {
  const [tracks, setTracks] = useState<TrackWithQueue[]>([])
  const [loading, setLoading] = useState(true)

  const fetchTracks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${clientId}/tracks`))
      if (!res.ok) { setTracks([]); return }
      const data = await res.json() as {
        tracks: AdminTrackResponse[]
        queue: AdminQueuedRequest[]
      }

      const trackMap = new Map<string, TrackWithQueue>()

      for (const t of data.tracks) {
        const active: TrackActiveRequest | null = t.currentRequestId
          ? {
              id: t.currentRequestId,
              title: t.currentRequestTitle ?? 'Untitled',
              type: 'small_task',
              status: 'in_progress',
              priority: 'medium',
            }
          : null

        trackMap.set(t.id, {
          id: t.id,
          type: t.type,
          isPriorityTrack: t.isPriorityTrack === 1 || t.isPriorityTrack === true,
          activeRequest: active,
          queue: [],
        })
      }

      // Distribute queued requests to eligible tracks
      for (const req of data.queue) {
        if (TRACK_QUEUED_STATUSES.has(req.status) || TRACK_ACTIVE_STATUSES.has(req.status)) {
          for (const track of trackMap.values()) {
            if (trackCanHandle(track.type, req.type)) {
              if (TRACK_ACTIVE_STATUSES.has(req.status) && !track.activeRequest) {
                track.activeRequest = {
                  id: req.id,
                  title: req.title,
                  type: req.type,
                  status: req.status,
                  priority: req.priority,
                  dueDate: req.dueDate,
                }
              } else {
                track.queue.push({
                  id: req.id,
                  title: req.title,
                  type: req.type,
                  priority: req.priority,
                  queueOrder: req.queueOrder,
                  dueDate: req.dueDate,
                })
              }
              break
            }
          }
        }
      }

      // Sort queues
      for (const track of trackMap.values()) {
        track.queue.sort((a, b) => (a.queueOrder ?? 9999) - (b.queueOrder ?? 9999))
      }

      // Large tracks first
      const sorted = [...trackMap.values()].sort((a, b) => {
        if (a.type === 'large' && b.type === 'small') return -1
        if (a.type === 'small' && b.type === 'large') return 1
        return 0
      })

      setTracks(sorted)
    } catch {
      setTracks([])
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { fetchTracks() }, [fetchTracks])

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map(i => (
          <div key={i} className="animate-pulse bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-6">
            <div className="h-5 w-32 rounded" style={{ background: 'var(--color-bg-tertiary)' }} />
            <div className="mt-4 h-16 rounded" style={{ background: 'var(--color-bg-tertiary)' }} />
          </div>
        ))}
      </div>
    )
  }

  if (tracks.length === 0) {
    return (
      <div className="text-center py-12">
        <div
          className="mx-auto w-14 h-14 flex items-center justify-center mb-4"
          style={{ borderRadius: '0 16px 0 16px', background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))' }}
        >
          <ListOrdered className="w-7 h-7 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-1">No tracks found</h3>
        <p className="text-sm text-[var(--color-text-muted)]">
          This client does not have any active tracks.
        </p>
      </div>
    )
  }

  return (
    <TrackQueueView
      tracks={tracks}
      basePath="/requests"
    />
  )
}

function FilesTab({ clientId }: { clientId: string }) {
  const [files, setFiles] = useState<FileRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    // Fetch requests for this client, then fetch files for each
    fetch(apiPath(`/api/admin/requests?clientId=${clientId}&status=all`))
      .then(r => r.json() as Promise<{ requests: { id: string; title: string }[] }>)
      .then(async data => {
        const reqs = data.requests ?? []
        const allFiles: FileRow[] = []
        // Fetch files for each request in parallel (batched)
        const results = await Promise.all(
          reqs.map(async req => {
            try {
              const res = await fetch(apiPath(`/api/admin/requests/${req.id}/files`))
              if (!res.ok) return []
              const json = await res.json() as { items: FileRow[] }
              return (json.items ?? []).map(f => ({ ...f, requestTitle: req.title }))
            } catch {
              return []
            }
          })
        )
        for (const batch of results) allFiles.push(...batch)
        allFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setFiles(allFiles)
      })
      .catch(() => setFiles([]))
      .finally(() => setLoading(false))
  }, [clientId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading files...
      </div>
    )
  }

  function formatSize(bytes: number | null): string {
    if (!bytes) return '--'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">Files ({files.length})</h2>
      </div>

      {files.length === 0 ? (
        <div className="text-center py-16 bg-[var(--color-bg-secondary)] rounded-xl">
          <File className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">No files uploaded for this client yet</p>
        </div>
      ) : (
        <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Name</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Type</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Size</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Request</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Uploaded</th>
                <th className="text-right px-4 py-3 font-medium text-[var(--color-text-muted)]"></th>
              </tr>
            </thead>
            <tbody>
              {files.map(file => (
                <tr key={file.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-secondary)] transition-colors">
                  <td className="px-4 py-3 text-[var(--color-text)] font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0" />
                      <span className="truncate max-w-[12.5rem]">{file.filename}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">
                    {file.mimeType?.split('/').pop() ?? '--'}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">
                    {formatSize(file.sizeBytes)}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">
                    {file.requestTitle ? (
                      <span className="truncate max-w-[10rem] inline-block">{file.requestTitle}</span>
                    ) : '--'}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">
                    {new Date(file.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <a
                      href={apiPath(`/api/uploads/serve/${file.storageKey}`)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:text-[var(--color-brand-dark)] font-medium"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Brands tab ────────────────────────────────────────────────────────────────

interface BrandRow {
  id: string
  name: string
  logoUrl: string | null
  website: string | null
  primaryColour: string | null
  notes: string | null
  contactCount: number
  requestCount: number
  createdAt: string
}

function BrandsTab({ clientId }: { clientId: string }) {
  const [brands, setBrands] = useState<BrandRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Create / Edit form state
  const [formName, setFormName] = useState('')
  const [formLogoUrl, setFormLogoUrl] = useState('')
  const [formWebsite, setFormWebsite] = useState('')
  const [formColour, setFormColour] = useState('#5A824E')
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/brands?orgId=${clientId}`))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as { items: BrandRow[] }
      setBrands(json.items ?? [])
    } catch {
      setBrands([])
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const resetForm = () => {
    setFormName('')
    setFormLogoUrl('')
    setFormWebsite('')
    setFormColour('#5A824E')
    setFormError(null)
    setShowCreate(false)
    setEditingId(null)
  }

  const openEdit = (brand: BrandRow) => {
    setEditingId(brand.id)
    setFormName(brand.name)
    setFormLogoUrl(brand.logoUrl ?? '')
    setFormWebsite(brand.website ?? '')
    setFormColour(brand.primaryColour ?? '#5A824E')
    setFormError(null)
    setShowCreate(false)
  }

  const handleSave = async () => {
    if (!formName.trim()) {
      setFormError('Brand name is required')
      return
    }
    setFormSaving(true)
    setFormError(null)
    try {
      const body = {
        name: formName.trim(),
        logoUrl: formLogoUrl.trim() || null,
        website: formWebsite.trim() || null,
        primaryColour: formColour || null,
        ...(editingId ? {} : { orgId: clientId }),
      }

      const url = editingId
        ? apiPath(`/api/admin/brands/${editingId}`)
        : apiPath('/api/admin/brands')
      const method = editingId ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setFormError(data.error ?? 'Failed to save brand')
        return
      }

      resetForm()
      void load()
    } catch {
      setFormError('Network error')
    } finally {
      setFormSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(apiPath(`/api/admin/brands/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      void load()
    } catch {
      // silently fail
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading brands...
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">Brands ({brands.length})</h2>
        <TahiButton
          size="sm"
          onClick={() => { resetForm(); setShowCreate(true) }}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add Brand
        </TahiButton>
      </div>

      {/* Create / Edit form */}
      {(showCreate || editingId) && (
        <div
          className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl mb-4"
          style={{ padding: '1.25rem' }}
        >
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">
            {editingId ? 'Edit Brand' : 'New Brand'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Name <span className="text-[var(--color-danger)]">*</span>
              </label>
              <input
                type="text"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="Brand name"
                className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  minHeight: '2.375rem',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Logo URL</label>
              <input
                type="url"
                value={formLogoUrl}
                onChange={e => setFormLogoUrl(e.target.value)}
                placeholder="https://..."
                className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  minHeight: '2.375rem',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Website</label>
              <input
                type="url"
                value={formWebsite}
                onChange={e => setFormWebsite(e.target.value)}
                placeholder="https://example.com"
                className="w-full text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-input)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  minHeight: '2.375rem',
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Primary Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={formColour}
                  onChange={e => setFormColour(e.target.value)}
                  style={{
                    width: '2.375rem',
                    height: '2.375rem',
                    padding: '0.125rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    cursor: 'pointer',
                  }}
                />
                <input
                  type="text"
                  value={formColour}
                  onChange={e => setFormColour(e.target.value)}
                  placeholder="#5A824E"
                  className="flex-1 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: 'var(--radius-input)',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    minHeight: '2.375rem',
                  }}
                />
              </div>
            </div>
          </div>

          {formError && (
            <p className="text-xs mt-2" style={{ color: 'var(--color-danger)' }}>{formError}</p>
          )}

          <div className="flex items-center gap-2 mt-4">
            <TahiButton size="sm" onClick={handleSave} disabled={formSaving}>
              {formSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : (
                <Check className="w-3.5 h-3.5 mr-1" />
              )}
              {editingId ? 'Save Changes' : 'Create Brand'}
            </TahiButton>
            <TahiButton variant="secondary" size="sm" onClick={resetForm}>
              Cancel
            </TahiButton>
          </div>
        </div>
      )}

      {brands.length === 0 && !showCreate ? (
        <div className="text-center py-16 bg-[var(--color-bg-secondary)] rounded-xl">
          <Palette className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">No brands for this client yet</p>
          <p className="text-xs text-[var(--color-text-subtle)] mt-1">
            Add brands to organise requests by sub-brand or product line.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {brands.map(brand => (
            <div
              key={brand.id}
              className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl transition-shadow"
              style={{
                padding: '1rem',
                boxShadow: hoveredId === brand.id ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
              }}
              onMouseEnter={() => setHoveredId(brand.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Logo + name row */}
              <div className="flex items-start gap-3 mb-3">
                {brand.logoUrl ? (
                  <img
                    src={brand.logoUrl}
                    alt={`${brand.name} logo`}
                    className="flex-shrink-0 rounded-lg object-contain"
                    style={{ width: '2.5rem', height: '2.5rem', border: '1px solid var(--color-border-subtle)' }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <div
                    className="flex-shrink-0 flex items-center justify-center rounded-lg"
                    style={{
                      width: '2.5rem',
                      height: '2.5rem',
                      background: brand.primaryColour ? `${brand.primaryColour}18` : 'var(--color-bg-tertiary)',
                      color: brand.primaryColour ?? 'var(--color-text-muted)',
                    }}
                  >
                    <Palette className="w-4 h-4" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text)] truncate">{brand.name}</p>
                  {brand.website && (
                    <a
                      href={brand.website.startsWith('http') ? brand.website : `https://${brand.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-brand)] truncate block"
                    >
                      {brand.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              </div>

              {/* Colour swatch */}
              {brand.primaryColour && (
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="rounded-full"
                    style={{
                      width: '1rem',
                      height: '1rem',
                      background: brand.primaryColour,
                      border: '1px solid var(--color-border-subtle)',
                    }}
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">{brand.primaryColour}</span>
                </div>
              )}

              {/* Stats row */}
              <div className="flex items-center gap-3 text-xs text-[var(--color-text-subtle)] mb-3">
                <span>{brand.requestCount} request{brand.requestCount !== 1 ? 's' : ''}</span>
                <span>{brand.contactCount} contact{brand.contactCount !== 1 ? 's' : ''}</span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openEdit(brand)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand)] hover:text-[var(--color-brand-dark)] transition-colors"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem 0' }}
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(brand.id)}
                  disabled={deletingId === brand.id}
                  className="inline-flex items-center gap-1 text-xs font-medium transition-colors"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: deletingId === brand.id ? 'not-allowed' : 'pointer',
                    padding: '0.25rem 0',
                    color: 'var(--color-text-subtle)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-danger)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                >
                  {deletingId === brand.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Contracts tab ─────────────────────────────────────────────────────────────

interface ContractRow {
  id: string
  type: string
  name: string
  status: string
  storageKey: string
  startDate: string | null
  expiryDate: string | null
  createdAt: string
}

const CONTRACT_TYPE_LABELS: Record<string, string> = {
  nda: 'NDA',
  sla: 'SLA',
  msa: 'MSA',
  sow: 'SOW',
  other: 'Other',
}

const CONTRACT_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  draft:     { bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-muted)' },
  sent:      { bg: 'var(--color-info-bg)', text: 'var(--color-info)' },
  signed:    { bg: 'var(--color-success-bg)', text: 'var(--color-success)' },
  expired:   { bg: 'var(--color-danger-bg)', text: 'var(--color-danger)' },
  cancelled: { bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-subtle)' },
}

function ContractsTab({ clientId }: { clientId: string }) {
  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/contracts?orgId=${clientId}`))
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as { items: ContractRow[] }
      setContracts(json.items ?? [])
    } catch {
      setContracts([])
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading contracts...
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">Contracts ({contracts.length})</h2>
      </div>

      {contracts.length === 0 ? (
        <div className="text-center py-16 bg-[var(--color-bg-secondary)] rounded-xl">
          <ScrollText className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">No contracts for this client yet</p>
          <p className="text-xs text-[var(--color-text-subtle)] mt-1">Upload contracts from the contracts page.</p>
        </div>
      ) : (
        <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Name</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Type</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Expiry</th>
                <th className="text-right px-4 py-3 font-medium text-[var(--color-text-muted)]"></th>
              </tr>
            </thead>
            <tbody>
              {contracts.map(contract => {
                const statusStyle = CONTRACT_STATUS_STYLES[contract.status] ?? CONTRACT_STATUS_STYLES.draft
                return (
                  <tr key={contract.id} className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-secondary)] transition-colors">
                    <td className="px-4 py-3 text-[var(--color-text)] font-medium">
                      <div className="flex items-center gap-2">
                        <ScrollText className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0" />
                        {contract.name}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]">
                        {CONTRACT_TYPE_LABELS[contract.type] ?? contract.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full capitalize"
                        style={{ background: statusStyle.bg, color: statusStyle.text }}
                      >
                        {contract.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)]">
                      {contract.expiryDate
                        ? new Date(contract.expiryDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
                        : '--'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={apiPath(`/api/uploads/serve/${contract.storageKey}`)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:text-[var(--color-brand-dark)] font-medium"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Calls tab ─────────────────────────────────────────────────────────────────

interface ScheduledCallRow {
  id: string
  title: string
  scheduledAt: string
  durationMinutes: number
  meetingUrl: string | null
  status: string
  notes: string | null
}

const CALL_STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  scheduled:  { bg: 'var(--color-info-bg)',    color: 'var(--color-info)',    label: 'Scheduled' },
  completed:  { bg: 'var(--color-success-bg)', color: 'var(--color-success)', label: 'Completed' },
  cancelled:  { bg: 'var(--color-bg-tertiary)',          color: 'var(--color-text-muted)',        label: 'Cancelled' },
  no_show:    { bg: 'var(--color-danger-bg)',   color: 'var(--color-danger)',   label: 'No Show' },
}

function CallsTab({ clientId, orgName }: { clientId: string; orgName: string }) {
  const [calls, setCalls] = useState<ScheduledCallRow[]>([])
  const [loadingCalls, setLoadingCalls] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formTime, setFormTime] = useState('10:00')
  const [formDuration, setFormDuration] = useState(30)
  const [formUrl, setFormUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchCalls = useCallback(async () => {
    setLoadingCalls(true)
    try {
      const res = await fetch(apiPath(`/api/admin/calls?orgId=${clientId}`))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { calls: ScheduledCallRow[] }
      setCalls(data.calls ?? [])
    } catch {
      setCalls([])
    } finally {
      setLoadingCalls(false)
    }
  }, [clientId])

  useEffect(() => { void fetchCalls() }, [fetchCalls])

  async function handleCreate() {
    if (!formTitle.trim() || !formDate) return
    setSubmitting(true)
    try {
      const scheduledAt = `${formDate}T${formTime}:00Z`
      await fetch(apiPath('/api/admin/calls'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: clientId,
          title: formTitle.trim(),
          scheduledAt,
          durationMinutes: formDuration,
          meetingUrl: formUrl.trim() || undefined,
        }),
      })
      setShowForm(false)
      setFormTitle('')
      setFormDate('')
      setFormTime('10:00')
      setFormDuration(30)
      setFormUrl('')
      await fetchCalls()
    } catch {
      // Create failed
    } finally {
      setSubmitting(false)
    }
  }

  async function updateCallStatus(callId: string, status: string) {
    try {
      await fetch(apiPath(`/api/admin/calls/${callId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await fetchCalls()
    } catch {
      // Update failed
    }
  }

  const upcoming = calls.filter(c => c.status === 'scheduled')
  const past = calls.filter(c => c.status !== 'scheduled')

  if (loadingCalls) return (
    <div className="animate-pulse space-y-3 py-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-16 bg-[var(--color-bg-tertiary)] rounded-xl" />
      ))}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-[var(--color-text)]">Scheduled Calls</h3>
        <TahiButton size="sm" onClick={() => setShowForm(!showForm)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
          Schedule Call
        </TahiButton>
      </div>

      {/* New call form */}
      {showForm && (
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="call-title" className="block text-sm font-medium text-[var(--color-text)] mb-1">Title</label>
              <input
                id="call-title"
                type="text"
                value={formTitle}
                onChange={e => setFormTitle(e.target.value)}
                placeholder="Monthly check-in"
                className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              />
            </div>
            <div>
              <label htmlFor="call-url" className="block text-sm font-medium text-[var(--color-text)] mb-1">Meeting URL</label>
              <input
                id="call-url"
                type="url"
                value={formUrl}
                onChange={e => setFormUrl(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              />
            </div>
            <div>
              <label htmlFor="call-date" className="block text-sm font-medium text-[var(--color-text)] mb-1">Date</label>
              <input
                id="call-date"
                type="date"
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
                className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="call-time" className="block text-sm font-medium text-[var(--color-text)] mb-1">Time</label>
                <input
                  id="call-time"
                  type="time"
                  value={formTime}
                  onChange={e => setFormTime(e.target.value)}
                  className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                />
              </div>
              <div className="w-24">
                <label htmlFor="call-duration" className="block text-sm font-medium text-[var(--color-text)] mb-1">Mins</label>
                <input
                  id="call-duration"
                  type="number"
                  value={formDuration}
                  onChange={e => setFormDuration(parseInt(e.target.value) || 30)}
                  min={15}
                  step={15}
                  className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <TahiButton variant="secondary" size="sm" onClick={() => setShowForm(false)}>Cancel</TahiButton>
            <TahiButton size="sm" onClick={handleCreate} disabled={submitting || !formTitle.trim() || !formDate}>
              {submitting ? 'Scheduling...' : 'Schedule'}
            </TahiButton>
          </div>
        </div>
      )}

      {/* Upcoming calls */}
      {upcoming.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-[var(--color-text-muted)] mb-2">Upcoming</h4>
          <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-hidden divide-y divide-[var(--color-border-subtle)]">
            {upcoming.map(call => (
              <CallRow key={call.id} call={call} onStatusChange={updateCallStatus} />
            ))}
          </div>
        </div>
      )}

      {/* Past calls */}
      {past.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-[var(--color-text-muted)] mb-2">Past</h4>
          <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-hidden divide-y divide-[var(--color-border-subtle)]">
            {past.map(call => (
              <CallRow key={call.id} call={call} onStatusChange={updateCallStatus} />
            ))}
          </div>
        </div>
      )}

      {calls.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Video className="w-10 h-10 text-[var(--color-text-subtle)] mb-3" />
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">No calls scheduled</h3>
          <p className="text-xs text-[var(--color-text-muted)]">Schedule a call with {orgName} to get started.</p>
        </div>
      )}
    </div>
  )
}

function CallRow({ call, onStatusChange }: { call: ScheduledCallRow; onStatusChange: (id: string, status: string) => void }) {
  const style = CALL_STATUS_STYLES[call.status] ?? CALL_STATUS_STYLES.scheduled
  const callDate = new Date(call.scheduledAt)
  const isUpcoming = call.status === 'scheduled'

  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="flex-shrink-0">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: style.bg, color: style.color }}
        >
          <Video style={{ width: '1.125rem', height: '1.125rem' }} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-text)] truncate">{call.title}</p>
        <p className="text-xs text-[var(--color-text-muted)]">
          {callDate.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
          {' at '}
          {callDate.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}
          {' '}
          ({call.durationMinutes}min)
        </p>
      </div>
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
        style={{ background: style.bg, color: style.color }}
      >
        {style.label}
      </span>
      {call.meetingUrl && (
        <a
          href={call.meetingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-brand)] transition-colors"
          aria-label="Open meeting link"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
      )}
      {isUpcoming && (
        <div className="flex-shrink-0 relative">
          <select
            onChange={e => { if (e.target.value) { onStatusChange(call.id, e.target.value); e.target.value = '' } }}
            defaultValue=""
            className="text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            aria-label="Change call status"
          >
            <option value="" disabled>Mark as...</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
          </select>
        </div>
      )}
    </div>
  )
}

// ── Messages tab ──────────────────────────────────────────────────────────────

function MessagesTab({ orgName }: { clientId: string; orgName: string }) {
  const router = useRouter()

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">Messages</h2>
        <TahiButton variant="primary" size="sm" onClick={() => router.push('/messages')}>
          <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
          Open Messages
        </TahiButton>
      </div>

      <div className="flex flex-col items-center justify-center py-16 bg-[var(--color-bg-secondary)] rounded-xl text-center">
        <MessageSquare className="w-10 h-10 text-[var(--color-text-subtle)] mb-3" />
        <h3 className="text-sm font-semibold text-[var(--color-text)] mb-1">
          Conversations with {orgName}
        </h3>
        <p className="text-xs text-[var(--color-text-muted)] max-w-xs">
          Open the messaging page to view and manage conversations with this client.
        </p>
      </div>
    </div>
  )
}

// ── Time tab ──────────────────────────────────────────────────────────────────

interface TimeEntryRow {
  id: string
  hours: number
  billable: boolean | null
  notes: string | null
  date: string
  teamMemberName: string | null
  requestTitle: string | null
}

function TimeTab({ clientId }: { clientId: string }) {
  const [entries, setEntries] = useState<TimeEntryRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(apiPath(`/api/admin/time?orgId=${clientId}`))
      .then(r => r.json() as Promise<{ items: TimeEntryRow[] }>)
      .then(data => setEntries(data.items ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [clientId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading time entries...
      </div>
    )
  }

  const totalHours = entries.reduce((s, e) => s + e.hours, 0)
  const billableHours = entries.filter(e => e.billable).reduce((s, e) => s + e.hours, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">
          Time Entries ({entries.length})
        </h2>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--color-text-muted)]">
            Total: <strong className="text-[var(--color-text)]">{totalHours.toFixed(1)}h</strong>
          </span>
          <span className="text-[var(--color-text-muted)]">
            Billable: <strong style={{ color: 'var(--color-brand)' }}>{billableHours.toFixed(1)}h</strong>
          </span>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-16 bg-[var(--color-bg-secondary)] rounded-xl">
          <Clock className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">No time entries for this client yet</p>
        </div>
      ) : (
        <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Date</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden sm:table-cell">Team Member</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Hours</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Billable</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden md:table-cell">Notes</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr
                  key={entry.id}
                  className="border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                >
                  <td className="px-4 py-3 text-[var(--color-text-muted)]">
                    {new Date(entry.date.includes('T') ? entry.date : entry.date + 'T00:00:00').toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text)] font-medium hidden sm:table-cell">
                    {entry.teamMemberName ?? 'Unknown'}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text)] font-semibold">
                    {entry.hours.toFixed(1)}h
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                      style={{
                        background: entry.billable ? 'var(--color-success-bg)' : 'var(--color-bg-tertiary)',
                        color: entry.billable ? 'var(--color-success)' : 'var(--color-text-muted)',
                      }}
                    >
                      {entry.billable ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)] max-w-[12.5rem] truncate hidden md:table-cell">
                    {entry.notes ?? '--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Deals tab ─────────────────────────────────────────────────────────────────

interface DealRow {
  id: string
  title: string
  orgId: string | null
  stageId: string
  ownerId: string | null
  value: number
  currency: string
  expectedCloseDate: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
  orgName: string | null
  stageName: string | null
  stageColour: string | null
  stageProbability: number | null
  stageIsClosedWon: number | null
  stageIsClosedLost: number | null
  ownerName: string | null
  ownerAvatarUrl: string | null
  contactCount: number
}

const DEAL_STAGE_FALLBACK = { bg: 'var(--color-bg-tertiary)', text: 'var(--color-text)' }

function DealsTab({ clientId, orgName }: { clientId: string; orgName: string }) {
  const [deals, setDeals] = useState<DealRow[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    setLoading(true)
    fetch(apiPath(`/api/admin/deals?orgId=${clientId}`))
      .then(r => r.json() as Promise<{ items: DealRow[] }>)
      .then(data => setDeals(data.items ?? []))
      .catch(() => setDeals([]))
      .finally(() => setLoading(false))
  }, [clientId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading deals...
      </div>
    )
  }

  const totalValue = deals.reduce((s, d) => s + d.value, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">
          Deals ({deals.length})
          {deals.length > 0 && (
            <span className="text-sm font-normal text-[var(--color-text-muted)] ml-2">
              Total: ${totalValue.toLocaleString('en-US')}
            </span>
          )}
        </h2>
        <TahiButton variant="primary" size="sm" onClick={() => router.push('/pipeline')}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          New Deal
        </TahiButton>
      </div>

      {deals.length === 0 ? (
        <div className="text-center py-16 bg-[var(--color-bg-secondary)] rounded-xl">
          <Handshake className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">No deals for {orgName} yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {deals.map((deal, i) => {
            // Use shared stageColour() so a deal's stage chip matches the
            // Pipeline board and the Reports charts for the same stage.
            const stageColor = stageColour(deal.stageName, i)
            const isWon = deal.stageIsClosedWon === 1
            const isLost = deal.stageIsClosedLost === 1
            return (
              <div
                key={deal.id}
                className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl cursor-pointer hover:border-[var(--color-brand)] transition-colors"
                style={{ padding: '1.25rem' }}
                onClick={() => router.push(`/pipeline?deal=${deal.id}`)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-semibold text-[var(--color-text)] truncate mr-2">
                    {deal.title}
                  </h3>
                  <span
                    className="inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{
                      background: isWon ? 'var(--color-success-bg)' : isLost ? 'var(--color-danger-bg)' : `${stageColor}18`,
                      color: isWon ? 'var(--color-brand)' : isLost ? 'var(--color-danger)' : stageColor,
                    }}
                  >
                    {deal.stageName ?? 'Unknown'}
                  </span>
                </div>

                <p className="text-lg font-bold text-[var(--color-text)] mb-2">
                  ${deal.value.toLocaleString('en-US')}
                  <span className="text-xs font-normal text-[var(--color-text-muted)] ml-1">
                    {deal.currency}
                  </span>
                </p>

                <div className="flex items-center gap-4 text-xs text-[var(--color-text-muted)]">
                  {deal.ownerName && (
                    <span className="flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {deal.ownerName}
                    </span>
                  )}
                  {deal.expectedCloseDate && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(deal.expectedCloseDate).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                    </span>
                  )}
                  {deal.contactCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {deal.contactCount}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── CRM Activities tab ────────────────────────────────────────────────────────

interface CrmActivityRow {
  id: string
  type: string
  title: string
  description: string | null
  scheduledAt: string | null
  completedAt: string | null
  durationMinutes: number | null
  outcome: string | null
  createdAt: string
  createdByName: string | null
}

// Activity types are categorical, not semantic statuses.
// Using the --status-* tokens for their distinct palette (blue / teal /
// purple / brand) without triggering "warning"/"danger" perception.
const ACTIVITY_TYPE_ICONS: Record<string, { icon: typeof Phone; color: string; bg: string }> = {
  call:    { icon: Phone,          color: 'var(--status-submitted-text)',    bg: 'var(--status-submitted-bg)'    }, // blue
  meeting: { icon: Video,          color: 'var(--status-client-review-text)',bg: 'var(--status-client-review-bg)' }, // purple
  email:   { icon: Mail,           color: 'var(--status-in-progress-text)',  bg: 'var(--status-in-progress-bg)'  }, // teal
  note:    { icon: FileText,       color: 'var(--color-text-muted)',         bg: 'var(--color-bg-secondary)'     }, // muted
  task:    { icon: Check,          color: 'var(--color-brand)',              bg: 'var(--color-brand-50)'         }, // brand green
}

const ACTIVITY_TYPE_FALLBACK = { icon: Activity, color: 'var(--color-text-muted)', bg: 'var(--color-bg-secondary)' }

function CrmActivitiesTab({ clientId }: { clientId: string }) {
  const [items, setItems] = useState<CrmActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ type: 'note', title: '', description: '' })

  const fetchActivities = useCallback(() => {
    setLoading(true)
    fetch(apiPath(`/api/admin/activities?orgId=${clientId}`))
      .then(r => r.json() as Promise<{ items: CrmActivityRow[] }>)
      .then(data => setItems(data.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [clientId])

  useEffect(() => { fetchActivities() }, [fetchActivities])

  const handleSubmit = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    try {
      const res = await fetch(apiPath('/api/admin/activities'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: form.type,
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          orgId: clientId,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      setForm({ type: 'note', title: '', description: '' })
      setShowForm(false)
      fetchActivities()
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading activities...
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">
          CRM Activities ({items.length})
        </h2>
        <TahiButton variant="primary" size="sm" onClick={() => setShowForm(!showForm)}>
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Log Activity
        </TahiButton>
      </div>

      {/* Quick-add form */}
      {showForm && (
        <div
          className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl mb-4"
          style={{ padding: '1.25rem' }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Type</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text)]"
              >
                <option value="note">Note</option>
                <option value="call">Call</option>
                <option value="meeting">Meeting</option>
                <option value="email">Email</option>
                <option value="task">Task</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Activity title"
                className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text)]"
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Description (optional)</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              placeholder="Add notes..."
              className="w-full border border-[var(--color-border)] rounded-lg px-3 py-2 text-sm bg-[var(--color-bg)] text-[var(--color-text)] resize-none"
            />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <TahiButton variant="secondary" size="sm" onClick={() => setShowForm(false)}>
              Cancel
            </TahiButton>
            <TahiButton variant="primary" size="sm" onClick={handleSubmit} disabled={saving || !form.title.trim()}>
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Save
            </TahiButton>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="text-center py-16 bg-[var(--color-bg-secondary)] rounded-xl">
          <CalendarDays className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">No CRM activities for this client yet</p>
        </div>
      ) : (
        <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)]">
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {items.map(item => {
              const typeConfig = ACTIVITY_TYPE_ICONS[item.type] ?? ACTIVITY_TYPE_FALLBACK
              const Icon = typeConfig.icon
              return (
                <div key={item.id} className="px-4 py-3 flex items-start gap-3 hover:bg-[var(--color-bg-secondary)] transition-colors">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: typeConfig.bg }}
                  >
                    <Icon className="w-3.5 h-3.5" style={{ color: typeConfig.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-[var(--color-text)] truncate">{item.title}</p>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                        style={{ background: typeConfig.bg, color: typeConfig.color }}
                      >
                        {item.type}
                      </span>
                    </div>
                    {item.description && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{item.description}</p>
                    )}
                    {item.createdByName && (
                      <p className="text-xs text-[var(--color-text-subtle)] mt-0.5">by {item.createdByName}</p>
                    )}
                  </div>
                  <span className="text-xs text-[var(--color-text-subtle)] flex-shrink-0 whitespace-nowrap">
                    {new Date(item.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Revenue tab ───────────────────────────────────────────────────────────────

interface RevenueInvoice {
  id: string
  totalAmount: number
  currency: string | null
  status: string
}

interface RevenueTimeEntry {
  id: string
  hours: number
  billable: boolean | null
}

function RevenueTab({ clientId }: { clientId: string }) {
  const [invoices, setInvoices] = useState<RevenueInvoice[]>([])
  const [timeEntries, setTimeEntries] = useState<RevenueTimeEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(apiPath(`/api/admin/invoices?orgId=${clientId}`))
        .then(r => r.json() as Promise<{ items: RevenueInvoice[] }>)
        .then(d => d.items ?? [])
        .catch(() => [] as RevenueInvoice[]),
      fetch(apiPath(`/api/admin/time?orgId=${clientId}`))
        .then(r => r.json() as Promise<{ items: RevenueTimeEntry[] }>)
        .then(d => d.items ?? [])
        .catch(() => [] as RevenueTimeEntry[]),
    ]).then(([inv, time]) => {
      setInvoices(inv)
      setTimeEntries(time)
    }).finally(() => setLoading(false))
  }, [clientId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading revenue data...
      </div>
    )
  }

  const totalInvoiced = invoices.reduce((s, i) => s + (i.totalAmount ?? 0), 0)
  const paidInvoices = invoices.filter(i => i.status === 'paid')
  const totalPaid = paidInvoices.reduce((s, i) => s + (i.totalAmount ?? 0), 0)
  const outstandingInvoices = invoices.filter(i => i.status === 'sent' || i.status === 'overdue')
  const totalOutstanding = outstandingInvoices.reduce((s, i) => s + (i.totalAmount ?? 0), 0)

  const totalHours = timeEntries.reduce((s, e) => s + e.hours, 0)
  const billableHours = timeEntries.filter(e => e.billable).reduce((s, e) => s + e.hours, 0)
  // Estimate cost at $50/hr for LTV calculation
  const HOURLY_RATE = 50
  const estimatedTimeCost = billableHours * HOURLY_RATE

  // LTV = total paid + outstanding (expected revenue)
  const ltv = totalPaid + totalOutstanding

  const statCards = [
    {
      label: 'Total Invoiced',
      value: `$${totalInvoiced.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      detail: `${invoices.length} invoices`,
      icon: DollarSign,
      color: 'var(--color-brand)',
      bg: 'var(--color-brand-50)',
    },
    {
      label: 'Total Paid',
      value: `$${totalPaid.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      detail: `${paidInvoices.length} paid`,
      icon: Check,
      color: 'var(--color-brand)',
      bg: 'var(--color-success-bg)',
    },
    {
      label: 'Outstanding',
      value: `$${totalOutstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      detail: `${outstandingInvoices.length} unpaid`,
      icon: AlertTriangle,
      color: totalOutstanding > 0 ? 'var(--color-warning)' : 'var(--color-text-muted)',
      bg: totalOutstanding > 0 ? 'var(--color-warning-bg)' : 'var(--color-bg-secondary)',
    },
    {
      label: 'Billable Hours',
      value: `${billableHours.toFixed(1)}h`,
      detail: `${totalHours.toFixed(1)}h total`,
      icon: Clock,
      color: 'var(--color-info)',
      bg: 'var(--color-info-bg)',
    },
    {
      label: 'Estimated Time Cost',
      value: `$${estimatedTimeCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      detail: `at $${HOURLY_RATE}/hr`,
      icon: TrendingUp,
      color: 'var(--status-client-review-text)',
      bg: 'var(--status-client-review-bg)',
    },
    {
      label: 'Lifetime Value (LTV)',
      value: `$${ltv.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      detail: 'paid + outstanding',
      icon: TrendingUp,
      color: 'var(--color-brand)',
      bg: 'var(--color-brand-50)',
    },
  ]

  return (
    <div>
      <h2 className="font-semibold text-[var(--color-text)] mb-4">Revenue Summary</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map(card => {
          const Icon = card.icon
          return (
            <div
              key={card.label}
              className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl"
              style={{ padding: '1.25rem' }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: card.bg }}
                >
                  <Icon className="w-5 h-5" style={{ color: card.color }} />
                </div>
                <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                  {card.label}
                </span>
              </div>
              <p className="text-xl font-bold text-[var(--color-text)]">{card.value}</p>
              <p className="text-xs text-[var(--color-text-subtle)] mt-1">{card.detail}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Profitability tab (T595) ─────────────────────────────────────────────────
// Shows gross margin for this client (revenue minus costs including
// billable time × default hourly rate + logged client_costs). Includes a
// form to add cost entries.

interface ProfitabilityData {
  orgId: string
  orgName: string
  hourlyRateNzd: number
  revenueNzd: number
  costNzd: number
  marginNzd: number
  marginPct: number
  byCategory: Record<string, number>
  timeCost: { hours: number; rate: number; cost: number }
  byMonth: Array<{ month: string; revenue: number; cost: number; margin: number }>
}

interface ClientCostRow {
  id: string
  description: string
  amount: number
  currency: string
  category: 'contractor' | 'software' | 'hours' | 'other'
  date: string
  recurring: boolean
}

function ProfitabilityTab({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ProfitabilityData | null>(null)
  const [costs, setCosts] = useState<ClientCostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    description: '',
    amount: '',
    currency: 'NZD',
    category: 'other' as ClientCostRow['category'],
    date: new Date().toISOString().slice(0, 10),
    recurring: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [profitRes, costsRes] = await Promise.all([
        fetch(apiPath(`/api/admin/clients/${clientId}/profitability`)).then(r => r.ok ? r.json() : Promise.reject()),
        fetch(apiPath(`/api/admin/clients/${clientId}/costs`)).then(r => r.ok ? r.json() : Promise.reject()),
      ])
      setData(profitRes as ProfitabilityData)
      setCosts(((costsRes as { costs?: ClientCostRow[] }).costs) ?? [])
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { loadAll() }, [loadAll])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const amount = parseFloat(form.amount)
    if (!form.description.trim() || !Number.isFinite(amount)) {
      setError('Description and a numeric amount are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${clientId}/costs`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: form.description.trim(),
          amount,
          currency: form.currency,
          category: form.category,
          date: form.date,
          recurring: form.recurring,
        }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        setError(json.error ?? 'Failed to save cost')
        return
      }
      setForm({
        description: '', amount: '', currency: form.currency, category: 'other',
        date: new Date().toISOString().slice(0, 10), recurring: false,
      })
      setShowAdd(false)
      await loadAll()
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(costId: string) {
    if (!confirm('Delete this cost entry?')) return
    try {
      await fetch(apiPath(`/api/admin/clients/${clientId}/costs/${costId}`), { method: 'DELETE' })
      await loadAll()
    } catch { /* noop */ }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading profitability data...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-xl border p-6 bg-[var(--color-bg)]" style={{ borderColor: 'var(--color-border)' }}>
        <p className="text-sm text-[var(--color-text-muted)]">Unable to load profitability data.</p>
      </div>
    )
  }

  const nzd = (n: number) => new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(n)
  const marginColour = data.marginPct >= 50 ? 'var(--color-brand)'
    : data.marginPct >= 25 ? 'var(--color-warning)'
    : 'var(--color-danger)'

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border p-4" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
          <div className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Revenue (paid)</div>
          <div className="text-xl font-bold text-[var(--color-text)] mt-1">{nzd(data.revenueNzd)}</div>
        </div>
        <div className="rounded-xl border p-4" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
          <div className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Total cost</div>
          <div className="text-xl font-bold text-[var(--color-text)] mt-1">{nzd(data.costNzd)}</div>
          <div className="text-xs text-[var(--color-text-subtle)] mt-0.5">
            {data.timeCost.hours.toFixed(1)}h × ${data.timeCost.rate}/h = {nzd(data.timeCost.cost)}
          </div>
        </div>
        <div className="rounded-xl border p-4" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
          <div className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Gross margin</div>
          <div className="text-xl font-bold mt-1" style={{ color: marginColour }}>{nzd(data.marginNzd)}</div>
        </div>
        <div className="rounded-xl border p-4" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
          <div className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">Margin %</div>
          <div className="text-xl font-bold mt-1" style={{ color: marginColour }}>
            {data.marginPct.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* By category */}
      <div className="rounded-xl border p-5" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-3">Cost breakdown</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {(['contractor', 'software', 'hours', 'other', 'timeCost'] as const).map(cat => (
            <div key={cat} className="rounded-lg p-3" style={{ background: 'var(--color-bg-secondary)' }}>
              <div className="text-xs text-[var(--color-text-muted)] capitalize">{cat === 'timeCost' ? 'Time (hours × rate)' : cat}</div>
              <div className="text-sm font-semibold text-[var(--color-text)] mt-1">
                {nzd(data.byCategory[cat] ?? 0)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Costs list + add form */}
      <div className="rounded-xl border p-5" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[var(--color-text)]">Logged costs</h3>
          <button
            onClick={() => setShowAdd(v => !v)}
            className="text-xs font-medium px-3 py-1.5 rounded transition-colors"
            style={{ background: showAdd ? 'var(--color-bg-tertiary)' : 'var(--color-brand)', color: showAdd ? 'var(--color-text)' : 'white', border: 'none', cursor: 'pointer', minHeight: '2.25rem' }}
          >
            {showAdd ? 'Cancel' : '+ Add cost'}
          </button>
        </div>

        {showAdd && (
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 p-3 rounded" style={{ background: 'var(--color-bg-secondary)' }}>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Description</label>
              <input
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Webflow Pro plan, designer subcontract"
                className="w-full px-3 py-2 text-sm border rounded-lg"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Amount</label>
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full px-3 py-2 text-sm border rounded-lg"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Currency</label>
              <select
                value={form.currency}
                onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                className="w-full px-3 py-2 text-sm border rounded-lg"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              >
                {['NZD', 'USD', 'GBP', 'EUR', 'AUD'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Category</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value as ClientCostRow['category'] }))}
                className="w-full px-3 py-2 text-sm border rounded-lg"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              >
                <option value="contractor">Contractor</option>
                <option value="software">Software</option>
                <option value="hours">Hours (manual)</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 text-sm border rounded-lg"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
              />
            </div>
            <div className="flex items-center gap-2 md:col-span-2">
              <label className="flex items-center gap-2 text-sm text-[var(--color-text)]">
                <input type="checkbox" checked={form.recurring} onChange={e => setForm(f => ({ ...f, recurring: e.target.checked }))} />
                Recurring monthly cost
              </label>
            </div>
            {error && <p className="text-sm md:col-span-2" style={{ color: 'var(--color-danger)' }}>{error}</p>}
            <div className="md:col-span-2 flex justify-end">
              <button type="submit" disabled={saving} className="text-sm font-medium px-4 py-2 rounded disabled:opacity-50"
                style={{ background: 'var(--color-brand)', color: 'white', border: 'none', cursor: saving ? 'wait' : 'pointer' }}>
                {saving ? 'Saving...' : 'Save cost'}
              </button>
            </div>
          </form>
        )}

        {costs.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] py-4">
            No costs logged yet. Add subcontractor fees, software subscriptions, or other client-specific costs to compute real gross margin.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-[var(--color-text-muted)] border-b" style={{ borderColor: 'var(--color-border)' }}>
                <th className="py-2 pr-3">Date</th>
                <th className="py-2 pr-3">Description</th>
                <th className="py-2 pr-3">Category</th>
                <th className="py-2 pr-3 text-right">Amount</th>
                <th className="py-2 pr-3">Recurring?</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {costs.map(c => (
                <tr key={c.id} className="border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
                  <td className="py-2 pr-3 text-[var(--color-text-muted)]">{c.date}</td>
                  <td className="py-2 pr-3 text-[var(--color-text)]">{c.description}</td>
                  <td className="py-2 pr-3 text-xs text-[var(--color-text-muted)] capitalize">{c.category}</td>
                  <td className="py-2 pr-3 text-right text-[var(--color-text)] font-medium">
                    {new Intl.NumberFormat('en-NZ', { style: 'currency', currency: c.currency }).format(c.amount)}
                  </td>
                  <td className="py-2 pr-3">{c.recurring && <span className="text-xs text-[var(--color-brand)] font-medium">Recurring</span>}</td>
                  <td className="py-2 pr-3 text-right">
                    <button onClick={() => handleDelete(c.id)} className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Activity tab ──────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string
  action: string
  entityType: string | null
  createdAt: string
  details: string | null
}

function ActivityTab({ clientId }: { clientId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(apiPath(`/api/admin/audit-log?orgId=${clientId}&limit=50`))
      .then(r => r.json() as Promise<{ items: AuditEntry[] }>)
      .then(data => setEntries(data.items ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [clientId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] py-8">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading activity...
      </div>
    )
  }

  return (
    <div>
      <h2 className="font-semibold text-[var(--color-text)] mb-4">Activity Log</h2>

      {entries.length === 0 ? (
        <div className="text-center py-16 bg-[var(--color-bg-secondary)] rounded-xl">
          <Activity className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
          <p className="text-sm text-[var(--color-text-muted)]">No activity recorded for this client yet</p>
        </div>
      ) : (
        <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] overflow-x-auto">
          <div className="divide-y divide-[var(--color-border-subtle)]">
            {entries.map(entry => (
              <div key={entry.id} className="px-4 py-3 flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-bg-tertiary)] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Activity className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--color-text)]">{entry.action}</p>
                  {entry.details && (
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{entry.details}</p>
                  )}
                </div>
                <span className="text-xs text-[var(--color-text-subtle)] flex-shrink-0 whitespace-nowrap">
                  {new Date(entry.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Loading skeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="p-6 animate-pulse">
      <div className="h-8 bg-[var(--color-bg-tertiary)] rounded-lg w-64 mb-4" />
      <div className="h-4 bg-[var(--color-bg-tertiary)] rounded w-32 mb-6" />
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <div className="h-48 bg-[var(--color-bg-tertiary)] rounded-xl" />
          <div className="h-64 bg-[var(--color-bg-tertiary)] rounded-xl" />
        </div>
        <div className="space-y-4">
          <div className="h-40 bg-[var(--color-bg-tertiary)] rounded-xl" />
          <div className="h-32 bg-[var(--color-bg-tertiary)] rounded-xl" />
        </div>
      </div>
    </div>
  )
}
