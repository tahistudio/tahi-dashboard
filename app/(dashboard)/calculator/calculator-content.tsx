'use client'

/**
 * <CalculatorContent>. Internal pricing helper UI.
 *
 * Two-column layout:
 *   LEFT: input form (project type, scope, timeline, retainer, client)
 *   RIGHT: live recommendation (cost / target / capacity / benchmarks)
 *
 * The right rail recomputes whenever the form blurs. Saves the calc to
 * `/api/admin/calculator` so it can be reopened from the deal detail
 * page or piped into a proposal / schedule / contract draft.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Calculator as CalcIcon, Check, FileSignature, FileText, Calendar, Save } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { TahiButton } from '@/components/tahi/tahi-button'
import { FeatureCard } from '@/components/tahi/feature-card'
import { DonutChart } from '@/components/tahi/chart'
import type { CalculationInputs, CalculationOutputs, ProjectType, RetainerPlan, ClientRelationship, Currency, ScopeCategory, ScopeLine, DeliveryMode } from '@/lib/calculator/types'

interface SavedCalculation {
  id: string
  name: string
  dealId: string | null
  orgId: string | null
  isActive: number
  inputs: string
  outputs: string
  linkedArtefactRef: string | null
  createdAt: string
  updatedAt: string
}

const SCOPE_META: Record<ScopeCategory, { label: string; hint: string; defaultHours: number; defaultRate: number }> = {
  webflow:     { label: 'Webflow build', hint: 'Layout, CMS, interactions', defaultHours: 60, defaultRate: 95 },
  engineering: { label: 'Engineering',   hint: 'Custom code, integrations, attribution', defaultHours: 30, defaultRate: 110 },
  design:      { label: 'Design',        hint: 'UI/UX, brand application',  defaultHours: 50, defaultRate: 90 },
  strategy:    { label: 'Strategy',      hint: 'Discovery, IA, AEO, content', defaultHours: 20, defaultRate: 100 },
}

const SCOPE_KEYS: ScopeCategory[] = ['webflow', 'engineering', 'design', 'strategy']

const DEFAULT_INPUTS: CalculationInputs = {
  projectType: 'project_plus_retainer',
  scope: {
    webflow:     { hours: SCOPE_META.webflow.defaultHours,     delivery: 'ourselves', contractorRate: SCOPE_META.webflow.defaultRate },
    engineering: { hours: SCOPE_META.engineering.defaultHours, delivery: 'ourselves', contractorRate: SCOPE_META.engineering.defaultRate },
    design:      { hours: SCOPE_META.design.defaultHours,      delivery: 'ourselves', contractorRate: SCOPE_META.design.defaultRate },
    strategy:    { hours: SCOPE_META.strategy.defaultHours,    delivery: 'ourselves', contractorRate: SCOPE_META.strategy.defaultRate },
    toolLicenceCost: 0,
  },
  timeline: {
    startDate: new Date().toISOString().slice(0, 10),
    durationWeeks: 12,
    targetLaunchDate: new Date(Date.now() + 12 * 7 * 86400_000).toISOString().slice(0, 10),
  },
  retainer: {
    monthlyHours: 8,
    durationMonths: 12,
    plan: 'maintain',
  },
  client: {
    currency: 'NZD',
    complexityMultiplier: 1.0,
    relationship: 'warm',
    isReturning: false,
  },
  notes: '',
}

/** Add weeks to a YYYY-MM-DD date and return the same format. */
function addWeeks(isoDate: string, weeks: number): string {
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return isoDate
  d.setDate(d.getDate() + Math.round(weeks * 7))
  return d.toISOString().slice(0, 10)
}

/** Whole weeks (rounded up) between two YYYY-MM-DD dates. Min 1. */
function diffWeeks(startIso: string, endIso: string): number {
  const a = new Date(startIso)
  const b = new Date(endIso)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1
  const ms = b.getTime() - a.getTime()
  const weeks = ms / (7 * 86400_000)
  return Math.max(1, Math.ceil(weeks))
}

