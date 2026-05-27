/**
 * Public-side proposal section renderers : one per section type.
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
  | 'testimonial_stack'           // multi-quote carousel
  | 'faq'                         // Q/A list
  | 'guarantee'                   // risk-reversal callout
  | 'retainer_offer'              // 10% lifetime hook
  | 'founders'                    // founder-led credibility slide
  | 'partner_badges'              // partner / credential pill row

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
      // Default seed is capped at 4 so the grid lays out evenly on every
      // viewport (2x2 on desktop, 1x4 on mobile). The structured editor lets
      // the admin add more, but four reads as confident rather than crowded.
      return {
        items: [
          { icon: 'founder', title: 'Founder-led', body: 'Liam and Staci on every call and every build. No account managers.' },
          { icon: 'partner', title: 'Webflow Premium', body: 'Direct contacts inside Webflow. Faster escalations, better tooling.' },
          { icon: 'sparkle', title: 'AEO as a service', body: 'Content structured so ChatGPT, Claude and Gemini surface it.' },
          { icon: 'shield', title: 'No lock-in', body: 'You stay because the work is good, not because a contract traps you.' },
        ],
      }
    case 'case_study':
      // Three items lays out as a clean 3-column grid on desktop and stacks
      // on mobile. Each entry can carry an optional `link` to the published
      // case study; when set the whole card becomes clickable.
      return {
        items: [
          { client: 'Physitrack', problem: 'Outdated site held back enterprise sales.', outcome: 'Full Webflow rebuild plus AEO restructure.', metric: '12-month retainer signed', link: '' },
          { client: 'Elevate', problem: 'Hourly Webflow needs, no consistent capacity.', outcome: 'On-demand small-track delivery, dashboard-managed.', metric: '18 months, zero churn', link: '' },
          { client: 'Glasswall Solutions', problem: 'Needed a dependable Webflow partner alongside in-house.', outcome: 'GBP 1,250/mo retainer covering steady improvements.', metric: 'Zero churn since onboarding', link: '' },
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
          { q: 'What if I want to stop the retainer?', a: 'You can. Month-to-month with no lock-in. Clients stay because the work is good.' },
          { q: 'Who actually does the work?', a: 'Liam runs engineering, Staci runs design. Founders on every call and every build.' },
          { q: 'How fast do you respond?', a: 'Same day on dashboard messages during business hours. Proactive updates, never silence.' },
          { q: 'What about scope creep?', a: 'We flag it early and discuss it before it becomes a problem. Honest pushback included.' },
        ],
      }
    case 'guarantee':
      return {
        headline: 'No surprises, no lock-in',
        body: 'Month-to-month retainer with no minimum term. If the work isn’t doing what you need, we say so first. If it’s the right fit, you stay because you want to.',
        badges: ['No lock-in', 'Same-day responses', 'Honest scoping'],
      }
    case 'founders':
      return {
        eyebrow: 'The team on your build',
        intro: 'Founder-led, end-to-end. Liam runs engineering, Staci runs design. No account managers, no handoffs.',
        image: '/dashboard/proposals/founders-placeholder.jpg',
        imagePosition: '50% 25%',
        people: [
          { name: 'Liam Miller', role: 'Engineering' },
          { name: 'Staci Bonnie', role: 'Design' },
        ],
      }
    case 'partner_badges':
      // Credential row: Webflow Premium, Client First, Optibase. Renders as
      // leaf-radius framed pills, brand-bordered, with a soft hover lift.
      return {
        eyebrow: 'Credentialled team',
        intro: 'Vetted by the platforms we build on.',
        items: [
          { label: 'Webflow Premium Partner', sub: 'Direct platform support' },
          { label: 'Client First Partner', sub: 'Finsweet certified system' },
          { label: 'Optibase Partner', sub: 'Performance and CRO partner' },
        ],
      }
    case 'retainer_offer':
      return {
        eyebrow: 'After the project',
        headline: 'Your 10% lifetime discount, already earned',
        body: 'Because you’re trusting us with this project, you’ve already earned 10% off Maintain or Scale, for as long as you’re a client. The discount never expires and never gets reviewed. A thank you for the trust, not a hook.',
        plans: [
          { name: 'Maintain', regular: 1500, discounted: 1350, currency: 'USD', unit: 'mo', tagline: 'Steady improvement, one small track at a time.' },
          { name: 'Scale', regular: 4000, discounted: 3600, currency: 'USD', unit: 'mo', tagline: 'Two tracks, design + dev + strategy.' },
        ],
        footnote: 'Talk to us two or three weeks before delivery and we’ll set it up so it’s ready the day the project closes.',
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

// ─── useInView ────────────────────────────────────────────────────────────
//
// Tiny IntersectionObserver-backed hook. Each section renderer wraps its
// outer container in <ScrollFadeIn> so every slide gets the same subtle
// fade-up on first scroll into view. Honors prefers-reduced-motion.
function useInView<T extends HTMLElement>(opts?: { rootMargin?: string; threshold?: number }): [React.RefObject<T | null>, boolean] {
  const ref = React.useRef<T | null>(null)
  const [inView, setInView] = React.useState(false)
  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof window === 'undefined') {
      setInView(true)
      return
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setInView(true)
      return
    }

    // Desktop: the slide deck is a flex track with translateX advance
    // inside an overflow:hidden parent. Slides that aren't the active
    // one have their bounding rect translated off-screen, so the
    // IntersectionObserver against the viewport never reports them as
    // intersecting and the fade-in never plays. Run the fade-in on
    // mount instead; the desktop slide-change cross-fade carries the
    // motion vocabulary from there.
    //
    // Mobile: long-scroll vertical, IO works naturally — keep it.
    const isDesktopDeck = window.matchMedia?.('(min-width: 768px)').matches
    if (isDesktopDeck || !('IntersectionObserver' in window)) {
      const t = window.setTimeout(() => setInView(true), 60)
      return () => window.clearTimeout(t)
    }

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setInView(true)
          io.disconnect()
          break
        }
      }
    }, { rootMargin: opts?.rootMargin ?? '0px 0px -10% 0px', threshold: opts?.threshold ?? 0.08 })
    io.observe(node)
    return () => io.disconnect()
  }, [opts?.rootMargin, opts?.threshold])
  return [ref, inView]
}

/**
 * <SectionMotion>: subtle fade-up on first scroll into view. Participates
 * in layout (block-level wrapper). Every section renderer wraps its inner
 * content in this so the deck has one consistent micro-motion vocabulary
 * instead of one-off hover transforms. Reduced-motion users land in the
 * static, in-view state.
 */
