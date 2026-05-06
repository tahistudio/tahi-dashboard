/**
 * Public-side proposal section renderers — one per section type.
 *
 * The shared <ProposalSectionBlock /> is a dispatcher that picks a renderer
 * based on `section.type`. Each renderer reads its typed shape from
 * `section.data` (JSON column).
 *
 * Editors for each type live in
 * `app/(dashboard)/proposals/[id]/section-editors.tsx` and write the same
 * shapes back. Default-data factories are exported so the admin's "Add
 * section" flow can seed something useful.
 */
import React from 'react'

// ─── Types ────────────────────────────────────────────────────────────────

export type SectionType =
  | 'overview' | 'about' | 'terms' | 'scope_shared' | 'text'
  | 'testimonial'                 // legacy single quote
  | 'value_anchor'                // cost-comparison math
  | 'process'                     // 5-step timeline
  | 'differentiators'             // icon grid
  | 'case_study'                  // logo + problem + outcome stack
  | 'testimonial_stack'           // multi-quote
  | 'faq'                         // Q/A list
  | 'guarantee'                   // risk-reversal callout
  | 'retainer_offer'              // 10% lifetime hook

export interface PublicSection {
  id: string
  type: string
  title: string | null
  subtitle: string | null
  data: string | null
  position: number
}

// ─── Default data factories ─────────────────────────────────────────────────

export function defaultDataForType(type: SectionType): Record<string, unknown> {
  switch (type) {
    case 'value_anchor':
      return {
        eyebrow: 'The math',
        planLabel: 'Maintain plan',
        planPrice: '$1,500',
        planUnit: '/mo',
        alternatives: [
          { label: 'Webflow developer', lo: 1100, hi: 3000 },
          { label: 'UI/UX designer', lo: 600, hi: 1500 },
          { label: 'Analytics + attribution', lo: 500, hi: 2000 },
          { label: 'SEO/AEO specialist', lo: 1000, hi: 3000 },
        ],
        unit: 'mo',
        currency: 'USD',
        footer: 'Hiring separately also means coordinating four to five different relationships.',
      }
    case 'process':
      return {
        steps: [
          { title: 'Discovery', body: 'A short call (or structured email) to understand goals, constraints and success.' },
          { title: 'Proposal', body: 'Same-day proposal with scope, deliverables and investment. No back-and-forth weeks.' },
          { title: 'Sign + onboard', body: 'You sign in-dashboard. We send a personal Loom walkthrough of your client portal.' },
          { title: 'Build + deliver', body: 'Tracks move through the dashboard. You see progress live and can request changes anytime.' },
          { title: 'Handoff + retainer', body: 'Clean handoff with all assets. The conversation about ongoing support starts naturally.' },
        ],
      }
    case 'differentiators':
      return {
        items: [
          { icon: 'founder', title: 'Founder-led', body: 'Liam (engineering) and Staci (design) are on the call and on the build. No account managers.' },
          { icon: 'partner', title: 'Webflow Premium Partner', body: 'Direct contacts inside Webflow. Better tooling, faster escalations, working toward Enterprise.' },
          { icon: 'sparkle', title: 'AEO as a real service', body: 'Structuring content so ChatGPT, Claude and Gemini surface it in answers. Most agencies are still at SEO.' },
          { icon: 'code', title: 'Engineering depth', body: 'Attribution, CRM integration, analytics ownership — we ship what most agencies hand off.' },
          { icon: 'leaf', title: 'Carbon negative', body: '1% of revenue plants enough trees through Trees That Count to absorb more CO₂ than your site’s page views.' },
          { icon: 'shield', title: 'No lock-in', body: 'You stay because the work is good, not because a contract traps you.' },
        ],
      }
    case 'case_study':
      return {
        items: [
          { client: 'Physitrack', problem: 'Outdated marketing site holding back enterprise sales conversations.', outcome: 'Full Webflow rebuild + AEO restructure.', metric: 'Drove 12-month retainer relationship.' },
          { client: 'Elevate (Telcom Networks)', problem: 'Hourly Webflow needs with no consistent dev capacity.', outcome: 'On-demand small-track delivery, dashboard-managed.', metric: 'Trusted with every Webflow change for 18 months.' },
          { client: 'Glasswall Solutions', problem: 'Marketing team needed a dependable Webflow partner alongside in-house.', outcome: 'GBP 1,250/mo retainer covering ongoing improvements.', metric: 'Zero churn since onboarding.' },
        ],
      }
    case 'testimonial_stack':
      return {
        items: [
          { quote: 'They’re the only Webflow team we trust with our enterprise pages.', author: 'Marketing lead', company: 'Anonymous fintech' },
        ],
      }
    case 'faq':
      return {
        items: [
          { q: 'What if I want to stop the retainer?', a: 'You can. We bill month-to-month with no lock-in. Clients stay because the work is good, not because a contract traps them.' },
          { q: 'Who actually does the work?', a: 'Liam (engineering) and Staci (design). For specialist work like CRO we bring in trusted contractors, but the founders are always on the build.' },
          { q: 'How fast do you respond?', a: 'Same-day on dashboard messages during business hours. Proactive update if a task is taking longer than expected — never silence.' },
          { q: 'What about scope creep?', a: 'We flag it early and discuss it before it becomes a problem. Honest pushback is part of the relationship.' },
        ],
      }
    case 'guarantee':
      return {
        headline: 'No surprises, no lock-in',
        body: 'Month-to-month retainer with no minimum term. If the work isn’t doing what you need, we say so first. If it’s the right fit, you stay because you want to.',
        badges: ['No lock-in', 'Same-day responses', 'Honest scoping'],
      }
    case 'retainer_offer':
      return {
        eyebrow: 'After the project',
        headline: 'Your 10% lifetime discount, already earned',
        body: 'Because you’re trusting us with this project, you’ve already earned 10% off Maintain or Scale — for as long as you’re a client. The discount never expires and never gets reviewed. It’s a thank-you for the trust, not a hook.',
        plans: [
          { name: 'Maintain', regular: 1500, discounted: 1350, currency: 'USD', unit: 'mo', tagline: 'Steady improvement, one small track at a time.' },
          { name: 'Scale', regular: 4000, discounted: 3600, currency: 'USD', unit: 'mo', tagline: 'Two tracks, design + dev + strategy.' },
        ],
        footnote: 'Talk to us 2–3 weeks before delivery and we’ll set it up so it’s ready the day the project closes.',
      }
    default:
      return { html: '' }
  }
}

