'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import { Breadcrumb } from '@/components/tahi/breadcrumb'
import {
  Mail,
  User,
  Building2,
  Globe,
  Handshake,
  MessageSquare,
  Activity,
  Plus,
  ChevronRight,
  ExternalLink,
  Clock,
  CheckCircle2,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { StatusBadge } from '@/components/tahi/status-badge'

// ── Types ───────────────────────────────────────────────────────────────────

interface OrgInfo {
  id: string
  name: string
  status: string
  planType: string | null
  website: string | null
  logoUrl: string | null
}

interface ContactData {
  id: string
  orgId: string
  name: string
  email: string
  role: string | null
  clerkUserId: string | null
  isPrimary: boolean | number | null
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  org: OrgInfo
}

interface ActivityItem {
  id: string
  type: string
  title: string
  description: string | null
  dealId: string | null
  scheduledAt: string | null
  completedAt: string | null
  durationMinutes: number | null
  outcome: string | null
  createdAt: string
}

interface DealItem {
  id: string
  title: string
  value: number
  valueNzd: number
  currency: string
  closedAt: string | null
  createdAt: string
  stageId: string
  stageName: string | null
  stageSlug: string | null
  contactRole: string | null
}

interface MessageItem {
  id: string
  body: string | null
  requestId: string | null
  createdAt: string
}

// ── Activity type styles ────────────────────────────────────────────────────

// Matches client-detail ACTIVITY_TYPE_ICONS palette so "Email" etc is the
// same colour in both places. Categorical, not semantic status.
const ACTIVITY_TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  call:    { bg: 'var(--status-submitted-bg)',     text: 'var(--status-submitted-text)',     label: 'Call'    },
  email:   { bg: 'var(--status-in-progress-bg)',   text: 'var(--status-in-progress-text)',   label: 'Email'   },
  meeting: { bg: 'var(--status-client-review-bg)', text: 'var(--status-client-review-text)', label: 'Meeting' },
  note:    { bg: 'var(--color-bg-secondary)',      text: 'var(--color-text-muted)',          label: 'Note'    },
  task:    { bg: 'var(--color-brand-50)',          text: 'var(--color-brand)',               label: 'Task'    },
}

const ACTIVITY_TYPE_OPTIONS = [
  { value: 'call', label: 'Call' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'note', label: 'Note' },
  { value: 'task', label: 'Task' },
]

// ── Main component ──────────────────────────────────────────────────────────

