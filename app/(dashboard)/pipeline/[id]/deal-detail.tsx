'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Building2, Calendar, Clock,
  Phone, Mail, FileText, MessageSquare,
  Plus, Loader2, Check, ChevronDown, Inbox, X, Search, UserPlus, Send, BellOff,
  UserCheck, ExternalLink,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { REQUEST_STATUS_CONFIG } from '@/lib/status-config'

// ---- Types ---------------------------------------------------------------

interface DealData {
  id: string
  title: string
  orgId: string | null
  stageId: string
  ownerId: string | null
  value: number
  currency: string
  valueNzd: number
  source: string | null
  estimatedHoursPerWeek: number | null
  engagementType: string | null
  totalHours: number | null
  hoursPerMonth: number | null
  engagementStartDate: string | null
  engagementEndDate: string | null
  expectedCloseDate: string | null
  autoNudgesDisabled: number | null
  closedAt: string | null
  closeReason: string | null
  notes: string | null
  stageEnteredAt: string | null
  createdAt: string
  updatedAt: string
  orgName: string | null
  stageName: string | null
  stageColour: string | null
  stageProbability: number | null
  stagePosition: number | null
  stageIsClosedWon: number | null
  stageIsClosedLost: number | null
  ownerName: string | null
  ownerAvatarUrl: string | null
}

interface DealContact {
  id: string
  contactId: string
  role: string | null
  contactName: string | null
  contactEmail: string | null
  contactRole: string | null
}

interface DealActivity {
  id: string
  type: string
  title: string
  description: string | null
  createdById: string
  scheduledAt: string | null
  completedAt: string | null
  durationMinutes: number | null
  outcome: string | null
  createdAt: string
  createdByName: string | null
}

interface Stage {
  id: string
  name: string
  position: number
  colour: string | null
  isClosedWon: number
  isClosedLost: number
}

interface TeamMember {
  id: string
  name: string
}

// ---- Helpers -------------------------------------------------------------

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NZ', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString()}`
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '--' }
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

const ACTIVITY_ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  call: Phone,
  meeting: Calendar,
  email: Mail,
  note: FileText,
  task: Check,
}

const ACTIVITY_COLORS: Record<string, string> = {
  call: 'var(--status-submitted-dot)',
  meeting: 'var(--status-client-review-dot)',
  email: 'var(--status-delivered-dot)',
  note: 'var(--status-in-review-dot)',
  task: 'var(--color-warning)',
}

const SOURCE_STYLES: Record<string, { label: string; bg: string; text: string }> = {
  referral:        { label: 'Referral',         bg: '#fef3c7', text: '#d97706' },
  webflow_partner: { label: 'Webflow Partner',  bg: '#4353ff1a', text: '#4353ff' },
  straightin:      { label: 'StraightIn',       bg: '#c7d2fe', text: '#3730a3' },
  linkedin:        { label: 'LinkedIn',         bg: '#dbeafe', text: '#1d4ed8' },
  website:         { label: 'Website',          bg: '#d1fae5', text: '#059669' },
  cold:            { label: 'Cold Outreach',    bg: '#e0e7ff', text: '#4338ca' },
  cold_outreach:   { label: 'Cold Outreach',    bg: '#e0e7ff', text: '#4338ca' },
  inbound:         { label: 'Inbound',          bg: '#d1fae5', text: '#059669' },
  direct:          { label: 'Direct',           bg: '#f0fdf4', text: '#16a34a' },
  social:          { label: 'Social',           bg: '#fce7f3', text: '#db2777' },
  partner:         { label: 'Partner',          bg: '#fce7f3', text: '#be185d' },
  webflow:         { label: 'Webflow',          bg: '#dbeafe', text: '#2563eb' },
  existing_client: { label: 'Existing Client',  bg: '#fef3c7', text: '#d97706' },
  integration:     { label: 'Integration',      bg: '#e0e7ff', text: '#6366f1' },
  outbound:        { label: 'Outbound',         bg: '#e0e7ff', text: '#4338ca' },
  other:           { label: 'Other',            bg: 'var(--color-bg-tertiary)', text: 'var(--color-text-subtle)' },
}

const SOURCE_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'referral', label: 'Referral' },
  { value: 'webflow_partner', label: 'Webflow Partner' },
  { value: 'straightin', label: 'StraightIn Agency' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'website', label: 'Website' },
  { value: 'inbound', label: 'Inbound' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'direct', label: 'Direct' },
  { value: 'social', label: 'Social' },
  { value: 'cold', label: 'Cold Outreach' },
  { value: 'partner', label: 'Partner' },
  { value: 'existing_client', label: 'Existing Client' },
  { value: 'other', label: 'Other' },
]

function daysInStage(stageEnteredAt: string | null, updatedAt: string): number {
  const ref = stageEnteredAt ?? updatedAt
  if (!ref) return 0
  const diff = Date.now() - new Date(ref).getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)))
}

// ---- Main component ------------------------------------------------------

