/**
 * Per-type structured editors for proposal sections.
 *
 * <TypedSectionFields> dispatches based on section type and renders a small
 * focussed form for each. The legacy types (overview/about/terms/scope_shared/
 * text/testimonial) still use the simple HTML/quote forms inside
 * proposal-detail.tsx; this module covers only the new sales-led types.
 *
 * Pattern: each type gets a stateful editor that reads from `data` and emits
 * a complete replacement object via `onChange`. Save-on-blur is handled by
 * the parent.
 */
'use client'

import React from 'react'
import { Plus, Trash2 } from 'lucide-react'

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.625rem',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md, 0.5rem)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  fontSize: '0.8125rem',
  outline: 'none',
}
const labelStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: '0.25rem',
  display: 'block',
}
const cardStyle: React.CSSProperties = {
  border: '1px dashed var(--color-border-subtle)',
  borderRadius: 'var(--radius-md, 0.5rem)',
  padding: '0.625rem 0.75rem',
  display: 'grid',
  gap: '0.5rem',
  background: 'var(--color-bg-secondary)',
}
const smallBtn: React.CSSProperties = {
  fontSize: '0.75rem',
  padding: '0.25rem 0.625rem',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm, 0.375rem)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  // Centre icon + label horizontally so the Trash glyph sits dead-centre
  // when the button is icon-only (no label content to balance it).
  justifyContent: 'center',
  gap: '0.25rem',
  lineHeight: 1,
}

interface FieldsProps {
  data: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}

export function TypedSectionFields({
  type, data, onChange,
}: { type: string } & FieldsProps) {
  switch (type) {
    case 'value_anchor':       return <ValueAnchorFields data={data} onChange={onChange} />
    case 'process':            return <ListFields data={data} onChange={onChange} key_field="steps" itemKeys={['title', 'body', 'eyebrow']} placeholders={{ title: 'Discovery', body: 'A short call to understand goals…', eyebrow: 'optional' }} />
    case 'differentiators':    return <ListFields data={data} onChange={onChange} key_field="items" itemKeys={['icon', 'title', 'body']} placeholders={{ icon: 'founder|partner|sparkle|code|leaf|shield', title: 'Founder-led', body: 'Liam and Staci on the call…' }} />
    case 'case_study':         return <ListFields data={data} onChange={onChange} key_field="items" itemKeys={['client', 'problem', 'outcome', 'metric', 'link', 'quote', 'quoteAuthor']} placeholders={{ client: 'Physitrack', problem: 'Outdated marketing site…', outcome: 'Full Webflow rebuild + AEO', metric: '12-month retainer', link: 'https://tahi.studio/case-studies/physitrack (optional)', quote: 'optional', quoteAuthor: 'optional' }} />
    case 'testimonial_stack':  return <ListFields data={data} onChange={onChange} key_field="items" itemKeys={['quote', 'author', 'role', 'company']} placeholders={{ quote: '"They are the only…"', author: 'Marketing Lead', role: 'Director', company: 'Acme Inc.' }} />
    case 'faq':                return <ListFields data={data} onChange={onChange} key_field="items" itemKeys={['q', 'a']} placeholders={{ q: 'What if I want to stop?', a: 'You can. We bill month-to-month…' }} multiline={['a']} />
    case 'guarantee':          return <GuaranteeFields data={data} onChange={onChange} />
    case 'retainer_offer':     return <RetainerOfferFields data={data} onChange={onChange} />
    case 'founders':           return <FoundersFields data={data} onChange={onChange} />
    case 'partner_badges':     return <PartnerBadgesFields data={data} onChange={onChange} />
    default:                   return null
  }
}

// ─── partner_badges ───────────────────────────────────────────────────────

