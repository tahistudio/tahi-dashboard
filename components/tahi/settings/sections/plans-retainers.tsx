'use client'

/*
 * Client plans - the retainer catalogue Tahi sells.
 *
 * Design shape (settings-app.jsx PlansAdmin): one row per plan with a coins
 * leaf icon, name + exclusive "Most popular" chip, a base/track/features
 * subline, RowActions, an Add plan header button and a 6-field EditDialog.
 *
 * The catalogue persists as JSON under the `plan_catalog` settings key
 * ({ id, name, base, track, rec, tag, feats[] }) and drives what every client
 * sees on their Plan & billing tab: GET /api/portal/subscription embeds the
 * same catalogue (lib/plan-catalog.ts, with lib/billing fallbacks for legacy
 * copies that omit prices).
 *
 * The Stripe sync chip stays as a secondary indicator in the subline: it
 * reports whether a matching Stripe product exists for the plan id
 * (GET /api/admin/integrations/stripe/setup-plans).
 *
 * Super-admin-only section (registry gate) + admin-gated settings API.
 */

import { useEffect, useState } from 'react'
import { Coins, Plus } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'
import { Money } from '@/components/tahi/money'
import { PLAN_MONTHLY_RATES } from '@/lib/billing'
import {
  DEFAULT_PLAN_COPY,
  PLAN_CATALOG_KEY,
  PLAN_TRACK_RATES,
  sanitisePlanCopy,
  type PlanCopy,
} from '@/lib/plan-catalog-shared'
import {
  SectionShell,
  EditDialog,
  EmptyRow,
  Chip,
  RowActions,
  useToasts,
  Toasts,
  type ChipTone,
} from '@/components/tahi/settings/primitives'

// Shape of GET /api/admin/integrations/stripe/setup-plans.
interface SetupPlansResponse {
  configured: boolean
  currency?: string
  prices?: Record<string, string | null>
  error?: string
}

function syncChip(configured: boolean, priceId: string | null | undefined): { tone: ChipTone; label: string } {
  if (!configured) return { tone: 'neutral', label: 'Stripe off' }
  if (priceId) return { tone: 'brand', label: 'In Stripe' }
  return { tone: 'warning', label: 'Not synced' }
}

function genId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24) || 'plan-' + Math.random().toString(36).slice(2, 6)
  )
}

/** Resolved display prices: stored value wins, lib/billing fallback otherwise. */
function planBase(p: PlanCopy): number {
  return p.base ?? PLAN_MONTHLY_RATES[p.id] ?? 0
}
function planTrack(p: PlanCopy): number {
  return p.track ?? PLAN_TRACK_RATES[p.id] ?? 0
}

