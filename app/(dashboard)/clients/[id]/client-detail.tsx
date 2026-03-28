'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import {
  ArrowLeft,
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
} from 'lucide-react'
import { StatusBadge, PlanBadge, HealthDot } from '@/components/tahi/status-badge'
import { TrackMeter } from '@/components/tahi/track-meter'
import { TahiButton } from '@/components/tahi/tahi-button'
import { RequestCard } from '@/components/tahi/request-card'
import { NewRequestDialog } from '@/components/tahi/new-request-dialog'
import { cn } from '@/lib/utils'

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
  { id: 'overview',  label: 'Overview',  icon: Building2 },
  { id: 'requests',  label: 'Requests',  icon: Layers },
  { id: 'invoices',  label: 'Invoices',  icon: DollarSign },
  { id: 'contacts',  label: 'Contacts',  icon: Users },
  { id: 'messages',  label: 'Messages',  icon: MessageSquare },
  { id: 'time',      label: 'Time',      icon: Clock },
  { id: 'activity',  label: 'Activity',  icon: Activity },
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
  }, [clientId, router])

  useEffect(() => { void load() }, [load])

  if (loading) return <LoadingSkeleton />
  if (!data) return null

  const { org, contacts, subscription, tracks, recentRequests } = data

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="px-6 pt-5 pb-0">
          {/* Back + title row */}
          <div className="flex items-start gap-3 mb-4">
            <button
              onClick={() => router.push('/clients')}
              className="mt-0.5 p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold text-[var(--color-text)] truncate">
                  {org.name}
                </h1>
                <HealthDot health={org.healthStatus} className="w-2.5 h-2.5" />
                <StatusBadge status={org.status} type="org" />
                <PlanBadge plan={org.planType} />
              </div>

              {org.website && (
                <a
                  href={org.website.startsWith('http') ? org.website : `https://${org.website}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-brand)] mt-0.5"
                >
                  <Globe className="w-3.5 h-3.5" />
                  {org.website.replace(/^https?:\/\//, '')}
                </a>
              )}
            </div>

            <TahiButton variant="secondary" size="sm" onClick={load}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Refresh
            </TahiButton>
          </div>

          {/* Track meter in header for quick glance */}
          {tracks.length > 0 && (
            <div className="mb-3">
              <TrackMeter tracks={tracks} />
            </div>
          )}

          {/* Tab nav */}
          <nav className="flex gap-0 -mb-px">
            {TABS.map(tab => {
              const Icon = tab.icon
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                    isActive
                      ? 'border-[var(--color-brand)] text-[var(--color-brand)]'
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border)]'
                  )}
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
      <div className="flex-1 overflow-auto p-6">
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
        {activeTab === 'invoices' && (
          <InvoicesTab clientId={clientId} />
        )}
        {activeTab === 'contacts' && (
          <ContactsTab clientId={clientId} contacts={contacts} onUpdated={load} />
        )}
        {activeTab === 'messages' && (
          <PlaceholderTab label="Messages" description="Org-level messaging coming in Phase 2." />
        )}
        {activeTab === 'time' && (
          <PlaceholderTab label="Time" description="Time tracking coming soon." />
        )}
        {activeTab === 'activity' && (
          <PlaceholderTab label="Activity" description="Audit log coming in Phase 4." />
        )}
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
          <SubscriptionCard subscription={subscription} tracks={tracks} />
        )}
        {!subscription && <NoSubscriptionCard planType={org.planType} />}
        {org.healthNote && <HealthNoteCard note={org.healthNote} health={org.healthStatus} />}
        <InternalNotesCard org={org} onUpdated={onUpdated} />
      </div>
    </div>
  )
}

// ── Org details card (editable) ────────────────────────────────────────────────

function OrgDetailsCard({ org, onUpdated }: { org: Organisation; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: org.name,
    website: org.website ?? '',
    industry: org.industry ?? '',
    status: org.status,
    healthStatus: org.healthStatus ?? 'green',
    healthNote: org.healthNote ?? '',
  })

  const save = async () => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/clients/${org.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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
              onClick={() => { setEditing(false); setForm({ name: org.name, website: org.website ?? '', industry: org.industry ?? '', status: org.status, healthStatus: org.healthStatus ?? 'green', healthNote: org.healthNote ?? '' }) }}
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

function SubscriptionCard({ subscription, tracks }: { subscription: Subscription; tracks: Track[] }) {
  return (
    <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-5">
      <h3 className="font-semibold text-sm text-[var(--color-text)] mb-3">Subscription</h3>

      <div className="flex items-center gap-2 mb-3">
        <PlanBadge plan={subscription.planType} />
        <StatusBadge status={subscription.status} type="org" />
      </div>

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

      <div className="pt-3 border-t border-[var(--color-border)]">
        <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">Tracks</p>
        <TrackMeter tracks={tracks} />
      </div>
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
  sent:        { bg: 'var(--color-info-bg, #eff6ff)', text: 'var(--color-info, #60a5fa)', dot: 'var(--color-info, #60a5fa)' },
  viewed:      { bg: 'var(--color-info-bg, #eff6ff)', text: 'var(--color-info, #60a5fa)', dot: 'var(--color-info, #60a5fa)' },
  overdue:     { bg: 'var(--color-danger-bg, #fef2f2)', text: 'var(--color-danger, #f87171)', dot: 'var(--color-danger, #f87171)' },
  paid:        { bg: 'var(--color-success-bg, #f0fdf4)', text: 'var(--color-success, #4ade80)', dot: 'var(--color-success, #4ade80)' },
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
        <div className="bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] overflow-hidden">
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
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', email: '', role: '', isPrimary: false })

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
            <div aria-live="polite" className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg,#fef2f2)] border border-[var(--color-danger)] rounded-lg px-3 py-2 mb-3">
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
                  <div className="mt-1.5">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full',
                      contact.clerkUserId
                        ? 'bg-[var(--color-success-bg,#f0fdf4)] text-[var(--color-success,#4ade80)]'
                        : 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-subtle)]'
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', contact.clerkUserId ? 'bg-emerald-400' : 'bg-[var(--color-border)]')} />
                      {contact.clerkUserId ? 'Portal access' : 'No portal access'}
                    </span>
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

// ── Placeholder tab ────────────────────────────────────────────────────────────

function PlaceholderTab({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-12 h-12 rounded-xl bg-[var(--color-bg-secondary)] flex items-center justify-center mb-3">
        <span className="text-2xl">🚧</span>
      </div>
      <h3 className="font-semibold text-[var(--color-text)] mb-1">{label}</h3>
      <p className="text-sm text-[var(--color-text-muted)] max-w-xs">{description}</p>
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