function PartnerBadgesFields({ data, onChange }: FieldsProps) {
  type Item = { label: string; sub?: string; logo?: string }
  const eyebrow = String(data.eyebrow ?? '')
  const intro = String(data.intro ?? '')
  const items: Item[] = Array.isArray(data.items) ? (data.items as Item[]) : []
  const set = (patch: Record<string, unknown>) => onChange({ ...data, ...patch })
  const updateAt = (i: number, patch: Partial<Item>) => set({ items: items.map((it, j) => j === i ? { ...it, ...patch } : it) })
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <Field label="Eyebrow"><input value={eyebrow} onChange={e => set({ eyebrow: e.target.value })} placeholder="Credentialled team" style={inputStyle} /></Field>
      <Field label="Intro"><input value={intro} onChange={e => set({ intro: e.target.value })} placeholder="Vetted by the platforms we build on." style={inputStyle} /></Field>
      <div>
        <span style={labelStyle}>Badges</span>
        <div style={{ display: 'grid', gap: '0.375rem' }}>
          {items.map((it, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Badge {i + 1}</span>
                <button onClick={() => set({ items: items.filter((_, j) => j !== i) })} style={{ ...smallBtn, padding: '0.25rem 0.375rem' }} aria-label="Remove"><Trash2 size={12} /></button>
              </div>
              <Field label="label"><input value={it.label} onChange={e => updateAt(i, { label: e.target.value })} placeholder="Webflow Premium Partner" style={inputStyle} /></Field>
              <Field label="sub"><input value={it.sub ?? ''} onChange={e => updateAt(i, { sub: e.target.value })} placeholder="Direct platform support" style={inputStyle} /></Field>
              <Field label="logo URL (optional)"><input value={it.logo ?? ''} onChange={e => updateAt(i, { logo: e.target.value })} placeholder="https://… (renders next to the label)" style={inputStyle} /></Field>
            </div>
          ))}
          <button onClick={() => set({ items: [...items, { label: '', sub: '', logo: '' }] })} style={smallBtn}><Plus size={12} />Add badge</button>
        </div>
      </div>
    </div>
  )
}

// ─── founders ─────────────────────────────────────────────────────────────

function FoundersFields({ data, onChange }: FieldsProps) {
  type Person = { name: string; role: string }
  const eyebrow = String(data.eyebrow ?? '')
  const intro = String(data.intro ?? '')
  const image = String(data.image ?? '')
  const imagePosition = String(data.imagePosition ?? '50% 25%')
  const people: Person[] = Array.isArray(data.people) ? (data.people as Person[]) : []
  const set = (patch: Record<string, unknown>) => onChange({ ...data, ...patch })
  const updateAt = (i: number, patch: Partial<Person>) => {
    const next = people.map((p, j) => j === i ? { ...p, ...patch } : p)
    set({ people: next })
  }
  const removeAt = (i: number) => set({ people: people.filter((_, j) => j !== i) })
  const add = () => set({ people: [...people, { name: '', role: '' }] })

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <Field label="Eyebrow">
        <input value={eyebrow} onChange={e => set({ eyebrow: e.target.value })} placeholder="The team on your build" style={inputStyle} />
      </Field>
      <Field label="Intro paragraph">
        <textarea
          value={intro}
          onChange={e => set({ intro: e.target.value })}
          placeholder="Founder-led, end-to-end. Liam runs engineering, Staci runs design…"
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '0.5rem' }}>
        <Field label="Image URL (one shared photo of all founders)">
          <input
            value={image}
            onChange={e => set({ image: e.target.value })}
            placeholder="/proposals/founders-placeholder.jpg"
            style={inputStyle}
          />
        </Field>
        <Field label="Image crop">
          <input
            value={imagePosition}
            onChange={e => set({ imagePosition: e.target.value })}
            placeholder="50% 25%"
            style={inputStyle}
            title="CSS object-position. Higher Y crops upward; e.g. '50% 15%' shows more of the top of the image."
          />
        </Field>
      </div>
      <div>
        <span style={labelStyle}>People (shown as role pills under the intro)</span>
        <div style={{ display: 'grid', gap: '0.375rem' }}>
          {people.map((p, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 2rem', gap: '0.375rem', alignItems: 'center' }}>
              <input value={p.name} onChange={e => updateAt(i, { name: e.target.value })} placeholder="Liam Miller" style={inputStyle} />
              <input value={p.role} onChange={e => updateAt(i, { role: e.target.value })} placeholder="Engineering" style={inputStyle} />
              <button onClick={() => removeAt(i)} style={{ ...smallBtn, padding: '0.25rem 0.375rem' }} aria-label="Remove"><Trash2 size={12} /></button>
            </div>
          ))}
          <button onClick={add} style={smallBtn}><Plus size={12} />Add person</button>
        </div>
      </div>
    </div>
  )
}

// ─── value_anchor ─────────────────────────────────────────────────────────