// ─── Renderers ───────────────────────────────────────────────────────────────

function safeParse<T>(json: string | null): T | null {
  if (!json) return null
  try { return JSON.parse(json) as T } catch { return null }
}

export function ProposalSectionBlock({ section }: { section: PublicSection }) {
  switch (section.type) {
    case 'value_anchor':       return <ValueAnchor section={section} />
    case 'process':            return <Process section={section} />
    case 'differentiators':    return <Differentiators section={section} />
    case 'case_study':         return <CaseStudies section={section} />
    case 'testimonial':        return <SingleTestimonial section={section} />
    case 'testimonial_stack':  return <TestimonialStack section={section} />
    case 'faq':                return <FAQ section={section} />
    case 'guarantee':          return <Guarantee section={section} />
    case 'retainer_offer':     return <RetainerOffer section={section} />
    default:                   return <HtmlSection section={section} />
  }
}

// HTML/rich-text section (overview, terms, about, scope_shared, text)
function HtmlSection({ section }: { section: PublicSection }) {
  const data = safeParse<{ html?: string }>(section.data)
  const html = data?.html ?? ''
  return (
    <section style={slideShell} className="proposal-slide">
      {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
      {section.title && <h2 style={slideTitle}>{section.title}</h2>}
      <div style={proseStyle} dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  )
}

function SingleTestimonial({ section }: { section: PublicSection }) {
  const data = safeParse<{ quote?: string; author?: string; role?: string; company?: string }>(section.data)
  if (!data?.quote) return null
  return (
    <section style={slideShell} className="proposal-slide">
      {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
      {section.title && <h2 style={slideTitle}>{section.title}</h2>}
      <blockquote style={{ fontSize: '1.375rem', lineHeight: 1.45, color: '#1f2c1a', margin: '1.25rem 0 1rem 0', fontStyle: 'italic', fontWeight: 500 }}>
        &ldquo;{data.quote}&rdquo;
      </blockquote>
      <div style={{ fontSize: '0.875rem', color: '#5a6657' }}>
        <strong style={{ color: '#1f2c1a' }}>{data.author ?? ''}</strong>
        {data.role ? <span> · {data.role}</span> : null}
        {data.company ? <span style={{ color: '#8a9987' }}> · {data.company}</span> : null}
      </div>
    </section>
  )
}

function ValueAnchor({ section }: { section: PublicSection }) {
  type Alt = { label: string; lo: number; hi: number }
  const data = safeParse<{
    eyebrow?: string
    planLabel?: string
    planPrice?: string
    planUnit?: string
    alternatives?: Alt[]
    unit?: 'mo' | 'project'
    currency?: string
    footer?: string
  }>(section.data)
  const alts = data?.alternatives ?? []
  const lo = alts.reduce((s, a) => s + a.lo, 0)
  const hi = alts.reduce((s, a) => s + a.hi, 0)
  const fmt = (n: number) => `$${n.toLocaleString()}`
  return (
    <section style={slideShell} className="proposal-slide">
      {(data?.eyebrow ?? section.subtitle) && <div style={slideEyebrow}>{data?.eyebrow ?? section.subtitle}</div>}
      {section.title && <h2 style={slideTitle}>{section.title}</h2>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: '1rem', marginTop: '1rem' }}>
        {/* Stacked alternatives */}
        <div style={{ background: '#fdfefd', border: '1px dashed #d4e0d0', borderRadius: '0.875rem', padding: '1.25rem' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#8a9987', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>
            Hiring separately
          </div>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {alts.map(a => (
              <div key={a.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.875rem', color: '#1f2c1a' }}>
                <span>{a.label}</span>
                <span style={{ color: '#5a6657', fontVariantNumeric: 'tabular-nums' }}>
                  {fmt(a.lo)}–{fmt(a.hi)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid #e8f0e6', marginTop: '0.875rem', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong style={{ fontSize: '0.875rem' }}>Total</strong>
            <strong style={{ fontSize: '1.125rem', fontVariantNumeric: 'tabular-nums', color: '#1f2c1a' }}>
              {fmt(lo)}–{fmt(hi)}{data?.unit === 'mo' ? '/mo' : ''}
            </strong>
          </div>
        </div>
        {/* Tahi side */}
        <div style={{ background: '#1f2c1a', color: '#ffffff', borderRadius: '0 24px 0 24px', padding: '1.5rem' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#93c98a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>
            With Tahi
          </div>
          <div style={{ fontSize: '0.875rem', color: '#dcefd8', marginBottom: '0.5rem' }}>{data?.planLabel ?? ''}</div>
          <div style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1, color: '#ffffff' }}>
            {data?.planPrice ?? ''}<span style={{ fontSize: '1rem', fontWeight: 600, color: '#93c98a' }}>{data?.planUnit ?? ''}</span>
          </div>
          <div style={{ marginTop: '1.25rem', fontSize: '0.875rem', color: '#dcefd8', lineHeight: 1.55 }}>
            One team, one invoice, one source of truth. The other version of this is four contractors and a spreadsheet.
          </div>
        </div>
      </div>
      {data?.footer && (
        <p style={{ fontSize: '0.875rem', color: '#5a6657', marginTop: '1rem', marginBottom: 0 }}>{data.footer}</p>
      )}
    </section>
  )
}

function Process({ section }: { section: PublicSection }) {
  const data = safeParse<{ steps?: { title: string; body: string; eyebrow?: string }[] }>(section.data)
  const steps = data?.steps ?? []
  return (
    <section style={slideShell} className="proposal-slide">
      {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
      {section.title && <h2 style={slideTitle}>{section.title}</h2>}
      <ol style={{ listStyle: 'none', padding: 0, margin: '1.25rem 0 0 0', display: 'grid', gap: '0.75rem' }}>
        {steps.map((s, i) => (
          <li key={i} style={{ display: 'grid', gridTemplateColumns: '2.25rem 1fr', gap: '1rem', alignItems: 'flex-start', padding: '1rem 1.125rem', background: '#fdfefd', border: '1px solid #e8f0e6', borderRadius: '0.875rem' }}>
            <div style={{
              width: '2.25rem', height: '2.25rem', borderRadius: '0 12px 0 12px',
              background: '#5A824E', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.875rem', fontWeight: 800,
            }}>{i + 1}</div>
            <div>
              {s.eyebrow && <div style={{ fontSize: '0.625rem', fontWeight: 700, color: '#8a9987', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.125rem' }}>{s.eyebrow}</div>}
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1f2c1a', marginBottom: '0.25rem' }}>{s.title}</div>
              <div style={{ fontSize: '0.875rem', color: '#5a6657', lineHeight: 1.55 }}>{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Differentiators({ section }: { section: PublicSection }) {
  type Item = { icon?: string; title: string; body: string }
  const data = safeParse<{ items?: Item[] }>(section.data)
  const items = data?.items ?? []
  return (
    <section style={slideShell} className="proposal-slide">
      {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
      {section.title && <h2 style={slideTitle}>{section.title}</h2>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: '0.875rem', marginTop: '1.25rem' }}>
        {items.map((it, i) => (
          <div key={i} style={{ background: '#ffffff', border: '1px solid #e8f0e6', borderRadius: '0 16px 0 16px', padding: '1.125rem' }}>
            <DiffIcon name={it.icon} />
            <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1f2c1a', marginTop: '0.625rem', marginBottom: '0.25rem' }}>{it.title}</div>
            <div style={{ fontSize: '0.8125rem', color: '#5a6657', lineHeight: 1.55 }}>{it.body}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function DiffIcon({ name }: { name?: string }) {
  // Inline SVGs to avoid pulling lucide into the public bundle for a half-dozen marks.
  const common = { width: 20, height: 20, fill: 'none', stroke: '#5A824E', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const wrap = (children: React.ReactNode) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '2.25rem', height: '2.25rem', background: '#dcefd8',
      borderRadius: '0 12px 0 12px',
    }}>
      <svg viewBox="0 0 24 24" {...common}>{children}</svg>
    </span>
  )
  switch (name) {
    case 'founder':  return wrap(<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/></>)
    case 'partner':  return wrap(<><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></>)
    case 'sparkle':  return wrap(<><path d="M12 2v6m0 8v6m-10-10h6m8 0h6"/><path d="M5 5l3.5 3.5M19 5l-3.5 3.5M5 19l3.5-3.5M19 19l-3.5-3.5"/></>)
    case 'code':     return wrap(<><polyline points="16,18 22,12 16,6"/><polyline points="8,6 2,12 8,18"/></>)
    case 'leaf':     return wrap(<><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2c1 1 1 5 .8 8a9.8 9.8 0 0 1-9 10z"/><path d="M2 22c5-5 6-12 14-14"/></>)
    case 'shield':   return wrap(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>)
    default:         return wrap(<circle cx="12" cy="12" r="4"/>)
  }
}

function CaseStudies({ section }: { section: PublicSection }) {
  type Item = { logo?: string; client: string; problem: string; outcome: string; metric?: string; quote?: string; quoteAuthor?: string }
  const data = safeParse<{ items?: Item[] }>(section.data)
  const items = data?.items ?? []
  return (
    <section style={slideShell} className="proposal-slide">
      {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
      {section.title && <h2 style={slideTitle}>{section.title}</h2>}
      <div style={{ display: 'grid', gap: '0.875rem', marginTop: '1.25rem' }}>
        {items.map((it, i) => (
          <div key={i} style={{ background: '#fdfefd', border: '1px solid #e8f0e6', borderRadius: '0.875rem', padding: '1.125rem 1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.625rem', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '1rem', color: '#1f2c1a' }}>{it.client}</strong>
              {it.metric && (
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#425F39', background: '#dcefd8', padding: '0.125rem 0.5rem', borderRadius: '999px' }}>
                  {it.metric}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: '0.5rem 1.25rem', marginTop: '0.5rem' }}>
              <div>
                <div style={{ fontSize: '0.625rem', fontWeight: 700, color: '#8a9987', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.125rem' }}>Problem</div>
                <div style={{ fontSize: '0.875rem', color: '#1f2c1a', lineHeight: 1.5 }}>{it.problem}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.625rem', fontWeight: 700, color: '#8a9987', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.125rem' }}>Outcome</div>
                <div style={{ fontSize: '0.875rem', color: '#1f2c1a', lineHeight: 1.5 }}>{it.outcome}</div>
              </div>
            </div>
            {it.quote && (
              <blockquote style={{ marginTop: '0.875rem', fontSize: '0.875rem', color: '#5a6657', fontStyle: 'italic', borderLeft: '3px solid #5A824E', paddingLeft: '0.75rem' }}>
                &ldquo;{it.quote}&rdquo;
                {it.quoteAuthor && <div style={{ fontStyle: 'normal', fontSize: '0.75rem', color: '#8a9987', marginTop: '0.25rem' }}>— {it.quoteAuthor}</div>}
              </blockquote>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function TestimonialStack({ section }: { section: PublicSection }) {
  type Item = { quote: string; author: string; role?: string; company?: string }
  const data = safeParse<{ items?: Item[] }>(section.data)
  const items = data?.items ?? []
  return (
    <section style={slideShell} className="proposal-slide">
      {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
      {section.title && <h2 style={slideTitle}>{section.title}</h2>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: '0.875rem', marginTop: '1.25rem' }}>
        {items.map((it, i) => (
          <div key={i} style={{ background: '#ffffff', border: '1px solid #e8f0e6', borderRadius: '0 16px 0 16px', padding: '1.125rem 1.25rem' }}>
            <blockquote style={{ fontSize: '0.9375rem', lineHeight: 1.55, color: '#1f2c1a', margin: 0, fontStyle: 'italic' }}>
              &ldquo;{it.quote}&rdquo;
            </blockquote>
            <div style={{ marginTop: '0.875rem', fontSize: '0.8125rem', color: '#5a6657' }}>
              <strong style={{ color: '#1f2c1a' }}>{it.author}</strong>
              {it.role ? <span> · {it.role}</span> : null}
              {it.company ? <div style={{ color: '#8a9987', fontSize: '0.75rem', marginTop: '0.125rem' }}>{it.company}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function FAQ({ section }: { section: PublicSection }) {
  type Item = { q: string; a: string }
  const data = safeParse<{ items?: Item[] }>(section.data)
  const items = data?.items ?? []
  return (
    <section style={slideShell} className="proposal-slide">
      {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
      {section.title && <h2 style={slideTitle}>{section.title}</h2>}
      <div style={{ display: 'grid', gap: '0.625rem', marginTop: '1.25rem' }}>
        {items.map((it, i) => (
          <details key={i} style={{ background: '#fdfefd', border: '1px solid #e8f0e6', borderRadius: '0.625rem', padding: '0.875rem 1.125rem' }}>
            <summary style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#1f2c1a', cursor: 'pointer', listStyle: 'none' }}>
              {it.q}
            </summary>
            <div style={{ marginTop: '0.625rem', fontSize: '0.875rem', color: '#5a6657', lineHeight: 1.55 }}>
              {it.a}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

function Guarantee({ section }: { section: PublicSection }) {
  const data = safeParse<{ headline?: string; body?: string; badges?: string[] }>(section.data)
  return (
    <section style={{ ...slideShell, background: 'linear-gradient(180deg, #f0f7ee 0%, #ffffff 100%)', borderColor: '#dcefd8' }} className="proposal-slide">
      {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
      <h2 style={{ ...slideTitle, color: '#1f2c1a' }}>{data?.headline ?? section.title ?? 'Our promise to you'}</h2>
      {data?.body && <p style={{ fontSize: '1rem', lineHeight: 1.6, color: '#1f2c1a', margin: '0.75rem 0 1rem 0', maxWidth: '40rem' }}>{data.body}</p>}
      {data?.badges && data.badges.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
          {data.badges.map((b, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, color: '#425F39', background: '#ffffff', border: '1px solid #dcefd8', padding: '0.375rem 0.75rem', borderRadius: '999px' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A824E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              {b}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function RetainerOffer({ section }: { section: PublicSection }) {
  type Plan = { name: string; regular: number; discounted: number; currency: string; unit: string; tagline?: string }
  const data = safeParse<{ eyebrow?: string; headline?: string; body?: string; plans?: Plan[]; footnote?: string }>(section.data)
  return (
    <section style={{ ...slideShell, background: '#1f2c1a', color: '#ffffff', border: 'none', boxShadow: '0 24px 48px rgba(31,44,26,0.18)' }} className="proposal-slide">
      <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#93c98a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
        {data?.eyebrow ?? section.subtitle ?? 'Already earned'}
      </div>
      <h2 style={{ fontSize: 'clamp(1.5rem, 3.4vw, 2.25rem)', fontWeight: 800, lineHeight: 1.15, color: '#ffffff', margin: 0, letterSpacing: '-0.015em' }}>
        {data?.headline ?? section.title ?? 'Your 10% lifetime discount, already earned'}
      </h2>
      {data?.body && <p style={{ fontSize: '1rem', lineHeight: 1.6, color: '#dcefd8', maxWidth: '38rem', margin: '0.875rem 0 0 0' }}>{data.body}</p>}
      {data?.plans && data.plans.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))', gap: '0.875rem', marginTop: '1.5rem' }}>
          {data.plans.map((p, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(220,239,216,0.2)', borderRadius: '0 16px 0 16px', padding: '1rem 1.125rem' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#ffffff' }}>{p.name}</div>
              {p.tagline && <div style={{ fontSize: '0.75rem', color: '#a8c89e', marginTop: '0.25rem', marginBottom: '0.625rem' }}>{p.tagline}</div>}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.625rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.015em' }}>
                  {p.currency === 'GBP' ? '£' : p.currency === 'NZD' ? 'NZ$' : '$'}{p.discounted.toLocaleString()}
                </span>
                <span style={{ fontSize: '0.75rem', color: '#93c98a' }}>/{p.unit}</span>
                <span style={{ fontSize: '0.75rem', color: '#7aaa72', textDecoration: 'line-through', marginLeft: '0.25rem' }}>
                  {p.currency === 'GBP' ? '£' : p.currency === 'NZD' ? 'NZ$' : '$'}{p.regular.toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      {data?.footnote && <p style={{ fontSize: '0.8125rem', color: '#a8c89e', marginTop: '1.25rem', marginBottom: 0 }}>{data.footnote}</p>}
    </section>
  )
}

// ─── Shared styles (mirror proposal-viewer.tsx) ─────────────────────────────

// Full-viewport slide on desktop, natural on mobile (the global stylesheet
// in proposal-viewer.tsx overrides min-height + border on the .proposal-slide
// class at <768px). Pure white per Brand Guidelines.
const slideShell: React.CSSProperties = {
  width: '100%',
  background: '#FFFFFF',
  border: 'none',
  borderRadius: 0,
  borderTop: '1px solid #e8f0e6',
  padding: 'clamp(2rem, 6vw, 5rem) clamp(1.25rem, 5vw, 3rem)',
  minHeight: '100svh',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  // Inner content rail.
  ['--rail-max' as string]: '64rem',
}
const slideInner: React.CSSProperties = {
  width: '100%',
  maxWidth: 'var(--rail-max)',
  margin: '0 auto',
}
const slideEyebrow: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 700,
  color: '#5A824E',
  textTransform: 'uppercase',
  letterSpacing: '0.16em',
  marginBottom: '1rem',
}
const slideTitle: React.CSSProperties = {
  // Larger, more confident type. Manrope at heavier weight, tighter
  // letter spacing — the section title earns the slide.
  fontSize: 'clamp(1.75rem, 4.5vw, 3rem)',
  fontWeight: 800,
  lineHeight: 1.05,
  color: '#121A0F',
  margin: 0,
  marginBottom: '1rem',
  letterSpacing: '-0.02em',
}
const proseStyle: React.CSSProperties = {
  fontSize: '1rem',
  lineHeight: 1.65,
  color: '#121A0F',
  maxWidth: '52rem',
}