export function DealDetail({ dealId }: { dealId: string }) {
  const [deal, setDeal] = useState<DealData | null>(null)
  const [contacts, setContacts] = useState<DealContact[]>([])
  const [activities, setActivities] = useState<DealActivity[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [ltv, setLtv] = useState<{ total: number; wonDealCount: number; paidInvoiceCount: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showActivityForm, setShowActivityForm] = useState(false)
  const [showNudgeDialog, setShowNudgeDialog] = useState(false)

  const fetchDeal = useCallback(async () => {
    setLoading(true)
    try {
      const [dealRes, teamRes] = await Promise.all([
        fetch(apiPath(`/api/admin/deals/${dealId}`)),
        fetch(apiPath('/api/admin/team-members')),
      ])

      if (dealRes.ok) {
        const data = await dealRes.json() as {
          deal: DealData
          contacts: DealContact[]
          activities: DealActivity[]
          stages: Stage[]
          ltv?: { total: number; wonDealCount: number; paidInvoiceCount: number } | null
        }
        setDeal(data.deal)
        setContacts(data.contacts ?? [])
        setActivities(data.activities ?? [])
        setLtv(data.ltv ?? null)
        setStages(data.stages ?? [])
      }

      if (teamRes.ok) {
        const tData = await teamRes.json() as { items?: TeamMember[], members?: TeamMember[] }
        setTeamMembers(tData.items ?? tData.members ?? [])
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => { fetchDeal() }, [fetchDeal])

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ padding: '4rem 0' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--color-brand)' }} />
      </div>
    )
  }

  if (!deal) {
    return (
      <div style={{ padding: '1.5rem' }}>
        <Link
          href="/pipeline"
          className="inline-flex items-center gap-1.5 font-medium transition-colors"
          style={{ fontSize: '0.875rem', color: 'var(--color-brand)', textDecoration: 'none', marginBottom: '1rem', display: 'inline-flex' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Pipeline
        </Link>
        <p style={{ color: 'var(--color-text-muted)' }}>Deal not found.</p>
      </div>
    )
  }

  return (
    <div className="dashboard-main">
      {/* Back link */}
      <Link
        href="/pipeline"
        className="view-link"
        style={{
          fontSize: 'var(--text-sm)',
          fontWeight: 500,
          color: 'var(--color-text-muted)',
          textDecoration: 'none',
          marginBottom: 'var(--space-5)',
          display: 'inline-flex',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
      >
        <ArrowLeft size={15} aria-hidden="true" />
        Back to Pipeline
      </Link>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3" style={{ gap: 'var(--space-6)' }}>
        {/* Left column (2/3) */}
        <div className="lg:col-span-2 flex flex-col" style={{ gap: 'var(--space-6)' }}>
          {/* Title + stage */}
          <div>
            <h1 className="font-bold" style={{ fontSize: '1.5rem', color: 'var(--color-text)', marginBottom: '0.5rem' }}>
              {deal.title}
            </h1>
            {/* Stage progress indicator */}
            <StageProgress stages={stages} currentStageId={deal.stageId} />
          </div>

          {/* Activity Timeline */}
          <div
            className="rounded-xl border shadow-sm"
            style={{ padding: '1.5rem', background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
              <h2 className="font-semibold" style={{ fontSize: '1rem', color: 'var(--color-text)' }}>
                Activity Timeline
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowNudgeDialog(true)}
                  className="inline-flex items-center gap-1.5 font-medium transition-colors rounded-lg"
                  style={{
                    padding: '0.5rem 0.875rem',
                    fontSize: '0.8125rem',
                    background: 'var(--color-bg-tertiary)',
                    color: 'var(--color-text-muted)',
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer',
                    minHeight: '2.75rem',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)' }}
                >
                  <Send className="w-3.5 h-3.5" />
                  Nudge
                </button>
                <button
                  onClick={() => setShowActivityForm(true)}
                  className="inline-flex items-center gap-1.5 font-medium transition-colors rounded-lg"
                  style={{
                    padding: '0.5rem 0.875rem',
                    fontSize: '0.8125rem',
                    background: 'var(--color-brand)',
                    color: 'white',
                    border: 'none',
                    cursor: 'pointer',
                    minHeight: '2.75rem',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-brand-dark)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-brand)' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Log Activity
                </button>
              </div>
            </div>

            {activities.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center rounded-lg"
                style={{ padding: '2rem', border: '1px dashed var(--color-border)' }}
              >
                <MessageSquare style={{ width: '2rem', height: '2rem', color: 'var(--color-text-subtle)', marginBottom: '0.5rem' }} />
                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>No activities yet</p>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>Log a call, meeting, or note to get started</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {activities.map((act, i) => {
                  const Icon = ACTIVITY_ICONS[act.type] ?? FileText
                  const iconColor = ACTIVITY_COLORS[act.type] ?? 'var(--color-text-subtle)'
                  const isLast = i === activities.length - 1

                  return (
                    <div key={act.id} className="flex gap-3" style={{ position: 'relative' }}>
                      {/* Timeline connector */}
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div
                          className="rounded-full flex items-center justify-center"
                          style={{ width: '2rem', height: '2rem', background: `${iconColor}20`, flexShrink: 0 }}
                        >
                          <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} />
                        </div>
                        {!isLast && (
                          <div style={{ width: '2px', flex: 1, minHeight: '1rem', background: 'var(--color-border)' }} />
                        )}
                      </div>

                      {/* Content */}
                      <div style={{ paddingBottom: isLast ? 0 : '1.25rem', flex: 1 }}>
                        <div className="flex items-center gap-2" style={{ marginBottom: '0.25rem' }}>
                          <span className="font-medium" style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                            {act.title}
                          </span>
                          <span
                            className="rounded-full font-medium uppercase"
                            style={{ padding: '0.0625rem 0.375rem', fontSize: '0.625rem', background: `${iconColor}20`, color: iconColor }}
                          >
                            {act.type}
                          </span>
                        </div>
                        {act.description && (
                          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
                            {act.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3" style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                          {act.createdByName && <span>{act.createdByName}</span>}
                          <span>{formatDate(act.createdAt)}</span>
                          {act.durationMinutes && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {act.durationMinutes}m
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <NotesSection dealId={dealId} initialNotes={deal.notes} onUpdated={fetchDeal} />

          {/* Associated Requests (T306) */}
          {deal.orgId && (
            <AssociatedRequests orgId={deal.orgId} />
          )}
        </div>

        {/* Right column (1/3) - sidebar */}
        <div className="flex flex-col gap-4">
          {/* Stage selector */}
          <SidebarCard title="Stage">
            <StageSelector
              dealId={dealId}
              stages={stages}
              currentStageId={deal.stageId}
              onUpdated={fetchDeal}
            />
          </SidebarCard>

          {/* Convert to Client (shown when Closed Won) */}
          {!!deal.stageIsClosedWon && (
            <ConvertToClientCard
              dealId={dealId}
              orgId={deal.orgId}
              orgName={deal.orgName}
              onConverted={fetchDeal}
            />
          )}

          {/* Value */}
          <SidebarCard title="Value">
            <EditableValue
              dealId={dealId}
              value={deal.value}
              currency={deal.currency}
              onUpdated={fetchDeal}
            />
          </SidebarCard>

          {/* Owner */}
          <SidebarCard title="Owner">
            <OwnerSelector
              dealId={dealId}
              currentOwnerId={deal.ownerId}
              teamMembers={teamMembers}
              onUpdated={fetchDeal}
            />
          </SidebarCard>

          {/* Company */}
          <SidebarCard title="Company">
            <OrgSelector
              dealId={dealId}
              currentOrgId={deal.orgId}
              currentOrgName={deal.orgName}
              onUpdated={fetchDeal}
            />
          </SidebarCard>

          {/* Source */}
          {/* Client LTV */}
          {ltv && ltv.total > 0 && (
            <SidebarCard title="Client Lifetime Value">
              <div className="flex flex-col gap-1.5">
                <p className="font-bold" style={{ fontSize: '1.125rem', color: 'var(--color-brand)' }}>
                  {formatCurrency(ltv.total, 'NZD')}
                </p>
                <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
                  {ltv.wonDealCount} won deal{ltv.wonDealCount !== 1 ? 's' : ''}
                  {ltv.paidInvoiceCount > 0 && <> + {ltv.paidInvoiceCount} paid invoice{ltv.paidInvoiceCount !== 1 ? 's' : ''}</>}
                </p>
              </div>
            </SidebarCard>
          )}

          <SidebarCard title="Lead Source">
            <SourceSelector
              dealId={dealId}
              currentSource={deal.source}
              onUpdated={fetchDeal}
            />
          </SidebarCard>

          {/* Days in Stage */}
          <SidebarCard title="Days in Stage">
            <span className="font-semibold" style={{ fontSize: '1.125rem', color: 'var(--color-text)' }}>
              {daysInStage(deal.stageEnteredAt ?? null, deal.updatedAt)}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginLeft: '0.25rem' }}>
              days
            </span>
          </SidebarCard>

          {/* Expected Close */}
          <SidebarCard title="Expected Close">
            <EditableDate
              dealId={dealId}
              value={deal.expectedCloseDate}
              field="expectedCloseDate"
              onUpdated={fetchDeal}
            />
          </SidebarCard>

          {/* Engagement */}
          <SidebarCard title="Engagement">
            <EngagementEditor dealId={dealId} deal={deal} onUpdated={fetchDeal} />
          </SidebarCard>

          {/* Auto-nudge toggle (only in Stalled stage) */}
          {deal.stageName === 'Stalled' && (
            <SidebarCard title="Auto Nudges">
              <div className="flex items-center justify-between">
                <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                  {deal.autoNudgesDisabled ? 'Paused' : 'Active'}
                </span>
                <button
                  onClick={async () => {
                    await fetch(apiPath(`/api/admin/deals/${dealId}`), {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ autoNudgesDisabled: !deal.autoNudgesDisabled }),
                    })
                    fetchDeal()
                  }}
                  className="inline-flex items-center gap-1.5 font-medium transition-colors rounded-full"
                  style={{
                    padding: '0.25rem 0.625rem',
                    fontSize: '0.6875rem',
                    background: deal.autoNudgesDisabled ? 'var(--color-bg-tertiary)' : 'var(--color-brand-50)',
                    color: deal.autoNudgesDisabled ? 'var(--color-text-subtle)' : 'var(--color-brand)',
                    border: `1px solid ${deal.autoNudgesDisabled ? 'var(--color-border)' : 'var(--color-brand-light)'}`,
                    cursor: 'pointer',
                  }}
                >
                  {deal.autoNudgesDisabled ? (
                    <><BellOff style={{ width: '0.625rem', height: '0.625rem' }} /> Enable</>
                  ) : (
                    <><BellOff style={{ width: '0.625rem', height: '0.625rem' }} /> Pause</>
                  )}
                </button>
              </div>
            </SidebarCard>
          )}

          {/* Capacity Impact */}
          {(
            (deal.engagementType === 'project' && deal.totalHours && deal.totalHours > 0) ||
            (deal.engagementType === 'retainer' && ((deal.estimatedHoursPerWeek ?? 0) > 0 || (deal.hoursPerMonth ?? 0) > 0)) ||
            (!deal.engagementType && deal.estimatedHoursPerWeek != null && deal.estimatedHoursPerWeek > 0)
          ) && (
            <SidebarCard title="Capacity Impact">
              <div style={{
                padding: '0.625rem 0.75rem',
                background: 'var(--color-brand-50, #f0f7ee)',
                borderRadius: '0.5rem',
                marginBottom: '0.5rem',
              }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-brand)' }}>
                  {deal.engagementType === 'project' ? (
                    <>
                      {deal.totalHours} hrs total
                      {deal.engagementStartDate && deal.engagementEndDate && (
                        <span style={{ fontWeight: 500 }}>
                          {' '}over {Math.max(1, Math.ceil(
                            (new Date(deal.engagementEndDate).getTime() - new Date(deal.engagementStartDate).getTime()) / (1000 * 60 * 60 * 24 * 7)
                          ))} weeks
                        </span>
                      )}
                    </>
                  ) : deal.engagementType === 'retainer' ? (
                    <>
                      {deal.hoursPerMonth ? `${deal.hoursPerMonth} hrs/month` : `${deal.estimatedHoursPerWeek} hrs/week`}
                      <span style={{ fontWeight: 500 }}> ongoing</span>
                    </>
                  ) : (
                    <>~{deal.estimatedHoursPerWeek} hrs/week</>
                  )}
                </div>
              </div>

              {deal.stageProbability !== null && deal.stageProbability > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                  <span style={{ color: 'var(--color-text-subtle)' }}>Probability</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>{deal.stageProbability}%</span>
                </div>
              )}
            </SidebarCard>
          )}

          {/* Contacts */}
          <SidebarCard title="Contacts">
            <ContactLinker
              dealId={dealId}
              contacts={contacts}
              onUpdated={fetchDeal}
            />
          </SidebarCard>

          {/* Dates */}
          <SidebarCard title="Dates">
            <div className="flex flex-col gap-1" style={{ fontSize: '0.8125rem' }}>
              <div className="flex justify-between">
                <span style={{ color: 'var(--color-text-subtle)' }}>Created</span>
                <span style={{ color: 'var(--color-text-muted)' }}>{formatDate(deal.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--color-text-subtle)' }}>Updated</span>
                <span style={{ color: 'var(--color-text-muted)' }}>{formatDate(deal.updatedAt)}</span>
              </div>
              {deal.closedAt && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--color-text-subtle)' }}>Closed</span>
                  <span style={{ color: 'var(--color-text-muted)' }}>{formatDate(deal.closedAt)}</span>
                </div>
              )}
            </div>
          </SidebarCard>
        </div>
      </div>

      {/* Activity form dialog */}
      {showActivityForm && (
        <ActivityFormDialog
          dealId={dealId}
          onClose={() => setShowActivityForm(false)}
          onCreated={() => {
            setShowActivityForm(false)
            fetchDeal()
          }}
        />
      )}

      {/* Nudge dialog */}
      {showNudgeDialog && (
        <NudgeDialog
          dealId={dealId}
          dealTitle={deal.title}
          contacts={contacts}
          onClose={() => setShowNudgeDialog(false)}
          onSent={() => {
            setShowNudgeDialog(false)
            fetchDeal()
          }}
        />
      )}
    </div>
  )
}

// ---- Stage Progress Indicator -------------------------------------------

function StageProgress({ stages, currentStageId }: { stages: Stage[]; currentStageId: string }) {
  const openStages = stages.filter(s => !s.isClosedWon && !s.isClosedLost)
  const currentStage = stages.find(s => s.id === currentStageId)
  const isClosed = !!(currentStage?.isClosedWon || currentStage?.isClosedLost)

  return (
    <div className="flex items-center gap-1 flex-wrap" style={{ marginTop: '0.5rem' }}>
      {openStages.map((stage, i) => {
        const isActive = stage.id === currentStageId
        const isPast = !isClosed && (currentStage?.position ?? 0) > stage.position
        const colour = stage.colour ?? 'var(--color-text-subtle)'

        return (
          <div key={stage.id} className="flex items-center gap-1">
            <div
              className="rounded-full flex items-center justify-center font-medium"
              style={{
                padding: '0.25rem 0.75rem',
                fontSize: '0.6875rem',
                background: isActive ? colour : isPast ? `${colour}30` : 'var(--color-bg-tertiary)',
                color: isActive ? 'white' : isPast ? colour : 'var(--color-text-subtle)',
                border: isActive ? 'none' : `1px solid ${isPast ? `${colour}50` : 'var(--color-border)'}`,
                whiteSpace: 'nowrap',
              }}
            >
              {stage.name}
            </div>
            {i < openStages.length - 1 && (
              <div style={{ width: '0.75rem', height: '2px', background: isPast ? colour : 'var(--color-border)' }} />
            )}
          </div>
        )
      })}
      {isClosed && currentStage && (
        <div
          className="rounded-full font-medium"
          style={{
            padding: '0.25rem 0.75rem',
            fontSize: '0.6875rem',
            marginLeft: '0.5rem',
            background: currentStage.isClosedWon ? '#4ade8030' : '#f8717130',
            color: currentStage.isClosedWon ? '#16a34a' : '#dc2626',
          }}
        >
          {currentStage.name}
        </div>
      )}
    </div>
  )
}

// ---- Sidebar Card -------------------------------------------------------

function SidebarCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border shadow-sm"
      style={{ padding: '1rem 1.25rem', background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
    >
      <p className="font-semibold uppercase tracking-wide" style={{ fontSize: '0.625rem', color: 'var(--color-text-subtle)', marginBottom: '0.5rem' }}>
        {title}
      </p>
      {children}
    </div>
  )
}

// ---- Stage Selector -----------------------------------------------------

function StageSelector({ dealId, stages, currentStageId, onUpdated }: {
  dealId: string
  stages: Stage[]
  currentStageId: string
  onUpdated: () => void
}) {
  const [saving, setSaving] = useState(false)

  const handleChange = async (newStageId: string) => {
    if (newStageId === currentStageId) return
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageId: newStageId }),
      })
      onUpdated()
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative">
      <select
        value={currentStageId}
        onChange={e => handleChange(e.target.value)}
        disabled={saving}
        className="w-full rounded-lg cursor-pointer appearance-none"
        style={{
          padding: '0.5rem 2rem 0.5rem 0.75rem',
          fontSize: '0.875rem',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          minHeight: '2.75rem',
        }}
      >
        {stages.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <ChevronDown
        className="absolute pointer-events-none"
        style={{ width: '0.875rem', height: '0.875rem', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-subtle)' }}
      />
    </div>
  )
}

// ---- Editable Value -----------------------------------------------------

function EditableValue({ dealId, value, currency, onUpdated }: {
  dealId: string
  value: number
  currency: string
  onUpdated: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState(String(value))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const num = parseFloat(editVal)
    if (isNaN(num)) return
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: num }),
      })
      onUpdated()
      setEditing(false)
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setEditVal(String(value)); setEditing(true) }}
        className="font-semibold transition-colors"
        style={{ fontSize: '1.125rem', color: 'var(--color-brand)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand-dark)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
      >
        {formatCurrency(value, currency)}
      </button>
    )
  }

  return (
    <div className="flex gap-2">
      <input
        type="number"
        value={editVal}
        onChange={e => setEditVal(e.target.value)}
        className="flex-1 rounded-lg"
        style={{
          padding: '0.375rem 0.5rem',
          fontSize: '0.875rem',
          border: '1px solid var(--color-brand)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          minWidth: 0,
        }}
        autoFocus
        onKeyDown={e => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg transition-colors"
        style={{
          padding: '0.375rem 0.625rem',
          fontSize: '0.75rem',
          background: 'var(--color-brand)',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {saving ? '...' : 'Save'}
      </button>
    </div>
  )
}

// ---- Owner Selector -----------------------------------------------------

// ---- Engagement Editor ---------------------------------------------------

function EngagementEditor({ dealId, deal, onUpdated }: {
  dealId: string
  deal: DealData
  onUpdated: () => void
}) {
  const [saving, setSaving] = useState(false)
  const engType = deal.engagementType ?? ''

  const handleTypeChange = async (newType: string) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagementType: newType || null }),
      })
      onUpdated()
    } catch { /* silent */ } finally { setSaving(false) }
  }

  const handleFieldSave = async (field: string, value: unknown) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      onUpdated()
    } catch { /* silent */ } finally { setSaving(false) }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Type toggle */}
      <div className="flex gap-1.5">
        {[
          { value: 'project', label: 'Project' },
          { value: 'retainer', label: 'Retainer' },
        ].map(opt => (
          <button
            key={opt.value}
            onClick={() => handleTypeChange(engType === opt.value ? '' : opt.value)}
            disabled={saving}
            className="rounded-full font-medium transition-colors"
            style={{
              padding: '0.25rem 0.625rem',
              fontSize: '0.6875rem',
              background: engType === opt.value ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
              color: engType === opt.value ? 'white' : 'var(--color-text-muted)',
              border: `1px solid ${engType === opt.value ? 'var(--color-brand)' : 'var(--color-border)'}`,
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Project fields */}
      {engType === 'project' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>Total hours</span>
            <input
              type="number"
              defaultValue={deal.totalHours ?? ''}
              onBlur={e => {
                const v = parseInt(e.target.value)
                if (!isNaN(v) && v !== deal.totalHours) handleFieldSave('totalHours', v)
              }}
              className="rounded-md text-right"
              style={{ width: '4rem', padding: '0.25rem 0.375rem', fontSize: '0.75rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>Start date</span>
            <input
              type="date"
              defaultValue={deal.engagementStartDate?.split('T')[0] ?? ''}
              onBlur={e => handleFieldSave('engagementStartDate', e.target.value || null)}
              className="rounded-md"
              style={{ padding: '0.25rem 0.375rem', fontSize: '0.75rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>End date</span>
            <input
              type="date"
              defaultValue={deal.engagementEndDate?.split('T')[0] ?? ''}
              onBlur={e => handleFieldSave('engagementEndDate', e.target.value || null)}
              className="rounded-md"
              style={{ padding: '0.25rem 0.375rem', fontSize: '0.75rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>
        </div>
      )}

      {/* Retainer fields */}
      {engType === 'retainer' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>Hours/week</span>
            <input
              type="number"
              defaultValue={deal.estimatedHoursPerWeek ?? ''}
              onBlur={e => {
                const v = parseInt(e.target.value)
                if (!isNaN(v)) handleFieldSave('estimatedHoursPerWeek', v)
              }}
              className="rounded-md text-right"
              style={{ width: '4rem', padding: '0.25rem 0.375rem', fontSize: '0.75rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>Hours/month</span>
            <input
              type="number"
              defaultValue={deal.hoursPerMonth ?? ''}
              onBlur={e => {
                const v = parseInt(e.target.value)
                if (!isNaN(v)) handleFieldSave('hoursPerMonth', v)
              }}
              className="rounded-md text-right"
              style={{ width: '4rem', padding: '0.25rem 0.375rem', fontSize: '0.75rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>Start date</span>
            <input
              type="date"
              defaultValue={deal.engagementStartDate?.split('T')[0] ?? ''}
              onBlur={e => handleFieldSave('engagementStartDate', e.target.value || null)}
              className="rounded-md"
              style={{ padding: '0.25rem 0.375rem', fontSize: '0.75rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>
        </div>
      )}

      {/* Legacy: if no type set but has hours, show old field */}
      {!engType && (
        <EditableNumber
          dealId={dealId}
          value={deal.estimatedHoursPerWeek}
          field="estimatedHoursPerWeek"
          onUpdated={onUpdated}
          suffix="hrs/wk"
        />
      )}
    </div>
  )
}

// ---- Contact Linker -------------------------------------------------------

function ContactLinker({ dealId, contacts, onUpdated }: {
  dealId: string
  contacts: DealContact[]
  onUpdated: () => void
}) {
  const [showSearch, setShowSearch] = useState(false)
  const [allContacts, setAllContacts] = useState<{ id: string; name: string; email: string; orgName?: string }[]>([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!showSearch) return
    fetch(apiPath('/api/admin/contacts'))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const data = d as { items?: { id: string; name: string; email: string; orgName?: string }[] }
        setAllContacts(data.items ?? [])
      })
      .catch(() => setAllContacts([]))
  }, [showSearch])

  const linkedIds = new Set(contacts.map(c => c.contactId))
  const filtered = allContacts
    .filter(c => !linkedIds.has(c.id))
    .filter(c => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    })

  const handleLink = async (contactId: string) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}/contacts`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      })
      onUpdated()
    } catch { /* silent */ } finally {
      setSaving(false)
    }
  }

  const handleUnlink = async (contactId: string) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}/contacts`), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      })
      onUpdated()
    } catch { /* silent */ } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {contacts.length === 0 && !showSearch && (
        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>No contacts linked</span>
      )}
      {contacts.map(c => (
        <div key={c.id} className="flex items-center gap-2 group">
          <div
            className="rounded-full flex items-center justify-center font-semibold flex-shrink-0"
            style={{ width: '1.5rem', height: '1.5rem', fontSize: '0.5625rem', background: 'var(--color-brand-50)', color: 'var(--color-brand)' }}
          >
            {getInitials(c.contactName ?? '?')}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate" style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
              {c.contactName}
            </p>
            {c.contactEmail && (
              <p className="truncate" style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{c.contactEmail}</p>
            )}
          </div>
          <button
            onClick={() => handleUnlink(c.contactId)}
            disabled={saving}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.125rem', color: 'var(--color-text-subtle)' }}
            title="Unlink contact"
          >
            <X style={{ width: '0.75rem', height: '0.75rem' }} />
          </button>
        </div>
      ))}

      {showSearch ? (
        <div className="flex flex-col gap-1.5" style={{ marginTop: '0.25rem' }}>
          <div className="relative">
            <Search className="absolute pointer-events-none" style={{ width: '0.75rem', height: '0.75rem', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-subtle)' }} />
            <input
              type="text"
              placeholder="Search contacts..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              className="w-full rounded-md"
              style={{ padding: '0.375rem 0.375rem 0.375rem 1.75rem', fontSize: '0.75rem', border: '1px solid var(--color-brand)', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none' }}
            />
          </div>
          <div className="flex flex-col overflow-y-auto rounded-md border" style={{ maxHeight: '8rem', borderColor: 'var(--color-border)' }}>
            {filtered.map(c => (
              <button
                key={c.id}
                onClick={() => handleLink(c.id)}
                disabled={saving}
                className="text-left transition-colors flex items-center gap-2"
                style={{ padding: '0.375rem 0.5rem', fontSize: '0.75rem', color: 'var(--color-text)', background: 'none', border: 'none', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
              >
                <span className="font-medium">{c.name}</span>
                <span style={{ color: 'var(--color-text-subtle)' }}>{c.email}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p style={{ padding: '0.5rem', fontSize: '0.75rem', color: 'var(--color-text-subtle)', textAlign: 'center' }}>
                No contacts found
              </p>
            )}
          </div>
          <button
            onClick={() => { setShowSearch(false); setSearch('') }}
            className="self-end"
            style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowSearch(true)}
          className="inline-flex items-center gap-1.5 font-medium transition-colors self-start"
          style={{ fontSize: '0.75rem', color: 'var(--color-brand)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: '0.25rem' }}
        >
          <UserPlus style={{ width: '0.75rem', height: '0.75rem' }} />
          Link contact
        </button>
      )}
    </div>
  )
}

// ---- Org/Company Selector ------------------------------------------------

function OrgSelector({ dealId, currentOrgId, currentOrgName, onUpdated }: {
  dealId: string
  currentOrgId: string | null
  currentOrgName: string | null
  onUpdated: () => void
}) {
  const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    fetch(apiPath('/api/admin/clients'))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const data = d as { organisations?: { id: string; name: string }[] }
        setOrgs(data.organisations ?? [])
      })
      .catch(() => setOrgs([]))
  }, [open])

  const filtered = orgs.filter(o =>
    o.name.toLowerCase().includes(search.toLowerCase())
  )

  const handleSelect = async (orgId: string | null) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      onUpdated()
    } catch { /* silent */ } finally {
      setSaving(false)
      setOpen(false)
      setSearch('')
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {currentOrgId ? (
          <div className="flex items-center justify-between">
            <Link
              href={`/clients/${currentOrgId}`}
              className="inline-flex items-center gap-2 font-medium transition-colors"
              style={{ fontSize: '0.875rem', color: 'var(--color-brand)', textDecoration: 'none' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand-dark)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
            >
              <Building2 className="w-4 h-4" />
              {currentOrgName ?? 'View Company'}
            </Link>
            <button
              onClick={() => setOpen(true)}
              className="transition-colors"
              style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Change
            </button>
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 font-medium transition-colors"
            style={{ fontSize: '0.875rem', color: 'var(--color-text-subtle)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <Building2 className="w-4 h-4" />
            Link a company...
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="absolute pointer-events-none" style={{ width: '0.875rem', height: '0.875rem', left: '0.625rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-subtle)' }} />
        <input
          type="text"
          placeholder="Search companies..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
          className="w-full rounded-lg"
          style={{ padding: '0.5rem 0.5rem 0.5rem 2rem', fontSize: '0.8125rem', border: '1px solid var(--color-brand)', background: 'var(--color-bg)', color: 'var(--color-text)', outline: 'none' }}
        />
      </div>
      <div
        className="flex flex-col overflow-y-auto rounded-lg border"
        style={{ maxHeight: '10rem', borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
      >
        {currentOrgId && (
          <button
            onClick={() => handleSelect(null)}
            disabled={saving}
            className="text-left transition-colors"
            style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-subtle)', borderBottom: '1px solid var(--color-border-subtle)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Unlink company
          </button>
        )}
        {filtered.map(o => (
          <button
            key={o.id}
            onClick={() => handleSelect(o.id)}
            disabled={saving}
            className="text-left transition-colors"
            style={{
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              color: o.id === currentOrgId ? 'var(--color-brand)' : 'var(--color-text)',
              fontWeight: o.id === currentOrgId ? 600 : 400,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
          >
            {o.name}
          </button>
        ))}
        {filtered.length === 0 && (
          <p style={{ padding: '0.75rem', fontSize: '0.8125rem', color: 'var(--color-text-subtle)', textAlign: 'center' }}>
            No companies found
          </p>
        )}
      </div>
      <button
        onClick={() => { setOpen(false); setSearch('') }}
        className="self-end transition-colors"
        style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', background: 'none', border: 'none', cursor: 'pointer' }}
      >
        Cancel
      </button>
    </div>
  )
}

// ---- Owner Selector --------------------------------------------------------

function OwnerSelector({ dealId, currentOwnerId, teamMembers, onUpdated }: {
  dealId: string
  currentOwnerId: string | null
  teamMembers: TeamMember[]
  onUpdated: () => void
}) {
  const [saving, setSaving] = useState(false)

  const handleChange = async (ownerId: string) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: ownerId || null }),
      })
      onUpdated()
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="relative">
      <select
        value={currentOwnerId ?? ''}
        onChange={e => handleChange(e.target.value)}
        disabled={saving}
        className="w-full rounded-lg cursor-pointer appearance-none"
        style={{
          padding: '0.5rem 2rem 0.5rem 0.75rem',
          fontSize: '0.875rem',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          minHeight: '2.75rem',
        }}
      >
        <option value="">Unassigned</option>
        {teamMembers.map(m => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
      <ChevronDown
        className="absolute pointer-events-none"
        style={{ width: '0.875rem', height: '0.875rem', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-subtle)' }}
      />
    </div>
  )
}

// ---- Editable Date ------------------------------------------------------

function EditableDate({ dealId, value, field, onUpdated }: {
  dealId: string
  value: string | null
  field: string
  onUpdated: () => void
}) {
  const [saving, setSaving] = useState(false)

  const handleChange = async (dateStr: string) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: dateStr || null }),
      })
      onUpdated()
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  return (
    <input
      type="date"
      value={value?.split('T')[0] ?? ''}
      onChange={e => handleChange(e.target.value)}
      disabled={saving}
      className="w-full rounded-lg"
      style={{
        padding: '0.5rem 0.75rem',
        fontSize: '0.875rem',
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
        color: 'var(--color-text)',
        minHeight: '2.75rem',
      }}
    />
  )
}

// ---- Editable Number ----------------------------------------------------

function EditableNumber({ dealId, value, field, onUpdated, suffix }: {
  dealId: string
  value: number | null
  field: string
  onUpdated: () => void
  suffix?: string
}) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState(String(value ?? ''))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const num = parseFloat(editVal)
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: isNaN(num) ? 0 : num }),
      })
      onUpdated()
      setEditing(false)
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => { setEditVal(String(value ?? '')); setEditing(true) }}
        className="font-medium transition-colors"
        style={{ fontSize: '0.875rem', color: 'var(--color-text)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {value ?? 0} {suffix}
      </button>
    )
  }

  return (
    <div className="flex gap-2">
      <input
        type="number"
        value={editVal}
        onChange={e => setEditVal(e.target.value)}
        className="flex-1 rounded-lg"
        style={{
          padding: '0.375rem 0.5rem',
          fontSize: '0.875rem',
          border: '1px solid var(--color-brand)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          minWidth: 0,
        }}
        autoFocus
        onKeyDown={e => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
      <button
        onClick={handleSave}
        disabled={saving}
        className="rounded-lg"
        style={{
          padding: '0.375rem 0.625rem',
          fontSize: '0.75rem',
          background: 'var(--color-brand)',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {saving ? '...' : 'Save'}
      </button>
    </div>
  )
}

// ---- Notes Section ------------------------------------------------------

function NotesSection({ dealId, initialNotes, onUpdated }: {
  dealId: string
  initialNotes: string | null
  onUpdated: () => void
}) {
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      setDirty(false)
      onUpdated()
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="rounded-xl border shadow-sm"
      style={{ padding: '1.5rem', background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
        <h2 className="font-semibold" style={{ fontSize: '1rem', color: 'var(--color-text)' }}>Notes</h2>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="font-medium rounded-lg transition-colors"
            style={{
              padding: '0.375rem 0.75rem',
              fontSize: '0.8125rem',
              background: 'var(--color-brand)',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
      <textarea
        value={notes}
        onChange={e => { setNotes(e.target.value); setDirty(true) }}
        placeholder="Add notes about this deal..."
        className="w-full rounded-lg resize-y"
        rows={4}
        style={{
          padding: '0.75rem',
          fontSize: '0.875rem',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-secondary)',
          color: 'var(--color-text)',
          outline: 'none',
          minHeight: '6rem',
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-brand)' }}
        onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
      />
    </div>
  )
}

// ---- Source Selector ----------------------------------------------------

function SourceSelector({ dealId, currentSource, onUpdated }: {
  dealId: string
  currentSource: string | null
  onUpdated: () => void
}) {
  const [saving, setSaving] = useState(false)
  const srcCfg = SOURCE_STYLES[currentSource ?? '']

  const handleChange = async (newSource: string) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/deals/${dealId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: newSource || null }),
      })
      onUpdated()
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {srcCfg && currentSource && (
        <span
          className="inline-flex self-start rounded-full font-medium"
          style={{ padding: '0.125rem 0.5rem', fontSize: '0.75rem', background: srcCfg.bg, color: srcCfg.text }}
        >
          {srcCfg.label}
        </span>
      )}
      <div className="relative">
        <select
          value={currentSource ?? ''}
          onChange={e => handleChange(e.target.value)}
          disabled={saving}
          className="w-full rounded-lg cursor-pointer appearance-none"
          style={{
            padding: '0.5rem 2rem 0.5rem 0.75rem',
            fontSize: '0.875rem',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            minHeight: '2.75rem',
          }}
        >
          {SOURCE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <ChevronDown
          className="absolute pointer-events-none"
          style={{ width: '0.875rem', height: '0.875rem', right: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-subtle)' }}
        />
      </div>
    </div>
  )
}

// ---- Activity Form Dialog -----------------------------------------------

// ---- Nudge Dialog --------------------------------------------------------

function NudgeDialog({ dealId, dealTitle, contacts, onClose, onSent }: {
  dealId: string
  dealTitle: string
  contacts: DealContact[]
  onClose: () => void
  onSent: () => void
}) {
  const contactEmails = contacts.map(c => c.contactEmail).filter(Boolean) as string[]
  const [to, setTo] = useState(contactEmails.join(', '))
  const [subject, setSubject] = useState(`Following up: ${dealTitle}`)
  const [body, setBody] = useState(
    `Hi,\n\nJust wanted to check in on this. Happy to answer any questions or jump on a quick call if it helps.\n\nCheers`
  )
  const [templates, setTemplates] = useState<{ id: string; name: string; subject: string; bodyHtml: string }[]>([])
  const [scheduleDate, setScheduleDate] = useState('')
  const [sending, setSending] = useState(false)
  const [mode, setMode] = useState<'now' | 'schedule'>('now')

  useEffect(() => {
    fetch(apiPath('/api/admin/nudge-templates'))
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => {
        const data = d as { items?: { id: string; name: string; subject: string; bodyHtml: string }[] }
        setTemplates(data.items ?? [])
      })
      .catch(() => setTemplates([]))
  }, [])

  const handleTemplate = (templateId: string) => {
    const t = templates.find(tp => tp.id === templateId)
    if (t) {
      setSubject(t.subject.replace(/\{\{dealTitle\}\}/g, dealTitle))
      setBody(t.bodyHtml.replace(/\{\{dealTitle\}\}/g, dealTitle))
    }
  }

  const handleSend = async () => {
    const emails = to.split(',').map(e => e.trim()).filter(Boolean)
    if (!emails.length || !subject.trim() || !body.trim()) return

    setSending(true)
    try {
      const res = await fetch(apiPath(`/api/admin/deals/${dealId}/nudges`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactEmails: emails,
          subject: subject.trim(),
          bodyHtml: body.trim().replace(/\n/g, '<br>'),
          sendNow: mode === 'now',
          scheduledAt: mode === 'schedule' && scheduleDate ? new Date(scheduleDate).toISOString() : undefined,
        }),
      })
      if (res.ok) onSent()
    } catch { /* silent */ } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="rounded-xl shadow-lg border flex flex-col"
        style={{
          width: '32rem', maxWidth: '95vw', maxHeight: '90vh',
          background: 'var(--color-bg)', borderColor: 'var(--color-border)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between" style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="font-semibold" style={{ fontSize: '1rem', color: 'var(--color-text)' }}>
            <Send className="inline w-4 h-4" style={{ marginRight: '0.5rem', color: 'var(--color-brand)' }} />
            Send Nudge
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-subtle)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto" style={{ padding: '1.25rem' }}>
          {/* Template picker */}
          {templates.length > 0 && (
            <div>
              <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginBottom: '0.25rem' }}>
                Template
              </label>
              <select
                onChange={e => handleTemplate(e.target.value)}
                className="w-full rounded-lg"
                style={{ padding: '0.5rem', fontSize: '0.8125rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              >
                <option value="">Custom message</option>
                {templates.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* To */}
          <div>
            <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginBottom: '0.25rem' }}>
              To
            </label>
            <input
              type="text"
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="email@example.com"
              className="w-full rounded-lg"
              style={{ padding: '0.5rem', fontSize: '0.8125rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>

          {/* Subject */}
          <div>
            <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginBottom: '0.25rem' }}>
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="w-full rounded-lg"
              style={{ padding: '0.5rem', fontSize: '0.8125rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </div>

          {/* Body */}
          <div>
            <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginBottom: '0.25rem' }}>
              Message
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={6}
              className="w-full rounded-lg resize-none"
              style={{ padding: '0.5rem', fontSize: '0.8125rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontFamily: 'inherit' }}
            />
          </div>

          {/* Send mode */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              <input type="radio" name="nudgeMode" checked={mode === 'now'} onChange={() => setMode('now')} />
              Send now
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              <input type="radio" name="nudgeMode" checked={mode === 'schedule'} onChange={() => setMode('schedule')} />
              Schedule
            </label>
          </div>

          {mode === 'schedule' && (
            <input
              type="datetime-local"
              value={scheduleDate}
              onChange={e => setScheduleDate(e.target.value)}
              className="rounded-lg"
              style={{ padding: '0.5rem', fontSize: '0.8125rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          )}
        </div>

        <div className="flex justify-end gap-2" style={{ padding: '1rem 1.25rem', borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={onClose}
            className="rounded-lg font-medium transition-colors"
            style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem', background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !to.trim() || !subject.trim() || !body.trim()}
            className="rounded-lg font-medium transition-colors inline-flex items-center gap-1.5"
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.8125rem',
              background: sending ? 'var(--color-text-subtle)' : 'var(--color-brand)',
              color: 'white',
              border: 'none',
              cursor: sending ? 'default' : 'pointer',
              opacity: (!to.trim() || !subject.trim() || !body.trim()) ? 0.5 : 1,
            }}
          >
            <Send className="w-3.5 h-3.5" />
            {sending ? 'Sending...' : mode === 'now' ? 'Send Now' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- Activity Form Dialog ------------------------------------------------

function ActivityFormDialog({ dealId, onClose, onCreated }: {
  dealId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [type, setType] = useState('note')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    setSaving(true)
    try {
      const res = await fetch(apiPath('/api/admin/activities'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          title: title.trim(),
          description: description.trim() || undefined,
          dealId,
          scheduledAt: scheduledAt || undefined,
          durationMinutes: durationMinutes ? parseInt(durationMinutes) : undefined,
        }),
      })
      if (res.ok) onCreated()
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  const activityTypes = [
    { value: 'note', label: 'Note' },
    { value: 'meeting', label: 'Meeting' },
    { value: 'email', label: 'Email' },
    { value: 'task', label: 'Task' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="rounded-xl shadow-lg w-full"
        style={{
          maxWidth: '28rem',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          padding: '1.5rem',
        }}
      >
        <h2 className="font-bold" style={{ fontSize: '1.125rem', color: 'var(--color-text)', marginBottom: '1.25rem' }}>
          Log Activity
        </h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Type */}
          <div className="flex gap-2 flex-wrap">
            {activityTypes.map(at => (
              <button
                key={at.value}
                type="button"
                onClick={() => setType(at.value)}
                className="rounded-full font-medium transition-colors"
                style={{
                  padding: '0.375rem 0.75rem',
                  fontSize: '0.8125rem',
                  background: type === at.value ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
                  color: type === at.value ? 'white' : 'var(--color-text-muted)',
                  border: `1px solid ${type === at.value ? 'var(--color-brand)' : 'var(--color-border)'}`,
                  cursor: 'pointer',
                }}
              >
                {at.label}
              </button>
            ))}
          </div>

          {/* Title */}
          <div>
            <label className="block font-medium" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full rounded-lg"
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                minHeight: '2.75rem',
              }}
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block font-medium" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full rounded-lg resize-y"
              rows={3}
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
              }}
            />
          </div>

          {/* Scheduled + Duration (for calls/meetings) */}
          {(type === 'call' || type === 'meeting') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
                  Date
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  className="w-full rounded-lg"
                  style={{
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.875rem',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    minHeight: '2.75rem',
                  }}
                />
              </div>
              <div>
                <label className="block font-medium" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.375rem' }}>
                  Duration (min)
                </label>
                <input
                  type="number"
                  value={durationMinutes}
                  onChange={e => setDurationMinutes(e.target.value)}
                  placeholder="30"
                  className="w-full rounded-lg"
                  style={{
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.875rem',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    minHeight: '2.75rem',
                  }}
                />
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3" style={{ marginTop: '0.5rem' }}>
            <button
              type="button"
              onClick={onClose}
              className="font-medium rounded-lg transition-colors"
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.875rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                minHeight: '2.75rem',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="font-medium rounded-lg transition-colors"
              style={{
                padding: '0.5rem 1.25rem',
                fontSize: '0.875rem',
                background: 'var(--color-brand)',
                color: 'white',
                border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving || !title.trim() ? 0.6 : 1,
                minHeight: '2.75rem',
              }}
            >
              {saving ? 'Saving...' : 'Log Activity'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---- Associated Requests (T306) -----------------------------------------

interface AssociatedRequest {
  id: string
  title: string
  status: string
}

function AssociatedRequests({ orgId }: { orgId: string }) {
  const [requests, setRequests] = useState<AssociatedRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  useEffect(() => {
    fetch(apiPath(`/api/admin/requests?orgId=${encodeURIComponent(orgId)}&limit=20`))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ items: AssociatedRequest[] }>
      })
      .then(d => setRequests(d.items ?? []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false))
  }, [orgId])

  return (
    <div
      className="rounded-xl border shadow-sm"
      style={{ padding: '1.5rem', background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
        <h2 className="font-semibold" style={{ fontSize: '1rem', color: 'var(--color-text)' }}>
          Associated Requests
        </h2>
        <span
          className="rounded-full font-medium"
          style={{
            padding: '0.125rem 0.5rem',
            fontSize: '0.6875rem',
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-subtle)',
          }}
        >
          {loading ? '...' : requests.length}
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded-lg" style={{ height: '2.5rem', background: 'var(--color-bg-tertiary)' }} />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg"
          style={{ padding: '2rem', border: '1px dashed var(--color-border)' }}
        >
          <Inbox style={{ width: '2rem', height: '2rem', color: 'var(--color-text-subtle)', marginBottom: '0.5rem' }} />
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>No requests from this company</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {requests.map(req => {
            const cfg = REQUEST_STATUS_CONFIG[req.status] ?? REQUEST_STATUS_CONFIG.submitted
            return (
              <Link
                key={req.id}
                href={`/requests/${req.id}`}
                className="flex items-center justify-between rounded-lg transition-colors"
                style={{
                  padding: '0.5rem 0.75rem',
                  textDecoration: 'none',
                  background: hoveredId === req.id ? 'var(--color-bg-secondary)' : 'transparent',
                }}
                onMouseEnter={() => setHoveredId(req.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <span
                  className="truncate font-medium"
                  style={{ fontSize: '0.8125rem', color: 'var(--color-text)', maxWidth: '70%' }}
                >
                  {req.title}
                </span>
                <span
                  className="rounded-full font-medium flex-shrink-0"
                  style={{
                    padding: '0.125rem 0.5rem',
                    fontSize: '0.6875rem',
                    background: cfg.bg,
                    color: cfg.text,
                    border: cfg.border ? `1px solid ${cfg.border}` : undefined,
                  }}
                >
                  {cfg.label}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---- Convert to Client Card ------------------------------------------------

function ConvertToClientCard({ dealId, orgId, orgName, onConverted }: {
  dealId: string
  orgId: string | null
  orgName: string | null
  onConverted: () => void
}) {
  const [converting, setConverting] = useState(false)
  const [result, setResult] = useState<{ orgId: string; orgName: string; created: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // If the deal is already linked to an org, show the link
  const linkedOrgId = result?.orgId ?? orgId
  const linkedOrgName = result?.orgName ?? orgName

  if (linkedOrgId && linkedOrgName) {
    return (
      <div
        className="rounded-xl border shadow-sm"
        style={{
          padding: '1rem 1.25rem',
          background: 'var(--color-brand-50, #f0f7ee)',
          borderColor: 'var(--color-brand-light)',
        }}
      >
        <div className="flex items-center gap-2" style={{ marginBottom: '0.5rem' }}>
          <UserCheck style={{ width: '1rem', height: '1rem', color: 'var(--color-brand)' }} />
          <p className="font-semibold uppercase tracking-wide" style={{ fontSize: '0.625rem', color: 'var(--color-brand)' }}>
            Client
          </p>
        </div>
        <Link
          href={`/clients/${linkedOrgId}`}
          className="inline-flex items-center gap-1.5 font-medium transition-colors"
          style={{
            fontSize: '0.875rem',
            color: 'var(--color-brand)',
            textDecoration: 'none',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand-dark)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
        >
          {linkedOrgName}
          <ExternalLink style={{ width: '0.75rem', height: '0.75rem' }} />
        </Link>
        {result?.created && (
          <p style={{ fontSize: '0.6875rem', color: 'var(--color-brand)', marginTop: '0.375rem' }}>
            New client created from this deal
          </p>
        )}
      </div>
    )
  }

  const handleConvert = async () => {
    setConverting(true)
    setError(null)
    try {
      const res = await fetch(apiPath(`/api/admin/deals/${dealId}/convert-to-client`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to convert' }))
        setError((data as { error?: string }).error ?? 'Failed to convert deal to client')
        return
      }
      const data = await res.json() as { success: boolean; orgId: string; orgName: string; created: boolean }
      setResult(data)
      onConverted()
    } catch {
      setError('Failed to convert deal to client')
    } finally {
      setConverting(false)
    }
  }

  return (
    <div
      className="rounded-xl border shadow-sm"
      style={{
        padding: '1rem 1.25rem',
        background: 'var(--color-brand-50, #f0f7ee)',
        borderColor: 'var(--color-brand-light)',
      }}
    >
      <div className="flex items-center gap-2" style={{ marginBottom: '0.5rem' }}>
        <UserCheck style={{ width: '1rem', height: '1rem', color: 'var(--color-brand)' }} />
        <p className="font-semibold uppercase tracking-wide" style={{ fontSize: '0.625rem', color: 'var(--color-brand)' }}>
          Won - Convert to Client
        </p>
      </div>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
        This deal is closed-won. Create a client record to start managing their work.
      </p>
      {error && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-danger, #f87171)', marginBottom: '0.5rem' }}>
          {error}
        </p>
      )}
      <button
        onClick={handleConvert}
        disabled={converting}
        className="inline-flex items-center gap-1.5 font-medium transition-colors rounded-lg w-full justify-center"
        style={{
          padding: '0.5rem 1rem',
          fontSize: '0.8125rem',
          background: 'var(--color-brand)',
          color: 'white',
          border: 'none',
          cursor: converting ? 'not-allowed' : 'pointer',
          opacity: converting ? 0.7 : 1,
          minHeight: '2.5rem',
        }}
        onMouseEnter={e => { if (!converting) e.currentTarget.style.background = 'var(--color-brand-dark)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-brand)' }}
      >
        {converting ? (
          <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Converting...</>
        ) : (
          <><UserCheck className="w-3.5 h-3.5" /> Convert to Client</>
        )}
      </button>
    </div>
  )
}
