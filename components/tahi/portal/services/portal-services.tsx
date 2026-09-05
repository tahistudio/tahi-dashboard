'use client'

/**
 * The client's Services page: a showcase, not a shop.
 *
 * Three things, in this order:
 *
 *   your plan     the retainer on the account, the tracks it runs, when the
 *                 next invoice falls, and the add ons the client is already
 *                 paying for. The only money on this page, because it is a
 *                 fact of their own bill rather than a pitch.
 *   what we do    the catalogue, led by the outcome, then what is included,
 *                 then a typical timeline. No prices anywhere: everything is
 *                 scoped and quoted before an hour is booked, and Liam still
 *                 owes the upsell brief, so nothing here pushes.
 *   one soft ask  per card, plus one at the foot. Each ask says out loud
 *                 whether it puts work in the client's queue.
 *
 * There is no create, no edit and no price field anywhere on this surface.
 * The studio-side catalogue editor is a different page.
 */

import * as React from 'react'
import useSWR from 'swr'
import {
  AlertTriangle, CalendarDays, CheckCircle2, Clock, Layers, MessageSquare, RefreshCw,
} from 'lucide-react'
import { ApiError } from '@/lib/swr-fetcher'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import {
  SERVICE_DELIVERY_COPY,
  deliveryFilters,
  toServiceCard,
  type ServiceCardView,
  type ServiceDelivery,
  type ServiceRow,
} from '@/lib/portal-service-view'
import { formatPortalDateLong, formatPortalMoney } from '@/lib/portal-invoice-view'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { Badge } from '@/components/tahi/badge'
import { EmptyState } from '@/components/tahi/empty-state'
import { TahiButton } from '@/components/tahi/tahi-button'
import {
  PortalAskSheet, PortalLeafIcon, PortalMoney, PortalSkeleton,
} from '@/components/tahi/portal/portal-money-kit'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AddonDetail {
  key: string
  label: string
  monthlyValue: number
}

interface PortalSubscription {
  planLabel: string
  monthlyRate: number
  trackCount: number
  nextInvoiceDate: string | null
  createdAt: string | null
  addonDetails: AddonDetail[]
}

interface SubscriptionResponse {
  clientType?: 'retainer' | 'project'
  subscription?: PortalSubscription | null
}

interface AskState {
  title: string
  subtitle?: string
  seed?: string
  requestTitle: string
  emailSubject: string
  placeholder?: string
}

const READ_ONLY_REASON = 'Read only while viewing as a client'

// ── Page ──────────────────────────────────────────────────────────────────────