function ValueAnchorFields({ data, onChange }: FieldsProps) {
  type Alt = { label: string; lo: number; hi: number }
  const eyebrow = String(data.eyebrow ?? '')
  const planLabel = String(data.planLabel ?? '')
  const planPrice = String(data.planPrice ?? '')
  const planUnit = String(data.planUnit ?? '')
  const unit = String(data.unit ?? 'mo')
  const footer = String(data.footer ?? '')
  const alts = Array.isArray(data.alternatives) ? (data.alternatives as Alt[]) : []
  const set = (patch: Record<string, unknown>) => onChange({ ...data, ...patch })

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <Field label="Eyebrow"><input value={eyebrow} onChange={e => set({ eyebrow: e.target.value })} style={inputStyle} /></Field>
        <Field label="Unit"><select value={unit} onChange={e => set({ unit: e.target.value })} style={inputStyle}><option value="mo">per month</option><option value="project">project</option></select></Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.5rem' }}>
        <Field label="Plan label"><input value={planLabel} onChange={e => set({ planLabel: e.target.value })} placeholder="Maintain plan" style={inputStyle} /></Field>
        <Field label="Plan price"><input value={planPrice} onChange={e => set({ planPrice: e.target.value })} placeholder="$1,500" style={inputStyle} /></Field>
        <Field label="Plan unit"><input value={planUnit} onChange={e => set({ planUnit: e.target.value })} placeholder="/mo" style={inputStyle} /></Field>
      </div>
      <div>
        <span style={labelStyle}>Alternatives</span>
        <div style={{ display: 'grid', gap: '0.375rem' }}>
          {alts.map((a, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 2rem', gap: '0.375rem', alignItems: 'center' }}>
              <input value={a.label} onChange={e => { const next = [...alts]; next[i] = { ...a, label: e.target.value }; set({ alternatives: next }) }} placeholder="Webflow developer" style={inputStyle} />
              <input type="number" value={a.lo} onChange={e => { const next = [...alts]; next[i] = { ...a, lo: Number(e.target.value) }; set({ alternatives: next }) }} placeholder="1100" style={inputStyle} />
              <input type="number" value={a.hi} onChange={e => { const next = [...alts]; next[i] = { ...a, hi: Number(e.target.value) }; set({ alternatives: next }) }} placeholder="3000" style={inputStyle} />
              <button onClick={() => set({ alternatives: alts.filter((_, j) => j !== i) })} style={{ ...smallBtn, padding: '0.25rem 0.375rem' }} aria-label="Remove"><Trash2 size={12} /></button>
            </div>
          ))}
          <button onClick={() => set({ alternatives: [...alts, { label: '', lo: 0, hi: 0 }] })} style={smallBtn}><Plus size={12} />Add alternative</button>
        </div>
      </div>
      <Field label="Footer note">
        <input value={footer} onChange={e => set({ footer: e.target.value })} placeholder="Hiring separately also means coordinating four to five different relationships." style={inputStyle} />
      </Field>
    </div>
  )
}

// ─── Generic list-of-objects editor (process, differentiators, case_study,
//     testimonial_stack, faq) ──────────────────────────────────────────────

function ListFields({
  data, onChange, key_field, itemKeys, placeholders, multiline = [],
}: FieldsProps & {
  key_field: string
  itemKeys: string[]
  placeholders: Record<string, string>
  multiline?: string[]
}) {
  type Item = Record<string, string>
  const items: Item[] = Array.isArray(data[key_field]) ? (data[key_field] as Item[]) : []
  const set = (next: Item[]) => onChange({ ...data, [key_field]: next })
  const updateAt = (i: number, patch: Partial<Item>) => {
    const next: Item[] = items.map((it, j) => {
      if (j !== i) return it
      const merged: Item = { ...it }
      for (const [k, v] of Object.entries(patch)) merged[k] = v ?? ''
      return merged
    })
    set(next)
  }
  const removeAt = (i: number) => set(items.filter((_, j) => j !== i))
  const add = () => {
    const blank: Item = {}
    for (const k of itemKeys) blank[k] = ''
    set([...items, blank])
  }
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {items.map((it, i) => (
          <div key={i} style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Item {i + 1}</span>
              <button onClick={() => removeAt(i)} style={{ ...smallBtn, padding: '0.25rem 0.375rem' }} aria-label="Remove"><Trash2 size={12} /></button>
            </div>
            {itemKeys.map(k => (
              <Field key={k} label={k}>
                {multiline.includes(k) ? (
                  <textarea
                    rows={3}
                    value={it[k] ?? ''}
                    onChange={e => updateAt(i, { [k]: e.target.value })}
                    placeholder={placeholders[k] ?? ''}
                    style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
                  />
                ) : (
                  <input
                    value={it[k] ?? ''}
                    onChange={e => updateAt(i, { [k]: e.target.value })}
                    placeholder={placeholders[k] ?? ''}
                    style={inputStyle}
                  />
                )}
              </Field>
            ))}
          </div>
        ))}
      </div>
      <div><button onClick={add} style={smallBtn}><Plus size={12} />Add item</button></div>
    </div>
  )
}

// ─── guarantee ─────────────────────────────────────────────────────────────