export function CalculatorContent({ dealId, orgId }: { dealId: string | null; orgId: string | null }) {
  const { showToast } = useToast()
  const [name, setName] = useState('Untitled calculation')
  const [inputs, setInputs] = useState<CalculationInputs>(DEFAULT_INPUTS)
  const [outputs, setOutputs] = useState<CalculationOutputs | null>(null)
  const [saving, setSaving] = useState(false)
  const [computing, setComputing] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [history, setHistory] = useState<SavedCalculation[]>([])
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // Load any prior calc anchored to this deal.
  const fetchHistory = useCallback(async () => {
    if (!dealId && !orgId) return
    const params = new URLSearchParams()
    if (dealId) params.set('dealId', dealId)
    else if (orgId) params.set('orgId', orgId)
    const res = await fetch(apiPath(`/api/admin/calculator?${params.toString()}`))
    if (!res.ok) return
    const data = await res.json() as { calculations: SavedCalculation[] }
    setHistory(data.calculations)
    const active = data.calculations.find(c => c.isActive === 1) ?? data.calculations[0]
    if (active) {
      try {
        setName(active.name)
        setInputs(JSON.parse(active.inputs) as CalculationInputs)
        setOutputs(JSON.parse(active.outputs) as CalculationOutputs)
        setSavedId(active.id)
      } catch { /* ignore */ }
    }
  }, [dealId, orgId])

  useEffect(() => { void fetchHistory() }, [fetchHistory])

  // Compute on input blur, debounced 400ms so typing doesn't thrash
  // the server.
  useEffect(() => {
    const handle = setTimeout(() => {
      void runCompute(inputs)
    }, 400)
    return () => clearTimeout(handle)
    // Intentionally not depending on runCompute (stable closure).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs])

  async function runCompute(currentInputs: CalculationInputs) {
    setComputing(true)
    try {
      // Use the POST endpoint with a dry-run-ish call: send a name + inputs,
      // get outputs back. The route persists the calc, so we treat each
      // compute as a save. Operators can manually delete or rename.
      const res = await fetch(apiPath('/api/admin/calculator'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          dealId,
          orgId,
          inputs: currentInputs,
        }),
      })
      if (!res.ok) {
        showToast('Calculation failed', 'error')
        return
      }
      const data = await res.json() as { id: string; outputs: CalculationOutputs }
      setOutputs(data.outputs)
      setSavedId(data.id)
      setSavedAt(Date.now())
    } catch {
      showToast('Calculation failed', 'error')
    } finally {
      setComputing(false)
    }
  }

  function patchInputs(patch: Partial<CalculationInputs>) {
    setInputs(prev => ({ ...prev, ...patch }))
  }
  function patchScope(patch: Partial<CalculationInputs['scope']>) {
    setInputs(prev => ({ ...prev, scope: { ...prev.scope, ...patch } }))
  }
  function patchTimeline(patch: Partial<CalculationInputs['timeline']>) {
    setInputs(prev => ({ ...prev, timeline: { ...prev.timeline, ...patch } }))
  }
  function patchRetainer(patch: Partial<CalculationInputs['retainer']>) {
    setInputs(prev => ({ ...prev, retainer: { ...prev.retainer, ...patch } }))
  }
  function patchClient(patch: Partial<CalculationInputs['client']>) {
    setInputs(prev => ({ ...prev, client: { ...prev.client, ...patch } }))
  }

  async function rename() {
    if (!savedId) return
    setSaving(true)
    try {
      await fetch(apiPath('/api/admin/calculator'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: savedId, name: name.trim() || 'Untitled calculation' }),
      })
    } finally {
      setSaving(false)
    }
  }

  const fmt = useMemo(() => new Intl.NumberFormat('en-NZ', {
    style: 'currency',
    currency: inputs.client.currency,
    maximumFractionDigits: 0,
  }), [inputs.client.currency])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <Link href={dealId ? `/deals/${dealId}` : '/deals'} className="inline-flex items-center" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', textDecoration: 'none', gap: '0.375rem' }}>
        <ArrowLeft size={14} />
        {dealId ? 'Back to deal' : 'Back to deals'}
      </Link>

      <header style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{
          width: '2.5rem', height: '2.5rem',
          background: 'var(--color-brand-50)',
          color: 'var(--color-brand)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '0 12px 0 12px',
        }}>
          <CalcIcon size={18} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={rename}
            placeholder="Untitled calculation"
            style={{
              display: 'block', width: '100%',
              fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text)',
              background: 'transparent', border: 'none', padding: 0, outline: 'none',
              letterSpacing: '-0.01em',
            }}
          />
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
            Internal pricing helper. Anchored to {dealId ? 'this deal' : 'no deal yet'}.
          </div>
        </div>
        <SaveStatus saving={saving || computing} savedAt={savedAt} />
      </header>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 22rem',
        gap: 'var(--space-5)',
      }} className="calculator-grid">
        <style>{`
          @media (max-width: 1024px) {
            .calculator-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>

        {/* LEFT: form */}
        <main style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {/* Project type */}
          <Card title="Project shape">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              {(['one_off', 'retainer', 'project_plus_retainer'] as ProjectType[]).map(pt => {
                const active = inputs.projectType === pt
                return (
                  <button
                    key={pt}
                    type="button"
                    onClick={() => patchInputs({ projectType: pt })}
                    style={{
                      ...pillBtn,
                      background: active ? 'var(--color-brand)' : 'var(--color-bg)',
                      color: active ? '#fff' : 'var(--color-text)',
                      borderColor: active ? 'var(--color-brand)' : 'var(--color-border)',
                    }}
                  >
                    {pt === 'one_off' ? 'One-off' : pt === 'retainer' ? 'Retainer' : 'Project + retainer'}
                  </button>
                )
              })}
            </div>
          </Card>

          {/* Scope: per-category line with hours + delivery toggle */}
          <Card title="Scope">
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {SCOPE_KEYS.map(key => {
                const meta = SCOPE_META[key]
                const line = inputs.scope[key]
                const updateLine = (patch: Partial<ScopeLine>) => patchScope({ [key]: { ...line, ...patch } } as Partial<CalculationInputs['scope']>)
                return (
                  <div key={key} style={{
                    display: 'grid',
                    gridTemplateColumns: '8rem 1fr',
                    gap: '0.625rem',
                    alignItems: 'center',
                    padding: '0.625rem 0.75rem',
                    background: 'var(--color-bg-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border-subtle)',
                  }}>
                    <div>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-text)' }}>{meta.label}</div>
                      <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginTop: '0.125rem' }}>{meta.hint}</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '5rem auto 1fr', gap: '0.5rem', alignItems: 'center' }}>
                      <Field label="Hours">
                        <NumberInput value={line.hours} onChange={v => updateLine({ hours: v })} />
                      </Field>
                      <div style={{ display: 'inline-flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--color-border)', alignSelf: 'end', height: '1.875rem' }}>
                        {(['ourselves', 'contractor'] as DeliveryMode[]).map(mode => {
                          const active = line.delivery === mode
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => updateLine({ delivery: mode })}
                              style={{
                                padding: '0 0.625rem',
                                fontSize: '0.6875rem',
                                fontWeight: 600,
                                background: active ? 'var(--color-brand)' : 'transparent',
                                color: active ? '#fff' : 'var(--color-text-muted)',
                                border: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              {mode === 'ourselves' ? 'Us' : 'Contractor'}
                            </button>
                          )
                        })}
                      </div>
                      {line.delivery === 'contractor' ? (
                        <Field label={`${inputs.client.currency}/hr`}>
                          <NumberInput value={line.contractorRate} onChange={v => updateLine({ contractorRate: v })} />
                        </Field>
                      ) : (
                        <div />
                      )}
                    </div>
                  </div>
                )
              })}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.625rem', marginTop: '0.25rem' }}>
                <Field label={`Tool licences (${inputs.client.currency})`}>
                  <NumberInput value={inputs.scope.toolLicenceCost} onChange={v => patchScope({ toolLicenceCost: v })} />
                </Field>
                <div style={{ alignSelf: 'end', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
                  Total scope: {SCOPE_KEYS.reduce((s, k) => s + inputs.scope[k].hours, 0)} hours
                </div>
              </div>
            </div>
          </Card>

          {/* Timeline: duration <-> launch date sync */}
          <Card title="Timeline">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem' }}>
              <Field label="Start date">
                <input
                  type="date"
                  value={inputs.timeline.startDate}
                  onChange={e => {
                    const startDate = e.target.value
                    // Keep duration; recompute launch from start + duration.
                    const targetLaunchDate = addWeeks(startDate, inputs.timeline.durationWeeks)
                    patchTimeline({ startDate, targetLaunchDate })
                  }}
                  style={textInput}
                />
              </Field>
              <Field label="Duration (weeks)">
                <NumberInput
                  value={inputs.timeline.durationWeeks}
                  onChange={v => {
                    const durationWeeks = Math.max(1, v)
                    const targetLaunchDate = addWeeks(inputs.timeline.startDate, durationWeeks)
                    patchTimeline({ durationWeeks, targetLaunchDate })
                  }}
                />
              </Field>
              <Field label="Target launch">
                <input
                  type="date"
                  value={inputs.timeline.targetLaunchDate}
                  onChange={e => {
                    const targetLaunchDate = e.target.value
                    const durationWeeks = diffWeeks(inputs.timeline.startDate, targetLaunchDate)
                    patchTimeline({ targetLaunchDate, durationWeeks })
                  }}
                  style={textInput}
                />
              </Field>
            </div>
          </Card>

          {/* Retainer */}
          {(inputs.projectType !== 'one_off') && (
            <Card title="Retainer">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem' }}>
                <Field label="Monthly hours">
                  <NumberInput value={inputs.retainer.monthlyHours} onChange={v => patchRetainer({ monthlyHours: v })} />
                </Field>
                <Field label="Plan">
                  <select value={inputs.retainer.plan} onChange={e => patchRetainer({ plan: e.target.value as RetainerPlan })} style={textInput}>
                    <option value="maintain">Maintain</option>
                    <option value="scale">Scale</option>
                    <option value="tune">Tune</option>
                    <option value="launch">Launch</option>
                    <option value="custom">Custom</option>
                  </select>
                </Field>
                <Field label="Duration (months)">
                  <NumberInput value={inputs.retainer.durationMonths} onChange={v => patchRetainer({ durationMonths: v })} />
                </Field>
              </div>
            </Card>
          )}

          {/* Client */}
          <Card title="Client + complexity">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.625rem' }}>
              <Field label="Currency">
                <select value={inputs.client.currency} onChange={e => patchClient({ currency: e.target.value as Currency })} style={textInput}>
                  {(['NZD', 'USD', 'GBP', 'AUD', 'EUR'] as Currency[]).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Complexity">
                <select
                  value={inputs.client.complexityMultiplier.toString()}
                  onChange={e => patchClient({ complexityMultiplier: Number(e.target.value) })}
                  style={textInput}
                >
                  <option value="0.7">Simple (0.7×)</option>
                  <option value="0.85">Light (0.85×)</option>
                  <option value="1">Standard (1.0×)</option>
                  <option value="1.15">Stretch (1.15×)</option>
                  <option value="1.3">Complex (1.3×)</option>
                  <option value="1.5">Very complex (1.5×)</option>
                </select>
              </Field>
              <Field label="Relationship">
                <select value={inputs.client.relationship} onChange={e => patchClient({ relationship: e.target.value as ClientRelationship })} style={textInput}>
                  <option value="cold">Cold lead</option>
                  <option value="warm">Warm</option>
                  <option value="returning">Returning</option>
                </select>
              </Field>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', marginTop: '0.625rem' }}>
              <input
                type="checkbox"
                checked={inputs.client.isReturning}
                onChange={e => patchClient({ isReturning: e.target.checked })}
              />
              Returning client (apply 10% lifetime discount)
            </label>
          </Card>

          {/* Notes */}
          <Card title="Notes">
            <textarea
              value={inputs.notes}
              onChange={e => patchInputs({ notes: e.target.value })}
              placeholder="Why these numbers, anything weird about this deal, what to revisit..."
              rows={3}
              style={{ ...textInput, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Card>
        </main>

        {/* RIGHT: live output rail */}
        <aside style={{
          position: 'sticky', top: 'var(--space-5)', alignSelf: 'start',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
        }}>
          {outputs ? (
            <Recommendation outputs={outputs} fmt={fmt} savedId={savedId} />
          ) : (
            <Card title="Recommendation">
              <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                Computing…
              </div>
            </Card>
          )}

          {history.length > 1 && (
            <Card title={`Prior calcs on this ${dealId ? 'deal' : 'org'}`}>
              <div style={{ display: 'grid', gap: '0.375rem' }}>
                {history.filter(h => h.id !== savedId).slice(0, 5).map(h => (
                  <button
                    key={h.id}
                    onClick={() => {
                      try {
                        setName(h.name)
                        setInputs(JSON.parse(h.inputs) as CalculationInputs)
                        setOutputs(JSON.parse(h.outputs) as CalculationOutputs)
                        setSavedId(h.id)
                      } catch { /* ignore */ }
                    }}
                    style={{
                      ...pillBtn,
                      background: 'var(--color-bg-secondary)',
                      borderColor: 'var(--color-border-subtle)',
                      color: 'var(--color-text)',
                      textAlign: 'left',
                      justifyContent: 'flex-start',
                    }}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}

// ─── Output rail ──────────────────────────────────────────────────────────

function Recommendation({ outputs, fmt, savedId }: { outputs: CalculationOutputs; fmt: Intl.NumberFormat; savedId: string | null }) {
  const cap = outputs.capacity.warning
  const capColor = cap === 'over_capacity'
    ? '#dc2626'
    : cap === 'tight'
      ? '#9a3412'
      : '#15803d'

  // Cost vs margin split. The margin is target minus total cost,
  // clamped at 0 in case a calc lands at break-even or below.
  const marginValue = Math.max(0, outputs.recommendation.target - outputs.cost.total)
  const showMarginBreakdown = outputs.cost.total > 0 && outputs.recommendation.target > 0

  return (
    <>
      {/* Hero tile — the proposed quote target. Non-interactive (no href
          or onClick) so the hover lift is off and it reads as a summary,
          not a button. */}
      <FeatureCard variant="forest" padding="md">
        <FeatureCard.Eyebrow>Quote target</FeatureCard.Eyebrow>
        <FeatureCard.Title
          style={{
            fontSize: '2.25rem',
            fontWeight: 800,
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmt.format(outputs.recommendation.target)}
        </FeatureCard.Title>
        <FeatureCard.Description>
          {Math.round(outputs.recommendation.targetMarginPct * 100)}% margin · floor {fmt.format(outputs.recommendation.floor)} · stretch {fmt.format(outputs.recommendation.stretch)}
        </FeatureCard.Description>
      </FeatureCard>

      <Card title="Recommendation" emphasis>
        <div style={{ display: 'grid', gap: '0.625rem' }}>
          <div>
            <div style={mutedLabel}>Quote target</div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-brand)', letterSpacing: '-0.02em', lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
              {fmt.format(outputs.recommendation.target)}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
              {Math.round(outputs.recommendation.targetMarginPct * 100)}% margin
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <RangeStat label="Floor" value={fmt.format(outputs.recommendation.floor)} hint="Don't go below" />
            <RangeStat label="Stretch" value={fmt.format(outputs.recommendation.stretch)} hint="Premium ceiling" />
          </div>
        </div>
      </Card>

      {savedId && <DraftActions calculationId={savedId} />}

      <Card title="Cost breakdown">
        <Row label="Internal hours" value={fmt.format(outputs.cost.internal)} />
        <Row label="Direct (contractor + tools)" value={fmt.format(outputs.cost.direct)} />
        <Row label="Total cost" value={fmt.format(outputs.cost.total)} bold />
        <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginTop: '0.5rem' }}>
          Internal rate: NZD {outputs.effectiveHourlyRate}/hr (effective).
        </div>
        {showMarginBreakdown && (
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.75rem' }}>
            <DonutChart
              segments={[
                { label: 'Internal cost', value: outputs.cost.internal },
                { label: 'Direct cost', value: outputs.cost.direct },
                { label: 'Margin', value: marginValue },
              ]}
              size={148}
              centreLabel="Margin"
              centreValue={`${Math.round(outputs.recommendation.targetMarginPct * 100)}%`}
              ariaLabel="Cost versus margin breakdown"
            />
          </div>
        )}
      </Card>

      <Card title="Capacity">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: capColor }} aria-hidden="true" />
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: capColor, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {cap.replace('_', ' ')}
          </span>
        </div>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: '0.5rem 0 0 0', lineHeight: 1.5 }}>
          {outputs.capacity.note}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.625rem' }}>
          <RangeStat label="Required" value={`${outputs.capacity.requiredHoursThisQuarter}h`} />
          <RangeStat label="Available" value={`${outputs.capacity.availableHoursThisQuarter}h`} />
        </div>
      </Card>

      {outputs.benchmarks.medianValueForSimilar !== null && (
        <Card title="Benchmark vs similar deals">
          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>
            Median: <strong>{fmt.format(outputs.benchmarks.medianValueForSimilar)}</strong>
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
            Your target is {outputs.benchmarks.yourPriceVsMedian.replace('_', ' ')} the median of {outputs.benchmarks.similarDeals.length} comparable deal(s) in the past 24 months.
          </div>
        </Card>
      )}

      {outputs.pacing.asProjectPlusRetainer && (
        <Card title="Project + retainer pacing">
          <Row label="Project fee" value={fmt.format(outputs.pacing.asProjectPlusRetainer.projectFee)} />
          <Row label="Monthly retainer" value={`${fmt.format(outputs.pacing.asProjectPlusRetainer.monthlyFee)}/mo`} />
          <Row label="12-month LTV" value={fmt.format(outputs.pacing.asProjectPlusRetainer.twelveMonthLifetimeValue)} bold />
        </Card>
      )}
    </>
  )
}

// ─── Small bits ───────────────────────────────────────────────────────────

function DraftActions({ calculationId }: { calculationId: string }) {
  const [busy, setBusy] = useState<null | 'proposal' | 'schedule' | 'contract'>(null)
  const router = useRouter()
  async function draft(target: 'proposal' | 'schedule' | 'contract') {
    setBusy(target)
    try {
      const res = await fetch(apiPath('/api/admin/calculator/draft'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calculationId, target }),
      })
      if (!res.ok) return
      const data = await res.json() as { id: string; url: string }
      router.push(data.url)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Card title="Draft from this calc">
      <div style={{ display: 'grid', gap: '0.4375rem' }}>
        {([
          { target: 'proposal' as const, label: 'Draft proposal', Icon: FileText },
          { target: 'schedule' as const, label: 'Draft schedule', Icon: Calendar },
          { target: 'contract' as const, label: 'Draft contract', Icon: FileSignature },
        ]).map(({ target, label, Icon }) => (
          <TahiButton
            key={target}
            variant="secondary"
            size="sm"
            loading={busy === target}
            disabled={busy !== null && busy !== target}
            onClick={() => draft(target)}
            iconLeft={<Icon size={13} aria-hidden="true" />}
            style={{ justifyContent: 'flex-start', width: '100%' }}
          >
            {busy === target ? `Drafting ${target}...` : label}
          </TahiButton>
        ))}
      </div>
    </Card>
  )
}

function Card({ title, children, emphasis }: { title: string; children: React.ReactNode; emphasis?: boolean }) {
  return (
    <div style={{
      padding: '1.125rem 1.25rem',
      background: 'var(--color-bg)',
      border: emphasis ? '1px solid var(--color-brand)' : '1px solid var(--color-border-subtle)',
      borderRadius: emphasis ? 'var(--radius-leaf-sm, 0 10px 0 10px)' : 'var(--radius-md)',
      boxShadow: emphasis ? '0 16px 40px -24px rgba(90, 130, 78, 0.18)' : 'none',
    }}>
      <div style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.625rem' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={mutedLabel}>{label}</span>
      {children}
    </label>
  )
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(Number(e.target.value) || 0)}
      style={textInput}
    />
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0.25rem 0', borderTop: '1px solid var(--color-border-subtle)' }}>
      <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontSize: bold ? '0.9375rem' : '0.8125rem', fontWeight: bold ? 800 : 600, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

function RangeStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div style={mutedLabel}>{label}</div>
      <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {hint && <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginTop: '0.0625rem' }}>{hint}</div>}
    </div>
  )
}

function SaveStatus({ saving, savedAt }: { saving: boolean; savedAt: number | null }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 5000)
    return () => clearInterval(t)
  }, [])
  if (saving) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
        <Save size={11} /> Computing…
      </span>
    )
  }
  if (!savedAt) return null
  const elapsed = Math.max(1, Math.round((Date.now() - savedAt) / 1000))
  const label = elapsed < 5 ? 'Saved' : elapsed < 60 ? `Saved ${elapsed}s ago` : `Saved ${Math.round(elapsed / 60)}m ago`
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
      <Check size={11} style={{ color: 'var(--color-brand)' }} /> {label}
    </span>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────

const textInput: React.CSSProperties = {
  width: '100%',
  padding: '0.4375rem 0.625rem',
  fontSize: '0.8125rem',
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text)',
  outline: 'none',
  fontFamily: 'inherit',
}

const pillBtn: React.CSSProperties = {
  padding: '0.4375rem 0.75rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.375rem',
}

const mutedLabel: React.CSSProperties = {
  display: 'block',
  fontSize: '0.625rem',
  fontWeight: 600,
  color: 'var(--color-text-subtle)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '0.25rem',
}
