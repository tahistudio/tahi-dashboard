'use client'

/*
 * Plans and retainers settings section.
 *
 * The retainer catalogue Tahi SELLS: the Maintain and Scale plans, each with a
 * base monthly price and a parallel-track ("Priority Support") add-on priced
 * per plan. This replaces the design's generic Subscription section with the
 * real commercial catalogue.
 *
 * The catalogue mirrored below is the source of truth in lib/stripe-plans.ts
 * (STRIPE_PLANS + STRIPE_CURRENCY + PRESENTMENT_CURRENCIES). It is duplicated as
 * a plain constant here on purpose: lib/stripe-plans.ts imports the Stripe Node
 * SDK at module scope, so importing it into this client component would drag the
 * whole SDK into the browser bundle. Keep the two in sync by hand until the
 * catalogue moves to a table.
 *
 * Sync status is read live from GET /api/admin/integrations/stripe/setup-plans,
 * which reports, per lookup key, whether a Stripe price currently resolves.
 *
 * Backend gap: editing here mutates local state only. Persisting an edited
 * catalogue needs a `plans` table plus a Stripe sync step (create/update the
 * product + recurring price for the changed lookup key). Until that lands the
 * EditDialog is a scaffold and the note below says so. Admin-only surface.
 */

import { useState } from 'react'
import { CreditCard, Layers, Pencil } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { Money } from '@/components/tahi/money'
import {
  SectionShell,
  EditDialog,
  EmptyRow,
  Chip,
  useManaged,
  type ChipTone,
} from '@/components/tahi/settings/primitives'

// Base/settlement currency for the catalogue (mirrors STRIPE_CURRENCY).
const CATALOGUE_CURRENCY = 'USD'

// Presentment currencies a client can be billed in (mirrors PRESENTMENT_CURRENCIES).
const CURRENCY_OPTIONS = ['USD', 'NZD', 'AUD', 'GBP', 'EUR', 'CAD'] as const

type PlanKind = 'base' | 'track'

// A single sellable line: either a plan's base retainer or its parallel-track
// add-on. `amount` is in minor units (cents), matching lib/stripe-plans.ts.
interface PlanRow extends Record<string, unknown> {
  planName: string
  kind: PlanKind
  label: string
  lookupKey: string
  amount: number
  currency: string
}

// Mirror of STRIPE_PLANS, flattened into one row per sellable price.
const CATALOGUE: PlanRow[] = [
  {
    planName: 'Maintain',
    kind: 'base',
    label: 'Maintain',
    lookupKey: 'tahi_maintain_base',
    amount: 150000,
    currency: CATALOGUE_CURRENCY,
  },
  {
    planName: 'Maintain',
    kind: 'track',
    label: 'Maintain parallel track',
    lookupKey: 'tahi_maintain_track',
    amount: 100000,
    currency: CATALOGUE_CURRENCY,
  },
  {
    planName: 'Scale',
    kind: 'base',
    label: 'Scale',
    lookupKey: 'tahi_scale_base',
    amount: 400000,
    currency: CATALOGUE_CURRENCY,
  },
  {
    planName: 'Scale',
    kind: 'track',
    label: 'Scale parallel track',
    lookupKey: 'tahi_scale_track',
    amount: 150000,
    currency: CATALOGUE_CURRENCY,
  },
]

// Shape of GET /api/admin/integrations/stripe/setup-plans.
interface SetupPlansResponse {
  configured: boolean
  currency?: string
  // lookup key -> resolved Stripe price id (or null when it does not resolve).
  prices?: Record<string, string | null>
  error?: string
}

function syncChip(
  configured: boolean,
  priceId: string | null | undefined,
): { tone: ChipTone; label: string } {
  if (!configured) return { tone: 'neutral', label: 'Stripe off' }
  if (priceId) return { tone: 'brand', label: 'In Stripe' }
  return { tone: 'warning', label: 'Not synced' }
}

export function PlansRetainersSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  // Admin-only: non-admins skip the fetch and never sit on a spinner.
  const shouldFetch = isAdmin !== false
  const { data, isLoading } = useResource<SetupPlansResponse>(
    shouldFetch ? '/api/admin/integrations/stripe/setup-plans' : null,
  )

  const L = useManaged<PlanRow>(CATALOGUE)
  const [ed, setEd] = useState<string | null>(null)

  const loading = shouldFetch ? isLoading && !data : false
  const configured = data?.configured === true
  const prices = data?.prices ?? {}

  function patchRow(rowId: string, values: Record<string, string>) {
    const major = Number(values.price)
    const amount = Number.isFinite(major) ? Math.round(major * 100) : 0
    L.patch(rowId, {
      label: values.label,
      amount,
      currency: values.currency || CATALOGUE_CURRENCY,
    })
    setEd(null)
  }

  const editing = ed ? L.rows.find((r) => r._id === ed) : undefined
  // EditDialog reads plain string/number fields, so hand it price in major units.
  const editingForDialog = editing
    ? {
        label: editing.label,
        price: (editing.amount / 100).toString(),
        currency: editing.currency,
      }
    : undefined

  return (
    <SectionShell
      title="Plans and retainers"
      lede="The retainer catalogue you sell: each plan's base price and its parallel-track add-on, billed monthly through Stripe."
    >
      <div className="set-card lrow-wrap">
        {L.rows.map((r, i) => {
          const { tone, label } = loading
            ? { tone: 'neutral' as ChipTone, label: 'Checking...' }
            : syncChip(configured, prices[r.lookupKey])
          return (
            <div
              key={r._id}
              className={'lrow' + (r._new ? ' lrow-enter' : '')}
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            >
              <span className="lrow-ic leaf" aria-hidden="true">
                {r.kind === 'base' ? <CreditCard size={16} /> : <Layers size={16} />}
              </span>
              <div className="lrow-t">
                <b>{r.label}</b>
                <small>
                  {(r.kind === 'base' ? 'Base retainer' : 'Parallel-track add-on') +
                    ' · ' +
                    r.lookupKey}
                </small>
              </div>
              <div className="lrow-r">
                <b style={{ font: '600 13.5px Manrope' }}>
                  <Money native={r.amount / 100} currency={r.currency} />
                  <span style={{ color: 'var(--text-faint)', fontWeight: 500 }}>/mo</span>
                </b>
                <Chip tone={tone}>{label}</Chip>
                <div className="lrow-acts">
                  <button
                    type="button"
                    className="ta-icobtn sm"
                    aria-label={'Edit ' + r.label}
                    onClick={() => setEd(r._id)}
                  >
                    <Pencil size={15} />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
        {!L.rows.length && <EmptyRow text="No plans in the catalogue yet." />}
      </div>

      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        Editing here is a preview only. Persisting a changed catalogue needs a
        plans table plus a Stripe sync step to create or update the product and
        recurring price for each lookup key. Run the setup route once per Stripe
        environment to create the prices these keys resolve to.
      </p>

      {ed && (
        <EditDialog
          heading="Edit plan"
          row={editingForDialog}
          fields={[
            { key: 'label', label: 'Plan name' },
            {
              key: 'price',
              label: 'Price per month',
              type: 'number',
              help: 'Amount in the selected currency, charged monthly.',
            },
            {
              key: 'currency',
              label: 'Currency',
              type: 'select',
              opts: [...CURRENCY_OPTIONS],
            },
          ]}
          onSave={(v) => patchRow(ed, v)}
          onClose={() => setEd(null)}
        />
      )}
    </SectionShell>
  )
}