export function ContactDetail({ contactId }: { contactId: string }) {
  const router = useRouter()
  const [contact, setContact] = useState<ContactData | null>(null)
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [deals, setDeals] = useState<DealItem[]>([])
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loading, setLoading] = useState(true)

  // Quick-add activity form
  const [showAddActivity, setShowAddActivity] = useState(false)
  const [newActivityType, setNewActivityType] = useState('note')
  const [newActivityTitle, setNewActivityTitle] = useState('')
  const [newActivityDesc, setNewActivityDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/contacts/${contactId}`))
      if (!res.ok) {
        router.push('/clients')
        return
      }
      const json = await res.json() as {
        contact: ContactData
        activities: ActivityItem[]
        deals: DealItem[]
        messages: MessageItem[]
      }
      setContact(json.contact)
      setActivities(json.activities ?? [])
      setDeals(json.deals ?? [])
      setMessages(json.messages ?? [])
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId])

  useEffect(() => { void load() }, [load])

  const handleAddActivity = useCallback(async () => {
    if (!newActivityTitle.trim() || !contact) return
    setSubmitting(true)
    try {
      const res = await fetch(apiPath('/api/admin/activities'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newActivityType,
          title: newActivityTitle.trim(),
          description: newActivityDesc.trim() || undefined,
          contactId,
          orgId: contact.orgId,
        }),
      })
      if (res.ok) {
        setNewActivityTitle('')
        setNewActivityDesc('')
        setShowAddActivity(false)
        await load()
      }
    } finally {
      setSubmitting(false)
    }
  }, [newActivityType, newActivityTitle, newActivityDesc, contactId, contact, load])

  if (loading) return <LoadingSkeleton />
  if (!contact) return null

  const isPrimary = contact.isPrimary === true || contact.isPrimary === 1

  return (
    <div className="flex flex-col min-h-0">
      {/* Header */}
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="pb-1.5">
          <div style={{ marginBottom: '0.75rem' }}>
            <Breadcrumb
              items={[
                { label: 'Clients', href: '/clients' },
                { label: contact.org.name, href: `/clients/${contact.orgId}` },
                { label: contact.name },
              ]}
            />
          </div>

          <div className="flex flex-col gap-3 mb-5 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              {/* Avatar */}
              <div
                className="flex-shrink-0 flex items-center justify-center text-white font-semibold"
                style={{
                  width: '3rem',
                  height: '3rem',
                  borderRadius: 'var(--radius-leaf)',
                  background: 'linear-gradient(135deg, var(--color-brand), var(--color-brand-dark))',
                  fontSize: '1.125rem',
                }}
              >
                {contact.name.charAt(0).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-[var(--color-text)] md:text-2xl break-words">
                  {contact.name}
                </h1>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  {contact.role && (
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{
                        background: 'var(--color-bg-tertiary)',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {contact.role}
                    </span>
                  )}
                  {isPrimary && (
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{ background: 'var(--color-success-bg)', color: 'var(--color-brand)' }}
                    >
                      Primary
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column: info + org + deals */}
          <div className="lg:col-span-1 space-y-6">
            {/* Contact info card */}
            <div
              className="bg-[var(--color-bg)] border border-[var(--color-border)]"
              style={{ borderRadius: '0.75rem', padding: '1.25rem' }}
            >
              <h2
                className="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-4"
                style={{ letterSpacing: '0.05em' }}
              >
                Contact Information
              </h2>

              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <Mail className="w-4 h-4 text-[var(--color-text-subtle)]" />
                  <a
                    href={`mailto:${contact.email}`}
                    className="text-sm text-[var(--color-brand)] hover:underline truncate"
                  >
                    {contact.email}
                  </a>
                </div>
                {contact.role && (
                  <div className="flex items-center gap-2.5">
                    <User className="w-4 h-4 text-[var(--color-text-subtle)]" />
                    <span className="text-sm text-[var(--color-text)]">{contact.role}</span>
                  </div>
                )}
                {contact.lastLoginAt && (
                  <div className="flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-[var(--color-text-subtle)]" />
                    <span className="text-sm text-[var(--color-text-muted)]">
                      Last login: {new Date(contact.lastLoginAt).toLocaleDateString()}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-[var(--color-text-subtle)]" />
                  <span className="text-sm text-[var(--color-text-muted)]">
                    Added: {new Date(contact.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Organisation card */}
            <div
              className="bg-[var(--color-bg)] border border-[var(--color-border)] cursor-pointer transition-colors hover:border-[var(--color-brand)]"
              style={{ borderRadius: '0.75rem', padding: '1.25rem' }}
              onClick={() => router.push(`/clients/${contact.orgId}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/clients/${contact.orgId}`) }}
            >
              <h2
                className="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-3"
                style={{ letterSpacing: '0.05em' }}
              >
                Organisation
              </h2>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Building2 className="w-4 h-4 text-[var(--color-brand)] flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-text)] truncate">
                      {contact.org.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusBadge status={contact.org.status} type="org" />
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[var(--color-text-subtle)] flex-shrink-0" />
              </div>
              {contact.org.website && (
                <div className="flex items-center gap-1.5 mt-2">
                  <Globe className="w-3.5 h-3.5 text-[var(--color-text-subtle)]" />
                  <span className="text-xs text-[var(--color-text-muted)] truncate">
                    {contact.org.website.replace(/^https?:\/\//, '')}
                  </span>
                </div>
              )}
            </div>

            {/* Linked deals */}
            <div
              className="bg-[var(--color-bg)] border border-[var(--color-border)]"
              style={{ borderRadius: '0.75rem', padding: '1.25rem' }}
            >
              <h2
                className="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-3"
                style={{ letterSpacing: '0.05em' }}
              >
                <Handshake className="w-3.5 h-3.5 inline mr-1.5" style={{ verticalAlign: '-0.125em' }} />
                Linked Deals ({deals.length})
              </h2>

              {deals.length === 0 ? (
                <p className="text-sm text-[var(--color-text-subtle)]">No linked deals</p>
              ) : (
                <div className="space-y-2">
                  {deals.map((deal) => (
                    <div
                      key={deal.id}
                      className="flex items-center justify-between py-2 border-b border-[var(--color-border-subtle)] last:border-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-text)] truncate">
                          {deal.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {deal.stageName && (
                            <span className="text-xs text-[var(--color-text-muted)]">
                              {deal.stageName}
                            </span>
                          )}
                          {deal.contactRole && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                background: 'var(--color-bg-tertiary)',
                                color: 'var(--color-text-muted)',
                              }}
                            >
                              {deal.contactRole}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-medium text-[var(--color-text)] ml-2 flex-shrink-0">
                        {deal.currency} {deal.value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right column: activities + messages */}
          <div className="lg:col-span-2 space-y-6">
            {/* Activity timeline */}
            <div
              className="bg-[var(--color-bg)] border border-[var(--color-border)]"
              style={{ borderRadius: '0.75rem', padding: '1.25rem' }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2
                  className="text-xs font-semibold uppercase text-[var(--color-text-muted)]"
                  style={{ letterSpacing: '0.05em' }}
                >
                  <Activity className="w-3.5 h-3.5 inline mr-1.5" style={{ verticalAlign: '-0.125em' }} />
                  Activity Timeline ({activities.length})
                </h2>
                <TahiButton
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowAddActivity(!showAddActivity)}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </TahiButton>
              </div>

              {/* Quick-add form */}
              {showAddActivity && (
                <div
                  className="mb-4 border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
                  style={{ borderRadius: '0.5rem', padding: '1rem' }}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                        Type
                      </label>
                      <select
                        value={newActivityType}
                        onChange={(e) => setNewActivityType(e.target.value)}
                        className="w-full text-sm border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] focus:border-[var(--color-brand)] focus:outline-none"
                        style={{ borderRadius: '0.5rem', padding: '0.5rem 0.75rem', minHeight: '2.25rem' }}
                      >
                        {ACTIVITY_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                        Title
                      </label>
                      <input
                        type="text"
                        value={newActivityTitle}
                        onChange={(e) => setNewActivityTitle(e.target.value)}
                        placeholder="Activity title..."
                        className="w-full text-sm border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-brand)] focus:outline-none"
                        style={{ borderRadius: '0.5rem', padding: '0.5rem 0.75rem', minHeight: '2.25rem' }}
                      />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                      Description (optional)
                    </label>
                    <textarea
                      value={newActivityDesc}
                      onChange={(e) => setNewActivityDesc(e.target.value)}
                      placeholder="Add details..."
                      rows={2}
                      className="w-full text-sm border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--color-brand)] focus:outline-none resize-none"
                      style={{ borderRadius: '0.5rem', padding: '0.5rem 0.75rem' }}
                    />
                  </div>
                  <div className="flex items-center gap-2 justify-end">
                    <TahiButton
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAddActivity(false)}
                    >
                      Cancel
                    </TahiButton>
                    <TahiButton
                      variant="primary"
                      size="sm"
                      loading={submitting}
                      disabled={!newActivityTitle.trim()}
                      onClick={handleAddActivity}
                    >
                      Save Activity
                    </TahiButton>
                  </div>
                </div>
              )}

              {activities.length === 0 ? (
                <p className="text-sm text-[var(--color-text-subtle)] py-4 text-center">
                  No activities recorded yet
                </p>
              ) : (
                <div className="space-y-0">
                  {activities.map((activity, idx) => {
                    const style = ACTIVITY_TYPE_STYLES[activity.type] ?? ACTIVITY_TYPE_STYLES.note
                    return (
                      <div
                        key={activity.id}
                        className="flex gap-3 relative"
                        style={{ paddingBottom: idx < activities.length - 1 ? '1rem' : 0 }}
                      >
                        {/* Timeline line */}
                        {idx < activities.length - 1 && (
                          <div
                            className="absolute left-[0.6875rem] top-[1.5rem]"
                            style={{
                              width: '0.125rem',
                              bottom: 0,
                              background: 'var(--color-border-subtle)',
                            }}
                          />
                        )}

                        {/* Timeline dot */}
                        <div
                          className="flex-shrink-0 flex items-center justify-center relative z-10"
                          style={{
                            width: '1.5rem',
                            height: '1.5rem',
                            borderRadius: '50%',
                            background: style.bg,
                          }}
                        >
                          {activity.completedAt ? (
                            <CheckCircle2 style={{ width: '0.75rem', height: '0.75rem', color: style.text }} />
                          ) : (
                            <div style={{ width: '0.375rem', height: '0.375rem', borderRadius: '50%', background: style.text }} />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="text-xs font-medium px-1.5 py-0.5 rounded"
                              style={{ background: style.bg, color: style.text }}
                            >
                              {style.label}
                            </span>
                            <span className="text-sm font-medium text-[var(--color-text)]">
                              {activity.title}
                            </span>
                          </div>
                          {activity.description && (
                            <p className="text-sm text-[var(--color-text-muted)] mt-0.5 line-clamp-2">
                              {activity.description}
                            </p>
                          )}
                          <p className="text-xs text-[var(--color-text-subtle)] mt-1">
                            {new Date(activity.createdAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                            {activity.durationMinutes != null && (
                              <span className="ml-2">{activity.durationMinutes} min</span>
                            )}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Recent messages */}
            <div
              className="bg-[var(--color-bg)] border border-[var(--color-border)]"
              style={{ borderRadius: '0.75rem', padding: '1.25rem' }}
            >
              <h2
                className="text-xs font-semibold uppercase text-[var(--color-text-muted)] mb-4"
                style={{ letterSpacing: '0.05em' }}
              >
                <MessageSquare className="w-3.5 h-3.5 inline mr-1.5" style={{ verticalAlign: '-0.125em' }} />
                Recent Messages ({messages.length})
              </h2>

              {messages.length === 0 ? (
                <p className="text-sm text-[var(--color-text-subtle)] py-4 text-center">
                  No messages from this contact
                </p>
              ) : (
                <div className="space-y-3">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className="border-b border-[var(--color-border-subtle)] last:border-0"
                      style={{ paddingBottom: '0.75rem' }}
                    >
                      <p className="text-sm text-[var(--color-text)] line-clamp-2">
                        {msg.body ?? '(no content)'}
                      </p>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-[var(--color-text-subtle)]">
                          {new Date(msg.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {msg.requestId && (
                          <a
                            href={`/requests/${msg.requestId}`}
                            className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View request
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile bottom nav spacer */}
        <div className="h-28 md:hidden" aria-hidden="true" />
      </div>
    </div>
  )
}

// ── Loading skeleton ────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col min-h-0">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg)] pb-6">
        <div className="animate-pulse" style={{ marginBottom: '0.75rem' }}>
          <div style={{ width: '12rem', height: '0.875rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
        </div>
        <div className="flex items-start gap-3">
          <div
            className="animate-pulse flex-shrink-0"
            style={{ width: '3rem', height: '3rem', borderRadius: 'var(--radius-leaf)', background: 'var(--color-bg-tertiary)' }}
          />
          <div className="space-y-2 flex-1">
            <div className="animate-pulse" style={{ width: '10rem', height: '1.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
            <div className="animate-pulse" style={{ width: '6rem', height: '1rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
          </div>
        </div>
      </div>
      <div className="py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="animate-pulse bg-[var(--color-bg)] border border-[var(--color-border)]"
                style={{ borderRadius: '0.75rem', padding: '1.25rem', height: '8rem' }}
              >
                <div style={{ width: '8rem', height: '0.75rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem', marginBottom: '1rem' }} />
                <div style={{ width: '100%', height: '0.75rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem', marginBottom: '0.5rem' }} />
                <div style={{ width: '75%', height: '0.75rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
              </div>
            ))}
          </div>
          <div className="lg:col-span-2 space-y-6">
            {[1, 2].map((i) => (
              <div
                key={i}
                className="animate-pulse bg-[var(--color-bg)] border border-[var(--color-border)]"
                style={{ borderRadius: '0.75rem', padding: '1.25rem', height: '14rem' }}
              >
                <div style={{ width: '10rem', height: '0.75rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem', marginBottom: '1rem' }} />
                <div className="space-y-3">
                  {[1, 2, 3].map((j) => (
                    <div key={j} style={{ width: '100%', height: '2.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem' }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