export function PlansRetainersSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  const shouldFetch = isAdmin !== false
  const { toasts, toast } = useToasts()

  const { data: stripe, isLoading: stripeLoading } = useResource<SetupPlansResponse>(
    shouldFetch ? '/api/admin/integrations/stripe/setup-plans' : null,
  )
  const { data: settingsData, mutate } = useResource<{ settings: Record<string, string | null> }>(
    shouldFetch ? '/api/admin/settings' : null,
  )

  const [plans, setPlans] = useState<PlanCopy[]>(DEFAULT_PLAN_COPY)
  const [ed, setEd] = useState<string | null>(null) // plan id | 'new' | null
  const [newId, setNewId] = useState<string | null>(null) // drives lrow-enter

  // Seed from the persisted catalogue whenever the settings payload lands.
  useEffect(() => {
    const raw = settingsData?.settings?.[PLAN_CATALOG_KEY]
    if (!raw) return
    try {
      const parsed = sanitisePlanCopy(JSON.parse(raw))
      if (parsed) setPlans(parsed)
    } catch {
      // Malformed stored copy: keep the defaults on screen.
    }
  }, [settingsData])

  async function persist(next: PlanCopy[]) {
    setPlans(next)
    try {
      const res = await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: PLAN_CATALOG_KEY, value: JSON.stringify(next) }),
      })
      if (!res.ok) throw new Error('Failed')
      toast('Client plans saved', 'ok')
      void mutate()
    } catch {
      toast('Could not save the catalogue', 'err')
      void mutate()
    }
  }

  const configured = stripe?.configured === true
  const prices = stripe?.prices ?? {}

  const editing = ed && ed !== 'new' ? plans.find((p) => p.id === ed) : null
  const dialogRow = editing
    ? {
        name: editing.name,
        tag: editing.tag,
        base: planBase(editing),
        track: planTrack(editing),
        rec: editing.rec ? 'Yes' : 'No',
        feats: editing.feats.join('\n'),
      }
    : { rec: 'No' }

  function onSave(v: Record<string, string>) {
    const feats = (v.feats ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const rec = v.rec === 'Yes'
    const patch = {
      name: v.name || 'Untitled plan',
      tag: v.tag ?? '',
      base: Math.max(0, Number(v.base) || 0),
      track: Math.max(0, Number(v.track) || 0),
      rec,
      feats,
    }
    let next: PlanCopy[]
    let savedId: string
    if (ed === 'new') {
      savedId = genId(patch.name)
      if (plans.some((p) => p.id === savedId)) savedId = savedId + '-' + Math.random().toString(36).slice(2, 5)
      next = [...plans, { id: savedId, ...patch }]
      setNewId(savedId)
    } else if (ed) {
      savedId = ed
      next = plans.map((p) => (p.id === ed ? { ...p, ...patch } : p))
    } else {
      return
    }
    // Only one plan can carry the "Most popular" flag.
    if (rec) next = next.map((p) => ({ ...p, rec: p.id === savedId }))
    void persist(next)
    setEd(null)
  }

  const fields = [
    { key: 'name', label: 'Plan name' },
    { key: 'tag', label: 'One-line summary', ph: 'e.g. Ongoing design & build, handled.' },
    { key: 'base', label: 'Base price ($/month)', type: 'number' as const },
    { key: 'track', label: 'Extra track price ($/month each)', type: 'number' as const },
    { key: 'rec', label: 'Most popular?', type: 'select' as const, opts: ['No', 'Yes'] },
    {
      key: 'feats',
      label: 'Included (one per line)',
      type: 'textarea' as const,
      ph: 'Multiple tracks in parallel\nPriority design & build',
    },
  ]

  return (
    <SectionShell
      title="Client plans"
      lede="The retainer tiers clients choose from. Edits here update what every client sees in Plan & billing."
      action={
        <button className="btn1" type="button" onClick={() => setEd('new')}>
          <Plus size={15} aria-hidden="true" />
          Add plan
        </button>
      }
    >
      <div className="set-card lrow-wrap">
        {plans.map((p, i) => {
          const chip = stripeLoading
            ? { tone: 'neutral' as ChipTone, label: 'Checking...' }
            : syncChip(configured, prices['tahi_' + p.id + '_base'])
          return (
            <div
              key={p.id}
              className={'lrow' + (p.id === newId ? ' lrow-enter' : '')}
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            >
              <span className="lrow-ic leaf" aria-hidden="true">
                <Coins size={16} />
              </span>
              <div className="lrow-t">
                <b>
                  {p.name}
                  {p.rec && (
                    <span className="chip brand" style={{ marginLeft: 8 }}>
                      Most popular
                    </span>
                  )}
                </b>
                <small>
                  <Money nzd={planBase(p)} sensitive />
                  {'/mo base · '}
                  <Money nzd={planTrack(p)} sensitive />
                  {'/mo per extra track · ' + p.feats.length + ' feature' + (p.feats.length === 1 ? '' : 's') + ' '}
                  <Chip tone={chip.tone}>{chip.label}</Chip>
                </small>
              </div>
              <div className="lrow-r">
                <RowActions
                  onEdit={() => setEd(p.id)}
                  onDelete={() => void persist(plans.filter((x) => x.id !== p.id))}
                />
              </div>
            </div>
          )
        })}
        {!plans.length && <EmptyRow text="No plans yet. Add your first retainer tier." />}
      </div>

      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        Extra tracks let a client run more work in parallel - priced per plan above.
      </p>

      {ed && (
        <EditDialog
          heading={ed === 'new' ? 'Add plan' : 'Edit plan'}
          row={dialogRow}
          fields={fields}
          onSave={onSave}
          onClose={() => setEd(null)}
        />
      )}
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