function SectionMotion({
  children, delay = 0, className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const [ref, inView] = useInView<HTMLDivElement>()
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(0.5rem)',
        transition: `opacity 480ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform 480ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
        willChange: inView ? 'auto' : 'opacity, transform',
      }}
    >
      {children}
    </div>
  )
}

// ─── Per-slide theming ────────────────────────────────────────────────────
//
// Each section's data may include `theme: 'brand_glass' | 'toned_light' |
// 'light' | 'dark'` (set in the admin editor). Some types default to dark
// (retainer_offer is the premium-CTA dark slab); everything else defaults
// to light. The palettes below are the source of truth : all renderers
// read from these tokens rather than hardcoding hex.

export type SlideTheme = 'brand_glass' | 'toned_light' | 'light' | 'dark'

function readTheme(section: PublicSection, fallback: SlideTheme = 'light'): SlideTheme {
  try {
    if (!section.data) return fallback
    const parsed = JSON.parse(section.data) as { theme?: string }
    if (parsed.theme === 'brand_glass' || parsed.theme === 'toned_light' || parsed.theme === 'light' || parsed.theme === 'dark') {
      return parsed.theme
    }
  } catch { /* ignore */ }
  return fallback
}

interface ThemeColours {
  bg: string
  text: string
  textMuted: string
  textSubtle: string
  eyebrow: string
  cardBg: string
  cardBorder: string
  cardBorderStrong: string
  divider: string
  brandAccent: string
}

function themeColours(theme: SlideTheme): ThemeColours {
  switch (theme) {
    case 'dark':
      return {
        // Layered radial glow on the deep brand-dark base. The two glows
        // give the slide visual depth without competing with the content.
        bg: 'radial-gradient(120% 80% at 85% -20%, rgba(147,201,138,0.22) 0%, transparent 55%), radial-gradient(80% 60% at -10% 110%, rgba(122,170,114,0.16) 0%, transparent 50%), #1f2c1a',
        text: '#ffffff',
        textMuted: '#dcefd8',
        textSubtle: '#a8c89e',
        eyebrow: '#93c98a',
        cardBg: 'rgba(255,255,255,0.06)',
        cardBorder: 'rgba(220,239,216,0.18)',
        cardBorderStrong: 'rgba(220,239,216,0.35)',
        divider: 'rgba(220,239,216,0.16)',
        brandAccent: '#93c98a',
      }
    case 'brand_glass':
      return {
        // Brand-green base layered with two radial glows (warm white at
        // top-right, brand-light at bottom-left) and a soft vignette.
        // Reads as depth without a busy gradient.
        bg: [
          'radial-gradient(60% 60% at 85% 0%, rgba(255,255,255,0.22) 0%, transparent 55%)',
          'radial-gradient(80% 60% at 0% 110%, rgba(122,170,114,0.45) 0%, transparent 60%)',
          'radial-gradient(120% 100% at 50% 50%, transparent 60%, rgba(0,0,0,0.18) 100%)',
          'linear-gradient(135deg, #5A824E 0%, #3e5a35 100%)',
        ].join(', '),
        text: '#FFFFFF',
        textMuted: '#dcefd8',
        textSubtle: '#a8c89e',
        eyebrow: '#dcefd8',
        cardBg: 'rgba(255,255,255,0.10)',
        cardBorder: 'rgba(255,255,255,0.22)',
        cardBorderStrong: 'rgba(255,255,255,0.32)',
        divider: 'rgba(255,255,255,0.16)',
        brandAccent: '#dcefd8',
      }
    case 'toned_light':
      return {
        bg: 'radial-gradient(80% 60% at 100% 0%, rgba(220,239,216,0.5) 0%, transparent 55%), linear-gradient(160deg, #f5f3ed 0%, #eef3ec 100%)',
        text: '#121A0F',
        textMuted: '#3d5034',
        textSubtle: '#6a7560',
        eyebrow: '#5A824E',
        cardBg: 'rgba(255,255,255,0.65)',
        cardBorder: '#e8e3d6',
        cardBorderStrong: '#d4cfbe',
        divider: '#e8e3d6',
        brandAccent: '#5A824E',
      }
    case 'light':
    default:
      return {
        bg: '#FFFFFF',
        text: '#121A0F',
        textMuted: '#5a6657',
        textSubtle: '#8a9987',
        eyebrow: '#5A824E',
        cardBg: '#fdfefd',
        cardBorder: '#e8f0e6',
        cardBorderStrong: '#d4e0d0',
        divider: '#e8f0e6',
        brandAccent: '#5A824E',
      }
  }
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
    case 'founders':           return <Founders section={section} />
    case 'partner_badges':     return <PartnerBadges section={section} />
    default:                   return <HtmlSection section={section} />
  }
}

// HTML/rich-text section (overview, terms, about, scope_shared, text)
function HtmlSection({ section }: { section: PublicSection }) {
  const data = safeParse<{ html?: string }>(section.data)
  const html = data?.html ?? ''
  const theme = readTheme(section)
  const c = themeColours(theme)
  return (
    <section style={{ ...slideShell, background: c.bg, color: c.text }} className="proposal-slide">
      <SectionMotion>
        <div style={slideInner}>
          {section.subtitle && <div style={{ ...slideEyebrow, color: c.eyebrow }}>{section.subtitle}</div>}
          {section.title && <h2 style={{ ...slideTitle, color: c.text }}>{section.title}</h2>}
          <div style={{ ...proseStyle, color: c.text }} dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </SectionMotion>
    </section>
  )
}

function SingleTestimonial({ section }: { section: PublicSection }) {
  const data = safeParse<{ quote?: string; author?: string; role?: string; company?: string }>(section.data)
  if (!data?.quote) return null
  return (
    <section style={slideShell} className="proposal-slide">
      <SectionMotion>
        <div style={slideInner}>
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
        </div>
      </SectionMotion>
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
      <SectionMotion>
      <div style={slideInner}>
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
                  {fmt(a.lo)} to {fmt(a.hi)}
                </span>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid #e8f0e6', marginTop: '0.875rem', paddingTop: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong style={{ fontSize: '0.875rem' }}>Total</strong>
            <strong style={{ fontSize: '1.125rem', fontVariantNumeric: 'tabular-nums', color: '#1f2c1a' }}>
              {fmt(lo)} to {fmt(hi)}{data?.unit === 'mo' ? '/mo' : ''}
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
      </div>
      </SectionMotion>
    </section>
  )
}

/**
 * <Process> : proper editorial timeline.
 *
 * Desktop: horizontal connecting line behind oversized step numerals
 * (3.5rem). Steps lay out as a 5-column flex row when there are <=5
 * items, wrapping to multi-row if more. Each step has generous breathing
 * room and step body capped to two lines for scannability.
 *
 * Mobile: vertical timeline with a connecting line on the left.
 */
function Process({ section }: { section: PublicSection }) {
  const data = safeParse<{ steps?: { title: string; body: string; eyebrow?: string }[] }>(section.data)
  const steps = data?.steps ?? []
  const theme = readTheme(section)
  const c = themeColours(theme)
  const onDark = theme === 'dark' || theme === 'brand_glass'
  const numeralColor = onDark ? c.brandAccent : '#5A824E'
  const lineColor = onDark ? 'rgba(220,239,216,0.18)' : '#dcefd8'
  return (
    <section style={{ ...slideShell, background: c.bg, color: c.text }} className="proposal-slide">
      <SectionMotion>
      <div style={slideInner}>
        {section.subtitle && <div style={{ ...slideEyebrow, color: c.eyebrow }}>{section.subtitle}</div>}
        {section.title && <h2 style={{ ...slideTitle, color: c.text }}>{section.title}</h2>}
        <ol className="proposal-process" style={{ listStyle: 'none', padding: 0, margin: '2.5rem 0 0 0' }}>
          {/* The connecting line : absolute element behind the numerals.
              Desktop horizontal, mobile vertical. */}
          <span aria-hidden="true" className="proposal-process-line" style={{ background: lineColor }} />
          {steps.map((s, i) => (
            <li key={i} className="proposal-process-step">
              <div className="proposal-process-numeral" style={{ color: numeralColor, background: c.bg }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div className="proposal-process-body">
                {s.eyebrow && <div style={{ fontSize: '0.625rem', fontWeight: 700, color: c.textSubtle, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.375rem' }}>{s.eyebrow}</div>}
                <div style={{ fontSize: '1rem', fontWeight: 700, color: c.text, marginBottom: '0.375rem', letterSpacing: '-0.005em' }}>{s.title}</div>
                <div style={{ fontSize: '0.875rem', color: c.textMuted, lineHeight: 1.55 }}>{s.body}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
      </SectionMotion>
      <style>{`
        .proposal-process { position: relative; display: flex; flex-direction: column; gap: 1.5rem; }
        .proposal-process-line {
          position: absolute;
          left: 1.125rem;
          top: 1.5rem;
          bottom: 1.5rem;
          width: 0.125rem;
          border-radius: 999px;
        }
        .proposal-process-step {
          display: grid;
          grid-template-columns: 2.5rem 1fr;
          gap: 1.125rem;
          align-items: flex-start;
          position: relative;
        }
        .proposal-process-numeral {
          position: relative;
          width: 2.5rem;
          font-size: 1.5rem;
          font-weight: 800;
          letter-spacing: -0.02em;
          line-height: 1;
          padding: 0.375rem 0;
          font-variant-numeric: tabular-nums;
          z-index: 1;
        }
        .proposal-process-body { padding-top: 0.125rem; }
        @media (min-width: 768px) {
          .proposal-process { flex-direction: row; gap: 2rem; }
          .proposal-process-line {
            left: 0;
            right: 0;
            top: 1.875rem;
            bottom: auto;
            width: auto;
            height: 0.125rem;
          }
          .proposal-process-step {
            flex: 1 1 0;
            min-width: 0;
            grid-template-columns: 1fr;
            gap: 1.125rem;
          }
          .proposal-process-numeral {
            width: auto;
            font-size: 3.5rem;
            line-height: 1;
            padding: 0;
          }
          .proposal-process-body { padding-top: 0; padding-right: 1rem; }
        }
      `}</style>
    </section>
  )
}

function Differentiators({ section }: { section: PublicSection }) {
  type Item = { icon?: string; title: string; body: string }
  const data = safeParse<{ items?: Item[] }>(section.data)
  const items = data?.items ?? []
  const theme = readTheme(section)
  const c = themeColours(theme)
  // Choose a column count that keeps the bottom row full whenever possible.
  // 3 items → 3 cols, 4 items → 2 cols (balanced 2x2), 6 items → 3 cols, etc.
  const cols = items.length === 4 ? 2 : items.length === 6 || items.length === 3 ? 3 : items.length >= 4 ? 3 : Math.max(1, items.length)
  return (
    <section style={{ ...slideShell, background: c.bg, color: c.text }} className="proposal-slide">
      <SectionMotion>
      <div style={slideInner}>
        {section.subtitle && <div style={{ ...slideEyebrow, color: c.eyebrow }}>{section.subtitle}</div>}
        {section.title && <h2 style={{ ...slideTitle, color: c.text }}>{section.title}</h2>}
        <div className="proposal-diff-grid" style={{ ['--diff-cols' as string]: String(cols), marginTop: '1.5rem' }}>
          {items.map((it, i) => (
            <div
              key={i}
              className="proposal-diff-card"
              style={{
                background: theme === 'dark' ? c.cardBg : '#ffffff',
                border: `1px solid ${c.cardBorder}`,
                borderRadius: '0 16px 0 16px',
                padding: '1.5rem 1.5rem 1.625rem 1.5rem',
                transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), border-color 240ms ease, box-shadow 320ms ease',
              }}
            >
              <DiffIcon name={it.icon} />
              <div style={{ fontSize: '1rem', fontWeight: 700, color: c.text, marginTop: '0.875rem', marginBottom: '0.375rem', letterSpacing: '-0.005em' }}>{it.title}</div>
              <div style={{ fontSize: '0.875rem', color: c.textMuted, lineHeight: 1.55 }}>{it.body}</div>
            </div>
          ))}
        </div>
      </div>
      </SectionMotion>
      <style>{`
        .proposal-diff-grid { display: grid; grid-template-columns: 1fr; gap: 0.875rem; }
        .proposal-diff-card:hover { transform: translateY(-0.125rem); box-shadow: 0 12px 32px -16px rgba(31,44,26,0.12); }
        @media (min-width: 768px) { .proposal-diff-grid { grid-template-columns: repeat(var(--diff-cols, 3), minmax(0, 1fr)); gap: 1rem; } }
      `}</style>
    </section>
  )
}

/**
 * <DiffIcon> : custom inline SVG marks for the differentiators grid.
 *
 * Drawn at 24px on a 24px viewBox with 1.75 stroke width so the marks
 * read confident at the 20px display size without going clip-art thick.
 * All strokes are #5A824E so the icons sit calmly on the dcefd8 leaf
 * tile that wraps them. Every icon is built from primitives (paths,
 * circles) rather than relying on a vendor library so the public bundle
 * stays lean and we can tune the visual tone per brand.
 */
function DiffIcon({ name }: { name?: string }) {
  const stroke = '#5A824E'
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke,
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  const wrap = (children: React.ReactNode) => (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: '2.5rem', height: '2.5rem', background: '#dcefd8',
      borderRadius: '0 12px 0 12px',
      // Subtle inside-edge highlight so the tile reads as a real surface,
      // not a flat fill. Echoes the founder photo frame on the cover.
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 2px rgba(31,44,26,0.04)',
    }}>
      <svg {...common}>{children}</svg>
    </span>
  )
  switch (name) {
    // Founder-led: two interlocking heads, a partnership not a single
    // person. Reads as "the founders are on every call".
    case 'founder':
      return wrap(
        <>
          <circle cx="9" cy="9" r="3" />
          <circle cx="15.5" cy="10" r="2.25" />
          <path d="M3.5 20c.5-3 2.8-5 5.5-5s5 2 5.5 5" />
          <path d="M14 20c.4-2.2 2-3.6 4-3.6s3.6 1.4 4 3.6" />
        </>
      )
    // Partner badge: a shield with a tick inside. Authority + trust.
    case 'partner':
      return wrap(
        <>
          <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z" />
          <path d="M8.5 12l2.5 2.5L16 9.5" strokeWidth="2" />
        </>
      )
    // Sparkle/AEO: four-point star. Sharper than the original radial
    // burst, reads as "a moment of brilliance" rather than a sun.
    case 'sparkle':
      return wrap(
        <>
          <path d="M12 3l1.6 6.4L20 11l-6.4 1.6L12 19l-1.6-6.4L4 11l6.4-1.6L12 3z" />
          <path d="M19 18l.7 1.8L21.5 20.5l-1.8.7L19 23l-.7-1.8L16.5 20.5l1.8-.7L19 18z" strokeWidth="1.25" />
        </>
      )
    // Code/engineering: angle brackets with a slash, clean and unambiguous.
    case 'code':
      return wrap(
        <>
          <polyline points="8 7 3 12 8 17" />
          <polyline points="16 7 21 12 16 17" />
          <line x1="14" y1="5" x2="10" y2="19" />
        </>
      )
    // Leaf: the Tahi mark, simplified. Single-stroke organic curve.
    case 'leaf':
      return wrap(
        <>
          <path d="M20 4c0 9-6 15-15 15 0-9 6-15 15-15z" />
          <path d="M5 19c4-4 8-7 13-13" />
        </>
      )
    // Shield: classic protection mark, subtly fuller than the lucide
    // version so it carries weight at small sizes.
    case 'shield':
      return wrap(
        <>
          <path d="M12 3l8 3v5.5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6l8-3z" />
          <path d="M12 8v8" strokeWidth="1.25" />
        </>
      )
    default:
      // Generic mark: concentric rings, calm and brand-aligned.
      return wrap(
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" />
        </>
      )
  }
}

/**
 * <CaseStudies> : 3-column grid of editorial case study cards.
 *
 * Each card shows client + metric pill, then problem/outcome stacked.
 * When the item has a `link` URL the whole card becomes a clickable
 * anchor with hover-lift and a subtle external-link affordance.
 */
function CaseStudies({ section }: { section: PublicSection }) {
  type Item = { logo?: string; client: string; problem: string; outcome: string; metric?: string; quote?: string; quoteAuthor?: string; link?: string }
  const data = safeParse<{ items?: Item[] }>(section.data)
  const items = data?.items ?? []
  const theme = readTheme(section)
  const c = themeColours(theme)
  const onDark = theme === 'dark' || theme === 'brand_glass'
  const cols = items.length === 1 ? 1 : items.length === 2 || items.length === 4 ? 2 : 3
  return (
    <section style={{ ...slideShell, background: c.bg, color: c.text }} className="proposal-slide">
      <SectionMotion>
      <div style={slideInner}>
        {section.subtitle && <div style={{ ...slideEyebrow, color: c.eyebrow }}>{section.subtitle}</div>}
        {section.title && <h2 style={{ ...slideTitle, color: c.text }}>{section.title}</h2>}
        <div className="proposal-case-grid" style={{ ['--case-cols' as string]: String(cols), marginTop: '1.75rem' }}>
          {items.map((it, i) => {
            const inner = (
              <>
                {it.metric && (
                  <span style={{ display: 'inline-flex', alignSelf: 'flex-start', fontSize: '0.6875rem', fontWeight: 700, color: '#425F39', background: '#dcefd8', padding: '0.25rem 0.625rem', borderRadius: '999px', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                    {it.metric}
                  </span>
                )}
                <div style={{ fontSize: '1.125rem', fontWeight: 700, color: c.text, marginTop: '0.875rem', marginBottom: '0.875rem', letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{it.client}</span>
                  {it.link && (
                    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: c.brandAccent, flexShrink: 0 }}>
                      <path d="M7 17L17 7M9 7h8v8" />
                    </svg>
                  )}
                </div>
                <div style={{ fontSize: '0.625rem', fontWeight: 700, color: c.textSubtle, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>Problem</div>
                <div style={{ fontSize: '0.875rem', color: c.textMuted, lineHeight: 1.55, marginBottom: '0.875rem' }}>{it.problem}</div>
                <div style={{ fontSize: '0.625rem', fontWeight: 700, color: c.textSubtle, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>Outcome</div>
                <div style={{ fontSize: '0.875rem', color: c.text, lineHeight: 1.55 }}>{it.outcome}</div>
                {it.quote && (
                  <blockquote style={{ marginTop: '1rem', fontSize: '0.8125rem', color: c.textMuted, fontStyle: 'italic', borderLeft: `2px solid ${c.brandAccent}`, paddingLeft: '0.75rem', margin: '1rem 0 0 0' }}>
                    &ldquo;{it.quote}&rdquo;
                    {it.quoteAuthor && <div style={{ fontStyle: 'normal', fontSize: '0.6875rem', color: c.textSubtle, marginTop: '0.25rem' }}>{it.quoteAuthor}</div>}
                  </blockquote>
                )}
              </>
            )
            const cardStyleObj: React.CSSProperties = {
              display: 'flex',
              flexDirection: 'column',
              background: onDark ? c.cardBg : '#ffffff',
              border: `1px solid ${c.cardBorder}`,
              borderRadius: '0 16px 0 16px',
              padding: '1.5rem',
              textDecoration: 'none',
              color: 'inherit',
              transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), border-color 240ms ease, box-shadow 320ms ease',
              height: '100%',
            }
            return it.link ? (
              <a key={i} href={it.link} target="_blank" rel="noopener noreferrer" className="proposal-case-card" style={cardStyleObj}>{inner}</a>
            ) : (
              <div key={i} className="proposal-case-card" style={cardStyleObj}>{inner}</div>
            )
          })}
        </div>
      </div>
      </SectionMotion>
      <style>{`
        .proposal-case-grid { display: grid; grid-template-columns: 1fr; gap: 1rem; align-items: stretch; }
        .proposal-case-card:hover { transform: translateY(-0.25rem); border-color: ${c.cardBorderStrong}; box-shadow: 0 16px 36px -18px rgba(31,44,26,0.18); }
        @media (min-width: 768px) { .proposal-case-grid { grid-template-columns: repeat(var(--case-cols, 3), minmax(0, 1fr)); gap: 1.125rem; } }
      `}</style>
    </section>
  )
}

function TestimonialStack({ section }: { section: PublicSection }) {
  type Item = { quote: string; author: string; role?: string; company?: string }
  const data = safeParse<{ items?: Item[] }>(section.data)
  const items = data?.items ?? []
  if (items.length === 0) return null
  // Eyebrow + title centred so the cards below sit in a clean editorial axis.
  const headBlock = (
    <div style={{ textAlign: 'center', maxWidth: '36rem', marginLeft: 'auto', marginRight: 'auto' }}>
      {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
      {section.title && <h2 style={slideTitle}>{section.title}</h2>}
    </div>
  )
  if (items.length === 1) {
    return (
      <section style={slideShell} className="proposal-slide">
        <SectionMotion>
          <div style={slideInner}>
            {headBlock}
            <div style={{ marginTop: '1.5rem', maxWidth: '40rem', marginLeft: 'auto', marginRight: 'auto' }}>
              <TestimonialCard item={items[0]} variant="static" />
            </div>
          </div>
        </SectionMotion>
      </section>
    )
  }
  return (
    <section style={slideShell} className="proposal-slide">
      <SectionMotion>
        <div style={slideInner}>
          {headBlock}
          <TestimonialCarousel items={items} />
        </div>
      </SectionMotion>
    </section>
  )
}

/**
 * <TestimonialCarousel> : single quote in focus, prev/next visible at the
 * edges, soft fade. Auto-advances every 6s; pauses on hover, focus, or
 * pointer-down. Drag works with both mouse and touch via pointer events,
 * with a 40px threshold for a committed swipe (snaps back below that).
 * Container has a max-width so cards don't balloon on huge displays.
 * Respects prefers-reduced-motion by disabling auto-advance.
 */
function TestimonialCarousel({
  items,
}: {
  items: { quote: string; author: string; role?: string; company?: string }[]
}) {
  const AUTO_ADVANCE_MS = 6000
  const [active, setActive] = React.useState(0)
  const [paused, setPaused] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [dragOffset, setDragOffset] = React.useState(0)
  const [isDragging, setIsDragging] = React.useState(false)
  const [isMobile, setIsMobile] = React.useState(false)
  const trackRef = React.useRef<HTMLDivElement>(null)
  const pointerRef = React.useRef<{ startX: number; pointerId: number; pointerType: string } | null>(null)
  const reducedMotion = React.useRef(false)

  React.useEffect(() => {
    reducedMotion.current = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  }, [])

  // Mobile (≤767px): the 70% card + edge fades + peek-of-neighbour design
  // makes the active quote unreadable. Below the breakpoint we collapse to
  // a single full-width card with dot nav only.
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener?.('change', update)
    return () => mql.removeEventListener?.('change', update)
  }, [])

  // Auto-advance with progress bar.
  React.useEffect(() => {
    if (paused || isDragging || items.length < 2 || reducedMotion.current) return
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / AUTO_ADVANCE_MS)
      setProgress(p)
      if (p >= 1) {
        setActive(a => (a + 1) % items.length)
        setProgress(0)
      } else {
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active, paused, isDragging, items.length])

  function jump(i: number) {
    setActive((i + items.length) % items.length)
    setProgress(0)
    setPaused(true)
    window.setTimeout(() => setPaused(false), 1200)
  }

  // Pointer events : covers mouse, touch, and pen with one code path.
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    pointerRef.current = { startX: e.clientX, pointerId: e.pointerId, pointerType: e.pointerType }
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    setPaused(true)
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointerRef.current || pointerRef.current.pointerId !== e.pointerId) return
    setDragOffset(e.clientX - pointerRef.current.startX)
  }
  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointerRef.current || pointerRef.current.pointerId !== e.pointerId) return
    const d = e.clientX - pointerRef.current.startX
    e.currentTarget.releasePointerCapture(e.pointerId)
    pointerRef.current = null
    setDragOffset(0)
    setIsDragging(false)
    if (Math.abs(d) > 40) jump(active + (d < 0 ? 1 : -1))
    else setPaused(false)
  }

  // Card width is 70% of the container; offset the track so the active
  // card lands centred. Drag adds a temporary live offset in pixels. On
  // mobile we collapse to a single full-width card (no peek, no fades),
  // dot nav only : peeks make the active quote unreadable on small screens.
  const cardPercent = isMobile ? 100 : 70
  const sidePercent = isMobile ? 0 : 15
  const trackTransform = `translate3d(calc(${sidePercent}% - ${active * cardPercent}% + ${dragOffset}px), 0, 0)`

  return (
    <div
      style={{
        marginTop: '1.5rem',
        position: 'relative',
        maxWidth: '64rem',
        marginLeft: 'auto',
        marginRight: 'auto',
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {!isMobile && (
        <>
          <div aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '6%', background: 'linear-gradient(to right, var(--color-bg, #FFFFFF), transparent)', pointerEvents: 'none', zIndex: 2 }} />
          <div aria-hidden="true" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '6%', background: 'linear-gradient(to left, var(--color-bg, #FFFFFF), transparent)', pointerEvents: 'none', zIndex: 2 }} />
        </>
      )}

      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          overflow: 'hidden',
          padding: '0.5rem 0',
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'pan-y',
          userSelect: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            transform: trackTransform,
            transition: isDragging
              ? 'none'
              : 'transform 360ms cubic-bezier(0.22, 1, 0.36, 1)',
            willChange: 'transform',
          }}
        >
          {items.map((it, i) => (
            <div
              key={i}
              style={{
                flex: `0 0 ${cardPercent}%`,
                minWidth: 0,
                padding: isMobile ? '0' : '0 0.75rem',
                opacity: i === active ? 1 : isMobile ? 0 : 0.4,
                transform: i === active || isMobile ? 'scale(1)' : 'scale(0.94)',
                transition: 'opacity 320ms ease, transform 360ms cubic-bezier(0.22, 1, 0.36, 1)',
                pointerEvents: i === active ? 'auto' : 'none',
              }}
            >
              <TestimonialCard item={it} variant={i === active ? 'active' : 'inactive'} />
            </div>
          ))}
        </div>
      </div>

      {/* Progress + dots */}
      <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.625rem' }}>
        {!reducedMotion.current && items.length > 1 && (
          <div aria-hidden="true" style={{ width: '4rem', height: '0.125rem', background: '#e8f0e6', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.round(progress * 100)}%`,
              height: '100%',
              background: '#5A824E',
              transition: paused ? 'width 240ms ease' : 'none',
            }} />
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.4375rem' }}>
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to testimonial ${i + 1}`}
              onClick={() => jump(i)}
              style={{
                width: i === active ? '1.25rem' : '0.5rem',
                height: '0.5rem',
                borderRadius: '999px',
                background: i === active ? '#5A824E' : '#d4e0d0',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                transition: 'width 240ms ease, background 240ms ease',
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function TestimonialCard({
  item, variant,
}: {
  item: { quote: string; author: string; role?: string; company?: string }
  variant: 'active' | 'inactive' | 'static'
}) {
  const elevated = variant === 'active' || variant === 'static'
  return (
    <figure
      style={{
        background: '#ffffff',
        border: '1px solid #e8f0e6',
        borderRadius: '0 24px 0 24px',
        padding: '2rem 2.25rem',
        boxShadow: elevated ? '0 16px 40px -16px rgba(31,44,26,0.12)' : 'none',
        transition: 'box-shadow 240ms ease',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        margin: 0,
      }}
    >
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" style={{ color: '#5A824E', opacity: 0.6 }}>
        <path d="M9 7c-3 0-5 2-5 5v6h6v-6H6c0-2 1-3 3-3V7zm10 0c-3 0-5 2-5 5v6h6v-6h-4c0-2 1-3 3-3V7z" fill="currentColor" />
      </svg>
      <blockquote style={{ fontSize: 'clamp(1.125rem, 1.4vw, 1.375rem)', lineHeight: 1.5, color: '#121A0F', margin: 0, fontWeight: 500, letterSpacing: '-0.005em' }}>
        {item.quote}
      </blockquote>
      <figcaption style={{ marginTop: 'auto', fontSize: '0.875rem', color: '#5a6657' }}>
        <div style={{ fontWeight: 700, color: '#1f2c1a' }}>{item.author}</div>
        {(item.role || item.company) && (
          <div style={{ fontSize: '0.8125rem', color: '#8a9987', marginTop: '0.125rem' }}>
            {item.role}
            {item.role && item.company ? ' · ' : ''}
            {item.company}
          </div>
        )}
      </figcaption>
    </figure>
  )
}

function FAQ({ section }: { section: PublicSection }) {
  type Item = { q: string; a: string }
  const data = safeParse<{ items?: Item[] }>(section.data)
  const items = data?.items ?? []
  return (
    <section style={slideShell} className="proposal-slide">
      <SectionMotion>
        <div style={slideInner}>
          {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
          {section.title && <h2 style={slideTitle}>{section.title}</h2>}
          <div style={{ display: 'grid', gap: '0.625rem', marginTop: '1.5rem' }}>
            {items.map((it, i) => <FAQItem key={i} q={it.q} a={it.a} />)}
          </div>
        </div>
      </SectionMotion>
    </section>
  )
}

/**
 * Animated FAQ accordion item. Replaces the bare <details> which gave no
 * chevron, no animation, and no clear "this is clickable" affordance. Uses
 * grid-template-rows: 0fr/1fr trick for smooth height animation without JS
 * measurement, plus a chevron that rotates 180° on open.
 */
function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div
      style={{
        background: open ? '#ffffff' : '#fdfefd',
        border: open ? '1px solid #d4e0d0' : '1px solid #e8f0e6',
        borderRadius: '0.875rem',
        overflow: 'hidden',
        transition: 'border-color 200ms ease, background 200ms ease, box-shadow 200ms ease',
        boxShadow: open ? '0 4px 16px rgba(31, 44, 26, 0.04)' : 'none',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '1rem 1.25rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.875rem',
          fontFamily: 'inherit',
          color: '#121A0F',
        }}
      >
        <span style={{ fontSize: '1rem', fontWeight: 700, flex: 1, lineHeight: 1.45 }}>
          {q}
        </span>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.75rem',
            height: '1.75rem',
            borderRadius: '50%',
            background: open ? '#5A824E' : '#dcefd8',
            color: open ? '#FFFFFF' : '#425F39',
            transition: 'background 200ms ease, color 200ms ease, transform 280ms cubic-bezier(0.22, 1, 0.36, 1)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      <div
        style={{
          display: 'grid',
          gridTemplateRows: open ? '1fr' : '0fr',
          transition: 'grid-template-rows 280ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div
            style={{
              padding: '0 1.25rem 1rem 1.25rem',
              fontSize: '0.9375rem',
              color: '#5a6657',
              lineHeight: 1.6,
            }}
          >
            {a}
          </div>
        </div>
      </div>
    </div>
  )
}

function Guarantee({ section }: { section: PublicSection }) {
  const data = safeParse<{ headline?: string; body?: string; badges?: string[] }>(section.data)
  // Flat brand-50 tint with a single soft radial glow for depth : no
  // top-to-bottom gradient. The price/promise area should read calm and
  // confident, not airy. Memo: user feedback "month-to-month uses a
  // gradient that we shouldn't be" : replaced the linear gradient base.
  const bg = [
    'radial-gradient(60% 60% at 80% 0%, rgba(220,239,216,0.45) 0%, transparent 60%)',
    '#f0f7ee',
  ].join(', ')
  return (
    <section style={{ ...slideShell, background: bg, borderColor: '#dcefd8' }} className="proposal-slide">
      <SectionMotion>
        <div style={slideInner}>
          {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
          <h2 style={{ ...slideTitle, color: '#1f2c1a' }}>{data?.headline ?? section.title ?? 'Our promise to you'}</h2>
          {data?.body && <p style={{ fontSize: '1rem', lineHeight: 1.6, color: '#1f2c1a', margin: '0.875rem 0 1.25rem 0', maxWidth: '40rem' }}>{data.body}</p>}
          {data?.badges && data.badges.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {data.badges.map((b, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, color: '#425F39', background: '#ffffff', border: '1px solid #dcefd8', padding: '0.4375rem 0.75rem', borderRadius: '999px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5A824E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  {b}
                </span>
              ))}
            </div>
          )}
        </div>
      </SectionMotion>
    </section>
  )
}

function RetainerOffer({ section }: { section: PublicSection }) {
  type Plan = { name: string; regular: number; discounted: number; currency: string; unit: string; tagline?: string }
  const data = safeParse<{ eyebrow?: string; headline?: string; body?: string; plans?: Plan[]; footnote?: string }>(section.data)
  // Same depth language as the brand-glass cover: the deep dark base
  // gets two radial glows so the slab reads premium, not flat.
  const bg = [
    'radial-gradient(120% 80% at 85% -20%, rgba(147,201,138,0.20) 0%, transparent 55%)',
    'radial-gradient(80% 60% at -10% 110%, rgba(122,170,114,0.14) 0%, transparent 50%)',
    '#1f2c1a',
  ].join(', ')
  return (
    <section style={{ ...slideShell, background: bg, color: '#ffffff', border: 'none', boxShadow: '0 24px 48px rgba(31,44,26,0.18)' }} className="proposal-slide">
      <SectionMotion>
      <div style={slideInner}>
        <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#93c98a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
          {data?.eyebrow ?? section.subtitle ?? 'Already earned'}
        </div>
        <h2 style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', fontWeight: 800, lineHeight: 1.05, color: '#ffffff', margin: 0, letterSpacing: '-0.025em' }}>
          {data?.headline ?? section.title ?? 'Your 10% lifetime discount, already earned'}
        </h2>
        {data?.body && <p style={{ fontSize: '1rem', lineHeight: 1.6, color: '#dcefd8', maxWidth: '38rem', margin: '1rem 0 0 0' }}>{data.body}</p>}
        {data?.plans && data.plans.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))', gap: '1rem', marginTop: '2rem' }}>
            {data.plans.map((p, i) => (
              <div key={i} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(220,239,216,0.22)', borderRadius: '0 20px 0 20px', padding: '1.5rem 1.5rem 1.625rem 1.5rem' }}>
                <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#ffffff', letterSpacing: '-0.005em' }}>{p.name}</div>
                {p.tagline && <div style={{ fontSize: '0.8125rem', color: '#a8c89e', marginTop: '0.375rem', marginBottom: '1rem', lineHeight: 1.5 }}>{p.tagline}</div>}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '2.25rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {p.currency === 'GBP' ? '£' : p.currency === 'NZD' ? 'NZ$' : '$'}{p.discounted.toLocaleString()}
                  </span>
                  <span style={{ fontSize: '0.8125rem', color: '#93c98a', fontWeight: 600 }}>/{p.unit}</span>
                  <span style={{ fontSize: '0.8125rem', color: '#7aaa72', textDecoration: 'line-through', marginLeft: '0.25rem' }}>
                    {p.currency === 'GBP' ? '£' : p.currency === 'NZD' ? 'NZ$' : '$'}{p.regular.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {data?.footnote && <p style={{ fontSize: '0.8125rem', color: '#a8c89e', marginTop: '1.5rem', marginBottom: 0 }}>{data.footnote}</p>}
      </div>
      </SectionMotion>
    </section>
  )
}

/**
 * <Founders> : founder-led credibility slide.
 *
 * Single composition, two columns on desktop, stacked on mobile:
 *   [ text panel ]   [ shared photo ]
 *
 * The image is one shot of both founders, framed in a leaf-radius card
 * with a soft brand-tinted shadow. People show as small role pills under
 * the intro paragraph, not as separate photo cards. This reads as a
 * single editorial composition, not a roster.
 */
function Founders({ section }: { section: PublicSection }) {
  type Person = { name: string; role: string }
  const data = safeParse<{
    eyebrow?: string
    intro?: string
    image?: string
    imagePosition?: string
    people?: Person[]
  }>(section.data)
  const people = data?.people ?? []
  const theme = readTheme(section)
  const c = themeColours(theme)
  const initials = people.map(p => p.name.split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()).join(' & ')

  return (
    <section style={{ ...slideShell, background: c.bg, color: c.text }} className="proposal-slide">
      <SectionMotion>
      <div style={{ ...slideInner, maxWidth: '72rem' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: 'clamp(1.5rem, 4vw, 3rem)',
            alignItems: 'center',
          }}
          className="founders-grid"
        >
          {/* Image side. No hover transform here : consistent scroll-fade
              micro-motion is the only animation across the deck, applied
              uniformly via <SectionMotion> on every section's wrapper. */}
          <div style={{ order: 1 }}>
            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '4 / 5',
                maxHeight: '34rem',
                background: data?.image
                  ? '#1f2c1a'
                  : 'linear-gradient(135deg, #5A824E 0%, #425F39 100%)',
                borderRadius: '0 32px 0 32px',
                overflow: 'hidden',
                boxShadow: theme === 'dark' || theme === 'brand_glass'
                  ? '0 24px 60px -24px rgba(0,0,0,0.45)'
                  : '0 24px 60px -24px rgba(31,44,26,0.30)',
              }}
            >
              {data?.image ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={data.image}
                  alt={people.map(p => p.name).join(' and ') || 'Tahi founders'}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: data.imagePosition ?? '50% 25%',
                  }}
                />
              ) : (
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 'clamp(3.5rem, 8vw, 6rem)',
                    fontWeight: 800,
                    color: '#FFFFFF',
                    letterSpacing: '-0.02em',
                  }}
                >
                  {initials || 'L+S'}
                </div>
              )}
              {/* Soft inside-edge highlight : gives the image a glass-frame feel */}
              <div
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '0 32px 0 32px',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -32px 64px rgba(0,0,0,0.18)',
                  pointerEvents: 'none',
                }}
              />
            </div>
          </div>

          {/* Text side */}
          <div style={{ order: 2 }}>
            {(data?.eyebrow || section.subtitle) && (
              <div style={{ ...slideEyebrow, color: c.eyebrow, marginBottom: '0.75rem' }}>
                {data?.eyebrow ?? section.subtitle}
              </div>
            )}
            {section.title && (
              <h2 style={{ ...slideTitle, color: c.text, fontSize: 'clamp(2rem, 4.5vw, 3.5rem)' }}>
                {section.title}
              </h2>
            )}
            {data?.intro && (
              <p style={{ fontSize: 'clamp(1rem, 1.4vw, 1.1875rem)', lineHeight: 1.55, color: c.textMuted, maxWidth: '32rem', margin: '0 0 1.5rem 0' }}>
                {data.intro}
              </p>
            )}
            {people.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1.25rem' }}>
                {people.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'baseline',
                      gap: '0.5rem',
                      padding: '0.5rem 0.875rem',
                      background: c.cardBg,
                      border: `1px solid ${c.cardBorderStrong}`,
                      borderRadius: '999px',
                      fontSize: '0.875rem',
                    }}
                  >
                    <span style={{ fontWeight: 700, color: c.text }}>{p.name}</span>
                    <span aria-hidden="true" style={{ width: '0.1875rem', height: '0.1875rem', borderRadius: '50%', background: c.eyebrow, opacity: 0.6 }} />
                    <span style={{ fontSize: '0.75rem', color: c.eyebrow, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {p.role}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      </SectionMotion>
      <style>{`
        @media (min-width: 768px) {
          .founders-grid { grid-template-columns: 1fr 1fr !important; }
          .founders-grid > div:first-child { order: 2 !important; }
          .founders-grid > div:last-child { order: 1 !important; }
        }
      `}</style>
    </section>
  )
}

// ─── Partner badges ───────────────────────────────────────────────────────
//
// Horizontal row of credential pills (Webflow Premium Partner, Client First
// Partner, Optibase Partner, etc). Each pill is leaf-radius framed,
// brand-bordered, and lifts on hover. Optional `logo` (URL) renders before
// the label; otherwise a small green dot stands in.
function PartnerBadges({ section }: { section: PublicSection }) {
  type Item = { label: string; sub?: string; logo?: string }
  const data = safeParse<{ eyebrow?: string; intro?: string; items?: Item[] }>(section.data)
  const items = data?.items ?? []
  const theme = readTheme(section)
  const c = themeColours(theme)
  const onDark = theme === 'dark' || theme === 'brand_glass'
  return (
    <section style={{ ...slideShell, background: c.bg, color: c.text }} className="proposal-slide">
      <SectionMotion>
        <div style={{ ...slideInner, textAlign: 'center', maxWidth: '60rem' }}>
          {(data?.eyebrow ?? section.subtitle) && (
            <div style={{ ...slideEyebrow, color: c.eyebrow }}>{data?.eyebrow ?? section.subtitle}</div>
          )}
          {section.title && <h2 style={{ ...slideTitle, color: c.text }}>{section.title}</h2>}
          {data?.intro && (
            <p style={{ fontSize: '1rem', color: c.textMuted, lineHeight: 1.55, maxWidth: '36rem', margin: '0.875rem auto 0' }}>{data.intro}</p>
          )}
          <div className="proposal-partner-row" style={{ marginTop: '2rem' }}>
            {items.map((it, i) => (
              <div
                key={i}
                className="proposal-partner-pill"
                style={{
                  display: 'inline-flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '0.375rem',
                  padding: '1rem 1.25rem',
                  background: onDark ? c.cardBg : '#ffffff',
                  border: `1px solid ${c.cardBorderStrong}`,
                  borderRadius: '0 16px 0 16px',
                  textAlign: 'left',
                  transition: 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1), border-color 240ms ease, box-shadow 320ms ease',
                  minWidth: '12rem',
                }}
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  {it.logo ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={it.logo} alt="" aria-hidden="true" style={{ width: '1.125rem', height: '1.125rem', objectFit: 'contain' }} />
                  ) : (
                    <span aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: c.brandAccent, flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: c.text, letterSpacing: '-0.005em' }}>{it.label}</span>
                </div>
                {it.sub && <span style={{ fontSize: '0.75rem', color: c.textSubtle, paddingLeft: '1.625rem' }}>{it.sub}</span>}
              </div>
            ))}
          </div>
        </div>
      </SectionMotion>
      <style>{`
        .proposal-partner-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          justify-content: center;
        }
        .proposal-partner-pill:hover {
          transform: translateY(-0.125rem);
          box-shadow: 0 12px 28px -16px rgba(31,44,26,0.15);
        }
      `}</style>
    </section>
  )
}

// ─── Shared styles (mirror proposal-viewer.tsx) ─────────────────────────────

// Each section renders as one page inside a <PageChrome> frame (see
// proposal-viewer.tsx). The shell here is therefore a document-flow block
// rather than a 100svh slide. Transparent by default so the PageChrome
// cream surface shows through for light sections; themed sections
// (RetainerOffer etc) supply their own `background:` and continue to
// render as coloured slabs inside the chrome.
//
// Modest internal padding so themed (dark/glass) sections retain
// breathing room around their contents. Light sections appear flush
// against the PageChrome inner wall, which is the desired editorial look.
const slideShell: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  borderRadius: '0 16px 0 16px',
  // Modest internal padding. Themed (dark / brand-glass) sections that
  // supply their own `background:` need this so their slab keeps a calm
  // inset around the contents; light sections inherit the cream surface
  // of PageChrome and a touch more inset reads as breathing room.
  padding: 'clamp(1rem, 2.5vw, 1.75rem) clamp(0.75rem, 2vw, 1.25rem)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
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
  // letter spacing : the section title earns the slide. -0.025em matches
  // the cover h1 so every section sits on the same typographic axis.
  fontSize: 'clamp(1.75rem, 4.5vw, 3rem)',
  fontWeight: 800,
  lineHeight: 1.05,
  color: '#121A0F',
  margin: 0,
  marginBottom: '1rem',
  letterSpacing: '-0.025em',
}
const proseStyle: React.CSSProperties = {
  fontSize: '1rem',
  lineHeight: 1.65,
  color: '#121A0F',
  maxWidth: '52rem',
}