export function PortalServices() {
  const { isImpersonatingClient } = useImpersonation()
  const readOnly = isImpersonatingClient
  const [filter, setFilter] = React.useState<ServiceDelivery | 'all'>('all')
  const [ask, setAsk] = React.useState<AskState | null>(null)

  const { data, isLoading, error: fetchError, mutate } = useSWR<{ items?: ServiceRow[] }>(
    '/api/portal/services',
  )

  // The plan panel is money, so /api/portal/subscription answers workspace
  // admins only. A member seat gets a 403 and simply does not see the panel:
  // that is a rule, not a failure, and it must never render as an error.
  const { data: planData, error: planError } = useSWR<SubscriptionResponse>(
    '/api/portal/subscription',
  )
  const planDenied = planError instanceof ApiError && planError.status === 403
  const subscription = planDenied ? null : (planData?.subscription ?? null)

  const failed = !!fetchError
  const cards = React.useMemo(
    () => (failed ? [] : (data?.items ?? []).map(toServiceCard)),
    [data, failed],
  )
  const filters = React.useMemo(() => deliveryFilters(cards), [cards])
  const shown = filter === 'all' ? cards : cards.filter(card => card.delivery === filter)

  const askAbout = (partial: AskState) => setAsk(partial)

  return (
    <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
      <PageHeader
        title="Services"
        subtitle="What Tahi Studio takes on, what each one gives you, and how long it usually runs."
      />

      {/* Your plan */}
      {isLoading && !planData ? (
        <Card padding="lg">
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <PortalSkeleton width="10rem" height="1.125rem" />
            <PortalSkeleton width="100%" height="0.75rem" />
            <PortalSkeleton width="60%" height="0.75rem" />
          </div>
        </Card>
      ) : subscription ? (
        <PlanPanel
          subscription={subscription}
          readOnly={readOnly}
          onAsk={() => askAbout({
            title: 'Talk about your plan',
            subtitle: 'Nothing changes on your bill from here. We confirm with you first, every time.',
            seed: `About our ${subscription.planLabel} plan: `,
            requestTitle: `Talk about our ${subscription.planLabel} plan`,
            emailSubject: `Talk about our ${subscription.planLabel} plan`,
          })}
        />
      ) : null}

      {/* Catalogue intro + filters */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between" style={{ gap: 'var(--space-3)' }}>
        <div>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
            What we take on
          </h2>
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '42rem' }}>
            No prices here on purpose. Every one of these is scoped and quoted for you before a single hour is booked.
          </p>
        </div>
        {filters.length > 1 && (
          <div role="group" aria-label="Filter services" className="flex flex-wrap gap-2">
            <FilterChip label="Everything" active={filter === 'all'} onClick={() => setFilter('all')} />
            {filters.map(option => (
              <FilterChip
                key={option.value}
                label={option.label}
                active={filter === option.value}
                onClick={() => setFilter(option.value)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Catalogue */}
      {isLoading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}
        </div>
      ) : failed ? (
        <Card padding="none">
          <EmptyState
            icon={<AlertTriangle className="w-8 h-8" aria-hidden="true" />}
            title="We could not load this page"
            description="This one is on us. Your plan, your invoices and your requests are not affected."
            action={(
              <TahiButton
                variant="primary"
                size="md"
                iconLeft={<RefreshCw size={15} aria-hidden="true" />}
                onClick={() => { void mutate() }}
              >
                Try again
              </TahiButton>
            )}
          />
        </Card>
      ) : cards.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<PortalLeafIcon />}
            title="Nothing published here yet"
            description="We are still writing this up. In the meantime, ask us anything and we will tell you straight whether we do it."
            action={(
              <TahiButton
                variant="primary"
                size="md"
                iconLeft={<MessageSquare size={15} aria-hidden="true" />}
                onClick={() => askAbout(ASK_ANYTHING)}
              >
                Ask us anything
              </TahiButton>
            )}
          />
        </Card>
      ) : shown.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<Layers className="w-8 h-8" aria-hidden="true" />}
            title="Nothing in that group"
            description="Try another group, or ask us and we will point you at the right one."
            action={(
              <TahiButton variant="secondary" size="md" onClick={() => setFilter('all')}>
                Show everything
              </TahiButton>
            )}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map(card => (
            <ServiceCard
              key={card.id}
              card={card}
              readOnly={readOnly}
              onAsk={() => askAbout({
                title: `Ask about ${card.name}`,
                subtitle: SERVICE_DELIVERY_COPY[card.delivery].hint,
                requestTitle: card.name,
                emailSubject: `About ${card.name}`,
                placeholder: 'What are you hoping this changes for you?',
              })}
            />
          ))}
        </div>
      )}

      {/* One ask at the foot, for the thing that is not on a card. */}
      {cards.length > 0 && (
        <Card padding="lg">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <span
              className="flex items-center justify-center shrink-0"
              style={{
                width: '2.5rem',
                height: '2.5rem',
                borderRadius: 'var(--radius-leaf-sm)',
                background: 'var(--color-brand-50)',
                color: 'var(--color-brand-dark)',
              }}
            >
              <PortalLeafIcon />
            </span>
            <div style={{ flex: 1 }}>
              <b style={{ display: 'block', fontSize: '0.9375rem', color: 'var(--color-text)' }}>
                Not sure which of these you need?
              </b>
              <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                Tell us what you are trying to do this season. If it is not something we should take on, we will say so.
              </span>
            </div>
            <TahiButton
              variant="primary"
              size="md"
              iconLeft={<MessageSquare size={15} aria-hidden="true" />}
              onClick={() => askAbout(ASK_ANYTHING)}
            >
              Ask us anything
            </TahiButton>
          </div>
        </Card>
      )}

      <PortalAskSheet
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={ask?.title ?? ''}
        subtitle={ask?.subtitle}
        seed={ask?.seed}
        requestTitle={ask?.requestTitle ?? 'A question for the studio'}
        emailSubject={ask?.emailSubject ?? 'A question for the studio'}
        placeholder={ask?.placeholder}
        readOnly={readOnly}
        readOnlyReason={READ_ONLY_REASON}
      />
    </div>
  )
}