function GuaranteeFields({ data, onChange }: FieldsProps) {
  const headline = String(data.headline ?? '')
  const body = String(data.body ?? '')
  const badges = Array.isArray(data.badges) ? (data.badges as string[]) : []
  const set = (patch: Record<string, unknown>) => onChange({ ...data, ...patch })
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <Field label="Headline"><input value={headline} onChange={e => set({ headline: e.target.value })} style={inputStyle} /></Field>
      <Field label="Body">
        <textarea rows={3} value={body} onChange={e => set({ body: e.target.value })} style={{ ...inputStyle, fontFamily: 'inherit' }} />
      </Field>
      <div>
        <span style={labelStyle}>Badges</span>
        <div style={{ display: 'grid', gap: '0.375rem' }}>
          {badges.map((b, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2rem', gap: '0.375rem' }}>
              <input value={b} onChange={e => { const next = [...badges]; next[i] = e.target.value; set({ badges: next }) }} placeholder="No lock-in" style={inputStyle} />
              <button onClick={() => set({ badges: badges.filter((_, j) => j !== i) })} style={{ ...smallBtn, padding: '0.25rem 0.375rem' }} aria-label="Remove"><Trash2 size={12} /></button>
            </div>
          ))}
          <button onClick={() => set({ badges: [...badges, ''] })} style={smallBtn}><Plus size={12} />Add badge</button>
        </div>
      </div>
    </div>
  )
}

// ─── retainer_offer ────────────────────────────────────────────────────────

function RetainerOfferFields({ data, onChange }: FieldsProps) {
  type Plan = { name: string; regular: number; discounted: number; currency: string; unit: string; tagline?: string }
  const eyebrow = String(data.eyebrow ?? '')
  const headline = String(data.headline ?? '')
  const body = String(data.body ?? '')
  const footnote = String(data.footnote ?? '')
  const plans: Plan[] = Array.isArray(data.plans) ? (data.plans as Plan[]) : []
  const set = (patch: Record<string, unknown>) => onChange({ ...data, ...patch })
  const updatePlan = (i: number, patch: Partial<Plan>) => set({ plans: plans.map((p, j) => j === i ? { ...p, ...patch } : p) })
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.5rem' }}>
        <Field label="Eyebrow"><input value={eyebrow} onChange={e => set({ eyebrow: e.target.value })} style={inputStyle} /></Field>
        <Field label="Headline"><input value={headline} onChange={e => set({ headline: e.target.value })} style={inputStyle} /></Field>
      </div>
      <Field label="Body">
        <textarea rows={3} value={body} onChange={e => set({ body: e.target.value })} style={{ ...inputStyle, fontFamily: 'inherit' }} />
      </Field>
      <div>
        <span style={labelStyle}>Plans</span>
        <div style={{ display: 'grid', gap: '0.375rem' }}>
          {plans.map((p, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 0.75fr 2rem', gap: '0.375rem', alignItems: 'center' }}>
                <input value={p.name} onChange={e => updatePlan(i, { name: e.target.value })} placeholder="Maintain" style={inputStyle} />
                <input type="number" value={p.regular} onChange={e => updatePlan(i, { regular: Number(e.target.value) })} placeholder="1500" style={inputStyle} />
                <input type="number" value={p.discounted} onChange={e => updatePlan(i, { discounted: Number(e.target.value) })} placeholder="1350" style={inputStyle} />
                <select value={p.currency} onChange={e => updatePlan(i, { currency: e.target.value })} style={inputStyle}>
                  <option value="USD">USD</option><option value="GBP">GBP</option><option value="NZD">NZD</option>
                </select>
                <input value={p.unit} onChange={e => updatePlan(i, { unit: e.target.value })} placeholder="mo" style={inputStyle} />
                <button onClick={() => set({ plans: plans.filter((_, j) => j !== i) })} style={{ ...smallBtn, padding: '0.25rem 0.375rem' }} aria-label="Remove"><Trash2 size={12} /></button>
              </div>
              <input value={p.tagline ?? ''} onChange={e => updatePlan(i, { tagline: e.target.value })} placeholder="Tagline (optional)" style={inputStyle} />
            </div>
          ))}
          <button onClick={() => set({ plans: [...plans, { name: '', regular: 0, discounted: 0, currency: 'USD', unit: 'mo' }] })} style={smallBtn}><Plus size={12} />Add plan</button>
        </div>
      </div>
      <Field label="Footnote">
        <input value={footnote} onChange={e => set({ footnote: e.target.value })} style={inputStyle} />
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: 'block' }}><span style={labelStyle}>{label}</span>{children}</label>
}