const ASK_ANYTHING: AskState = {
  title: 'Ask us anything',
  subtitle: 'Tell us what you are trying to do. Nothing enters your queue unless you choose to start a request.',
  requestTitle: 'A question for the studio',
  emailSubject: 'A question for the studio',
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="tahi-focus-ring min-h-11 md:min-h-9"
      style={{
        padding: '0.375rem 0.875rem',
        borderRadius: 'var(--radius-badge, 999px)',
        border: `1px solid ${active ? 'var(--color-brand)' : 'var(--color-border)'}`,
        background: active ? 'var(--color-brand-50)' : 'var(--color-bg)',
        color: active ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
        fontSize: '0.8125rem',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'background-color var(--motion-quick) var(--ease-out), border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
      }}
    >
      {label}
    </button>
  )
}

function PlanPanel({
  subscription,
  readOnly,
  onAsk,
}: {
  subscription: PortalSubscription
  readOnly: boolean
  onAsk: () => void
}) {
  const tracks = subscription.trackCount
  return (
    <Card padding="lg">
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="flex items-start gap-3">
            <span
              className="flex items-center justify-center shrink-0"
              style={{
                width: '2.5rem',
                height: '2.5rem',
                borderRadius: 'var(--radius-leaf-sm)',
                background: 'var(--color-brand-50)',
                color: 'var(--color-brand-dark)',
              }}
            >
              <PortalLeafIcon />
            </span>
            <div>
              <span style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-subtle)' }}>
                Your plan
              </span>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text)', margin: '0.125rem 0 0' }}>
                {subscription.planLabel}
              </h2>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '32rem' }}>
                {tracks === 1
                  ? 'One track of work running at a time, with your queue pulling the next request in as soon as a track frees up.'
                  : `${tracks} tracks of work running at a time, with your queue pulling the next request in as soon as a track frees up.`}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2" style={{ marginTop: 'var(--space-4)' }}>
            <PlanFact
              label="Rate"
              value={<PortalMoney>{`${formatPortalMoney(subscription.monthlyRate, 'NZD')} per month`}</PortalMoney>}
            />
            <PlanFact
              label="Tracks running"
              value={<span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{tracks} {tracks === 1 ? 'track' : 'tracks'}</span>}
            />
            {subscription.createdAt && (
              <PlanFact
                label="On this plan since"
                value={<span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{formatPortalDateLong(subscription.createdAt)}</span>}
                icon={<CalendarDays size={14} aria-hidden="true" />}
              />
            )}
            {subscription.nextInvoiceDate && (
              <PlanFact
                label="Next invoice"
                value={<span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{formatPortalDateLong(subscription.nextInvoiceDate)}</span>}
                icon={<CalendarDays size={14} aria-hidden="true" />}
              />
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-3)', alignContent: 'start' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-subtle)' }}>
            On your account
          </span>
          {subscription.addonDetails.length === 0 ? (
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
              No add ons on your account. Everything you are billed for is the plan above.
            </p>
          ) : (
            <ul style={{ display: 'grid', gap: 'var(--space-2)', listStyle: 'none', margin: 0, padding: 0 }}>
              {subscription.addonDetails.map(addon => (
                <li key={addon.key} className="flex items-center justify-between gap-3">
                  <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    {addon.label}
                  </span>
                  {addon.monthlyValue > 0 && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }} data-private="">
                      {formatPortalMoney(addon.monthlyValue, 'NZD')} per month
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <TahiButton
            variant="secondary"
            size="md"
            className="w-full"
            iconLeft={<MessageSquare size={15} aria-hidden="true" />}
            onClick={onAsk}
            disabled={readOnly}
            title={readOnly ? READ_ONLY_REASON : undefined}
          >
            Talk about your plan
          </TahiButton>
        </div>
      </div>
    </Card>
  )
}

function PlanFact({
  label,
  value,
  icon,
}: {
  label: string
  value: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <div>
      <span
        className="flex items-center gap-1.5"
        style={{ fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-subtle)' }}
      >
        {icon}
        {label}
      </span>
      <span style={{ display: 'block', marginTop: '0.125rem', color: 'var(--color-text)' }}>{value}</span>
    </div>
  )
}

function ServiceCard({
  card,
  readOnly,
  onAsk,
}: {
  card: ServiceCardView
  readOnly: boolean
  onAsk: () => void
}) {
  const delivery = SERVICE_DELIVERY_COPY[card.delivery]
  return (
    <Card padding="lg" as="article" style={{ height: '100%' }}>
      {/* A column so the ask and its consequence anchor to the base of every
          card, which is what stops a row of cards reading as ragged. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', height: '100%' }}>
        <div className="flex items-start justify-between gap-3">
          <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
            {card.name}
          </h3>
          <Badge tone={delivery.tone} variant="soft" size="sm">{delivery.label}</Badge>
        </div>

        {card.outcome && (
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            {card.outcome}
          </p>
        )}

        {card.includes.length > 0 && (
          <div>
            <span style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-subtle)', marginBottom: 'var(--space-2)' }}>
              What is included
            </span>
            <ul style={{ display: 'grid', gap: '0.375rem', listStyle: 'none', margin: 0, padding: 0 }}>
              {card.includes.map((line, index) => (
                <li key={index} className="flex items-start gap-2" style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                  <span className="shrink-0" style={{ color: 'var(--color-brand)', marginTop: '0.0625rem' }}>
                    <CheckCircle2 size={14} aria-hidden="true" />
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}

        {card.timeline && (
          <span className="flex items-center gap-2" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
            <Clock size={14} aria-hidden="true" />
            <span><b style={{ color: 'var(--color-text)' }}>Typical timeline</b> {card.timeline}</span>
          </span>
        )}

        <div style={{ display: 'grid', gap: 'var(--space-2)', marginTop: 'auto' }}>
          <TahiButton
            variant="secondary"
            size="md"
            className="w-full sm:w-auto sm:justify-self-start"
            iconLeft={<MessageSquare size={15} aria-hidden="true" />}
            onClick={onAsk}
            disabled={readOnly}
            title={readOnly ? READ_ONLY_REASON : undefined}
          >
            Ask about this
          </TahiButton>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>{delivery.hint}</span>
        </div>
      </div>
    </Card>
  )
}

function SkeletonCard() {
  return (
    <Card padding="lg">
      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <PortalSkeleton width="9rem" height="0.875rem" />
        <PortalSkeleton width="100%" height="0.75rem" />
        <PortalSkeleton width="80%" height="0.75rem" />
        <PortalSkeleton width="92%" height="0.625rem" />
        <PortalSkeleton width="70%" height="0.625rem" />
        <PortalSkeleton width="8rem" height="2.25rem" radius="var(--radius-leaf-sm)" />
      </div>
    </Card>
  )
}
