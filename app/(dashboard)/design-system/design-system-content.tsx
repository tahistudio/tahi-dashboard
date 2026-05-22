'use client'

import { useState } from 'react'

/**
 * /design-system — the canonical token + primitive reference.
 *
 * Hidden route (no sidebar link). Admin only. Built from the Tahi Studio
 * design-system handoff bundle. When a primitive disagrees with a page,
 * the page is wrong — check this surface and fix the page.
 *
 * Phase A3 ships the foundation (tokens). Components fleshed out in A4.
 */

// ── Section TOC ─────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'colours',      label: 'Colours' },
  { id: 'typography',   label: 'Typography' },
  { id: 'spacing',      label: 'Spacing' },
  { id: 'radii',        label: 'Radii' },
  { id: 'shadows',      label: 'Shadows' },
  { id: 'motion',       label: 'Motion' },
  { id: 'iconography',  label: 'Iconography' },
  { id: 'brand',        label: 'Brand' },
  { id: 'components',   label: 'Components' },
] as const

export function DesignSystemContent() {
  return (
    <div className="space-y-16 pb-24">
      <Header />
      <TOC />
      <ColoursSection />
      <TypographySection />
      <SpacingSection />
      <RadiiSection />
      <ShadowsSection />
      <MotionSection />
      <IconographySection />
      <BrandSection />
      <ComponentsSection />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Header
// ────────────────────────────────────────────────────────────────────────
function Header() {
  return (
    <header className="space-y-3">
      <div className="tagline-row flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-brand-dark)' }}>
        <LeafGlyph size={14} />
        <span>Design system</span>
      </div>
      <h1 style={{
        fontSize: 'var(--display-h3)',
        fontWeight: 500,
        letterSpacing: 'var(--tracking-h3)',
        lineHeight: 'var(--lh-display)',
      }}>The Tahi Studio design language.</h1>
      <p style={{
        fontSize: 'var(--display-body)',
        color: 'var(--color-text-muted)',
        lineHeight: 'var(--lh-body)',
        maxWidth: '60ch',
      }}>
        One source of truth for every token, primitive, and pattern. Built from
        the marketing site and dashboard. When a page disagrees with this surface,
        the page is wrong.
      </p>
    </header>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Sticky TOC
// ────────────────────────────────────────────────────────────────────────
function TOC() {
  return (
    <nav
      className="flex flex-wrap gap-2 sticky top-0 z-10 py-3"
      style={{
        background: 'var(--color-bg-cream)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
      aria-label="Design system sections"
    >
      {SECTIONS.map(s => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="px-3 py-1.5 text-sm font-medium transition-colors"
          style={{
            color: 'var(--color-text-muted)',
            borderRadius: 'var(--radius-leaf-sm)',
            transitionDuration: 'var(--motion-quick)',
            transitionTimingFunction: 'var(--ease-out)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-brand-50)'
            e.currentTarget.style.color = 'var(--color-brand-dark)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--color-text-muted)'
          }}
        >
          {s.label}
        </a>
      ))}
    </nav>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Shared primitives used inside the showcase
// ────────────────────────────────────────────────────────────────────────
function SectionShell({ id, title, intro, children }: {
  id: string
  title: string
  intro?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="space-y-6 scroll-mt-20">
      <div className="space-y-2">
        <h2 style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 600,
          letterSpacing: 'var(--tracking-tight)',
          lineHeight: 1.2,
        }}>{title}</h2>
        {intro && (
          <p style={{
            fontSize: 'var(--text-base)',
            color: 'var(--color-text-muted)',
            lineHeight: 'var(--lh-ui)',
            maxWidth: '60ch',
          }}>{intro}</p>
        )}
      </div>
      {children}
    </section>
  )
}

function Card({ children, padded = true }: { children: React.ReactNode, padded?: boolean }) {
  return (
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-strong)',
      borderRadius: 'var(--radius-leaf)',
      padding: padded ? '1.5rem' : 0,
    }}>{children}</div>
  )
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: 'var(--text-base)',
      fontWeight: 600,
      letterSpacing: 'var(--tracking-tight)',
      color: 'var(--color-text)',
      marginBottom: '1rem',
    }}>{children}</h3>
  )
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      fontFamily: 'var(--font-mono)',
      fontSize: '0.78rem',
      color: 'var(--color-brand-dark)',
    }}>{children}</code>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Colours
// ────────────────────────────────────────────────────────────────────────

type Swatch = { token: string, hex: string, label?: string }

const BRAND_SWATCHES: Swatch[] = [
  { token: '--color-brand',         hex: '#5A824E', label: 'Primary mid-green. Links, key UI, leaf chips.' },
  { token: '--color-brand-dark',    hex: '#425F39', label: 'Hover, body green.' },
  { token: '--color-brand-darker',  hex: '#354D2E', label: 'Deep shade for dark gradients.' },
  { token: '--color-brand-deep',    hex: '#2A3626', label: 'Dark hero background.' },
  { token: '--color-brand-deepest', hex: '#1E3019', label: 'Nav bar, deepest surface.' },
  { token: '--color-brand-light',   hex: '#7AAB6B', label: 'Icons on dark.' },
  { token: '--color-brand-lighter', hex: '#97BA8C', label: 'Lightest readable on dark.' },
  { token: '--color-brand-bright',  hex: '#78C45E', label: 'Lime CTA. Primary action only.' },
  { token: '--color-brand-50',      hex: '#F0F7EE', label: 'Tint surface.' },
  { token: '--color-brand-100',     hex: '#DCEFD8', label: 'Chip background.' },
  { token: '--color-brand-200',     hex: '#B9DEB1', label: 'Chip border / outline.' },
]

const NEUTRAL_SWATCHES: Swatch[] = [
  { token: '--color-bg',           hex: '#FFFFFF', label: 'Cards on cream.' },
  { token: '--color-bg-cream',     hex: '#F3F4F2', label: 'Page background.' },
  { token: '--color-bg-secondary', hex: '#F7F9F6', label: 'Hover surface, sub-card.' },
  { token: '--color-bg-tertiary',  hex: '#EEF3EC', label: 'Inset surface.' },
  { token: '--color-bg-mist',      hex: '#E3E6E2', label: 'Divider strip.' },
  { token: '--color-text',         hex: '#121A0F', label: 'Body text.' },
  { token: '--color-text-muted',   hex: '#5A6657', label: 'Secondary text.' },
  { token: '--color-text-subtle',  hex: '#8A9987', label: 'Tertiary, meta.' },
  { token: '--color-border',       hex: '#D4E0D0', label: 'Default 1px border.' },
  { token: '--color-border-subtle',hex: '#E8F0E6', label: 'Inset border.' },
  { token: '--color-border-strong',hex: '#CDCFCC', label: 'Canonical card border.' },
]

const SEMANTIC_SWATCHES: Swatch[] = [
  { token: '--color-success', hex: '#4ADE80', label: 'Delivered, paid, complete.' },
  { token: '--color-warning', hex: '#FB923C', label: 'Needs attention, due soon.' },
  { token: '--color-danger',  hex: '#DC2626', label: 'High priority, overdue, error.' },
  { token: '--color-info',    hex: '#60A5FA', label: 'Submitted, incoming.' },
  { token: '--color-accent',  hex: '#78C45E', label: 'Lime CTA.' },
  { token: '--color-highlight', hex: '#F7CE48', label: 'Sticky-note callout only.' },
]

const STATUS_SWATCHES: Array<{ key: string, dot: string, bg: string, text: string, label: string }> = [
  { key: 'draft',          dot: '#9CA3AF', bg: '#F3F4F6', text: '#4B5563', label: 'Draft' },
  { key: 'submitted',      dot: '#60A5FA', bg: '#EFF6FF', text: '#1D4ED8', label: 'Submitted' },
  { key: 'in-review',      dot: '#FBBF24', bg: '#FFFBEB', text: '#92400E', label: 'In review' },
  { key: 'in-progress',    dot: '#06B6D4', bg: '#ECFEFF', text: '#0E7490', label: 'In progress' },
  { key: 'client-review',  dot: '#A78BFA', bg: '#F5F3FF', text: '#6D28D9', label: 'Client review' },
  { key: 'delivered',      dot: '#22C55E', bg: '#F0FDF4', text: '#15803D', label: 'Delivered' },
  { key: 'archived',       dot: '#D1D5DB', bg: '#F9FAFB', text: '#6B7280', label: 'Archived' },
]

function SwatchTile({ s, dark }: { s: Swatch, dark?: boolean }) {
  return (
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-leaf-sm)',
      overflow: 'hidden',
    }}>
      <div style={{
        background: s.hex,
        height: '4rem',
        borderBottom: '1px solid var(--color-border-subtle)',
      }} />
      <div style={{ padding: '0.75rem 0.875rem' }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--color-text)', fontWeight: 500 }}>
          {s.hex}
        </div>
        <div style={{ marginTop: '0.125rem' }}>
          <Mono>{s.token}</Mono>
        </div>
        {s.label && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
            {s.label}
          </div>
        )}
      </div>
      {dark && null}
    </div>
  )
}

function ColoursSection() {
  return (
    <SectionShell
      id="colours"
      title="Colours"
      intro="Green-on-cream, never grey-on-white. Forest greens, warm cream neutrals, semantic palette layered on top. Status colours apply across requests, deals, invoices."
    >
      <div className="space-y-4">
        <Card>
          <GroupHeading>Brand</GroupHeading>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {BRAND_SWATCHES.map(s => <SwatchTile key={s.token} s={s} />)}
          </div>
        </Card>

        <Card>
          <GroupHeading>Neutrals & surfaces</GroupHeading>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {NEUTRAL_SWATCHES.map(s => <SwatchTile key={s.token} s={s} />)}
          </div>
        </Card>

        <Card>
          <GroupHeading>Semantic</GroupHeading>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {SEMANTIC_SWATCHES.map(s => <SwatchTile key={s.token} s={s} />)}
          </div>
        </Card>

        <Card>
          <GroupHeading>Status palette (request / deal / invoice)</GroupHeading>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {STATUS_SWATCHES.map(s => (
              <div key={s.key} style={{
                background: s.bg, color: s.text,
                padding: '0.625rem 0.875rem',
                borderRadius: 'var(--radius-leaf-sm)',
                display: 'flex', alignItems: 'center', gap: '0.625rem',
                fontSize: '0.8125rem', fontWeight: 500,
              }}>
                <span style={{
                  width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: s.dot,
                  flexShrink: 0,
                }} />
                {s.label}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </SectionShell>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Typography
// ────────────────────────────────────────────────────────────────────────
function TypographySection() {
  return (
    <SectionShell
      id="typography"
      title="Typography"
      intro="Manrope across the entire system at 300 – 800. Two ladders: marketing display (hero, section headlines, big numbers) and dashboard UI (dense, 12 – 24px). 500 is the default body weight — heavier than most systems, which is what gives Manrope its quiet confidence."
    >
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <GroupHeading>Display ladder</GroupHeading>
          <div className="space-y-5">
            <TypeSpec label="Hero" size="--display-hero" weight={700} tracking="-1.5px" sample="Grow with one studio." />
            <TypeSpec label="H1"   size="--display-h1"   weight={500} tracking="var(--tracking-display)" sample="The Webflow partner." />
            <TypeSpec label="H2"   size="--display-h2"   weight={500} tracking="var(--tracking-display)" sample="A partner worth keeping." />
            <TypeSpec label="H3"   size="--display-h3"   weight={500} tracking="var(--tracking-h3)" sample="One retainer." />
            <TypeSpec label="H4"   size="--display-h4"   weight={600} tracking="0" sample="What ships under the brand." />
            <TypeSpec label="Lead" size="--display-body-lg" weight={500} tracking="-0.25px" sample="One studio, every stage." />
            <TypeSpec label="Body" size="--display-body" weight={500} tracking="0" sample="Your website should move with your business." />
            <TypeSpec label="Meta" size="--display-meta" weight={500} tracking="0" sample="5 min read · Tahi Studio" />
          </div>
        </Card>

        <Card>
          <GroupHeading>Dashboard UI ladder</GroupHeading>
          <div className="space-y-5">
            <TypeSpec label="2XL"   size="--text-2xl"  weight={600} tracking="var(--tracking-tight)" sample="$24,580" />
            <TypeSpec label="XL"    size="--text-xl"   weight={600} tracking="var(--tracking-tight)" sample="Requests" />
            <TypeSpec label="LG"    size="--text-lg"   weight={500} tracking="0" sample="Sub-page title" />
            <TypeSpec label="MD"    size="--text-md"   weight={500} tracking="0" sample="Card title" />
            <TypeSpec label="Base"  size="--text-base" weight={500} tracking="0" sample="Default body — every dense list, every form." />
            <TypeSpec label="SM"    size="--text-sm"   weight={500} tracking="0" sample="Secondary text, table cell, nav item." />
            <TypeSpec label="XS"    size="--text-xs"   weight={500} tracking="0.020em" sample="LABEL · META · BADGE" />
          </div>
        </Card>
      </div>

      <Card>
        <GroupHeading>Weights</GroupHeading>
        <div className="flex flex-wrap gap-x-8 gap-y-2" style={{ fontSize: '1.125rem' }}>
          <span style={{ fontWeight: 300 }}>300 Light</span>
          <span style={{ fontWeight: 400 }}>400 Regular</span>
          <span style={{ fontWeight: 500 }}>500 Medium · default</span>
          <span style={{ fontWeight: 600 }}>600 Semibold</span>
          <span style={{ fontWeight: 700 }}>700 Bold</span>
          <span style={{ fontWeight: 800 }}>800 Extrabold</span>
        </div>
      </Card>
    </SectionShell>
  )
}

function TypeSpec({ label, size, weight, tracking, sample }: {
  label: string, size: string, weight: number, tracking: string, sample: string,
}) {
  return (
    <div>
      <div className="flex items-baseline gap-3 mb-1">
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-subtle)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <Mono>{size} · {weight}</Mono>
      </div>
      <div style={{
        fontSize: `var(${size})`,
        fontWeight: weight,
        letterSpacing: tracking,
        lineHeight: 1.15,
        color: 'var(--color-text)',
      }}>{sample}</div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Spacing
// ────────────────────────────────────────────────────────────────────────
const SPACING_TOKENS: Array<{ token: string, rem: string, px: number }> = [
  { token: '--space-0-5', rem: '0.125rem', px: 2 },
  { token: '--space-1',   rem: '0.25rem',  px: 4 },
  { token: '--space-1-5', rem: '0.375rem', px: 6 },
  { token: '--space-2',   rem: '0.5rem',   px: 8 },
  { token: '--space-3',   rem: '0.75rem',  px: 12 },
  { token: '--space-4',   rem: '1rem',     px: 16 },
  { token: '--space-5',   rem: '1.25rem',  px: 20 },
  { token: '--space-6',   rem: '1.5rem',   px: 24 },
  { token: '--space-8',   rem: '2rem',     px: 32 },
  { token: '--space-10',  rem: '2.5rem',   px: 40 },
  { token: '--space-12',  rem: '3rem',     px: 48 },
]

function SpacingSection() {
  return (
    <SectionShell id="spacing" title="Spacing" intro="8px base scale with halves at 4px and quarter at 2px. Section vertical padding 112px on desktop. All spacing is rem.">
      <Card>
        <div className="space-y-2">
          {SPACING_TOKENS.map(t => (
            <div key={t.token} className="flex items-center gap-4">
              <Mono>{t.token}</Mono>
              <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', width: '4.5rem' }}>{t.px}px</span>
              <div style={{
                background: 'var(--color-brand-100)',
                height: '0.875rem',
                width: t.rem,
                borderRadius: 'var(--radius-sm)',
              }} />
            </div>
          ))}
        </div>
      </Card>
    </SectionShell>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Radii
// ────────────────────────────────────────────────────────────────────────
const RADII = [
  { token: '--radius-leaf-sm', value: '0 0.625rem 0 0.625rem', label: 'Leaf SM · 10px',  use: 'Buttons, chips' },
  { token: '--radius-leaf',    value: '0 1rem 0 1rem',         label: 'Leaf MD · 16px',  use: 'Cards, panels' },
  { token: '--radius-leaf-lg', value: '0 1.5rem 0 1.5rem',     label: 'Leaf LG · 24px',  use: 'Plan cards, photo crops' },
  { token: '--radius-leaf-xl', value: '0 4rem 0 4rem',         label: 'Leaf XL · 64px',  use: 'Full-bleed sections' },
  { token: '--radius-sm',      value: '0.375rem',              label: 'SM · 6px',        use: 'Badges' },
  { token: '--radius-md',      value: '0.5rem',                label: 'MD · 8px',        use: 'Inputs, pills' },
  { token: '--radius-lg',      value: '0.75rem',               label: 'LG · 12px',       use: 'Cards (symmetric)' },
  { token: '--radius-full',    value: '9999px',                label: 'Full',            use: 'Avatars, dots' },
]

function RadiiSection() {
  return (
    <SectionShell
      id="radii"
      title="Radii — the leaf shape"
      intro="The single most identifying visual element. Top-left sharp · top-right round · bottom-right sharp · bottom-left round. Applied to buttons, cards, panels. Symmetric radii are reserved for inputs (8px) and pills (full)."
    >
      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {RADII.map(r => (
            <div key={r.token}>
              <div style={{
                background: 'var(--color-brand-50)',
                border: '1px solid var(--color-brand-200)',
                borderRadius: r.value,
                height: '5rem',
              }} />
              <div className="mt-2 space-y-1">
                <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{r.label}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{r.use}</div>
                <Mono>{r.token}</Mono>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </SectionShell>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Shadows
// ────────────────────────────────────────────────────────────────────────
const SHADOWS = [
  { token: '--shadow-xs',    use: 'Rest state, very subtle' },
  { token: '--shadow-sm',    use: 'Hover on cards' },
  { token: '--shadow-md',    use: 'Popovers, dropdowns' },
  { token: '--shadow-leaf',  use: 'Hero device mockup hover' },
  { token: '--shadow-brand', use: 'Primary CTA hover only' },
]

function ShadowsSection() {
  return (
    <SectionShell
      id="shadows"
      title="Shadows"
      intro="Used sparingly. Cards rest on a 1px border, not a shadow. Shadows appear only on hover, on popovers/dropdowns, or as the brand CTA glow. No large drop shadows anywhere."
    >
      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {SHADOWS.map(s => (
            <div key={s.token}>
              <div style={{
                background: 'var(--color-bg)',
                borderRadius: 'var(--radius-leaf-sm)',
                height: '5rem',
                boxShadow: `var(${s.token})`,
              }} />
              <div className="mt-2 space-y-1">
                <Mono>{s.token}</Mono>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>{s.use}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </SectionShell>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Motion
// ────────────────────────────────────────────────────────────────────────
const MOTION_TOKENS = [
  { token: '--motion-quick',  ms: '220ms',  use: 'Colour swap, focus ring' },
  { token: '--motion-base',   ms: '420ms',  use: 'Default hover — the studio tempo' },
  { token: '--motion-medium', ms: '520ms',  use: 'Underline sweep, arrow translate' },
  { token: '--motion-slow',   ms: '720ms',  use: 'Card lift, scroll reveal' },
  { token: '--motion-grand',  ms: '1100ms', use: 'Arrow loop, hero reveal' },
]

function MotionSection() {
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <SectionShell
      id="motion"
      title="Motion"
      intro="Calm. Slower than most systems. Ease-out only — never bounce. The cubic 0.22, 1, 0.36, 1 reads as premium. All animations honour prefers-reduced-motion."
    >
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {MOTION_TOKENS.map(m => {
            const isHover = hovered === m.token
            return (
              <button
                key={m.token}
                onMouseEnter={() => setHovered(m.token)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(m.token)}
                onBlur={() => setHovered(null)}
                style={{
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border-strong)',
                  borderRadius: 'var(--radius-leaf-sm)',
                  padding: '1rem',
                  textAlign: 'left',
                  transform: isHover ? 'translateY(-2px)' : 'translateY(0)',
                  boxShadow: isHover ? 'var(--shadow-sm)' : 'none',
                  transition: `transform ${m.ms} var(--ease-out), box-shadow ${m.ms} var(--ease-out)`,
                  cursor: 'pointer',
                }}
                aria-label={`Hover to preview ${m.ms} motion`}
              >
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.25rem' }}>{m.ms}</div>
                <Mono>{m.token}</Mono>
                <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{m.use}</div>
              </button>
            )
          })}
        </div>
        <div style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
          Hover any card to preview its tempo. Curves: <Mono>--ease-out</Mono> for nearly everything, <Mono>--ease-spring</Mono> reserved for hover-lift.
        </div>
      </Card>
    </SectionShell>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Iconography
// ────────────────────────────────────────────────────────────────────────
const ICONS: Array<{ name: string, paths: React.ReactNode, use: string }> = [
  { name: 'leaf',           use: 'Growth metaphor, brand', paths: (<><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96a1 1 0 0 1 1.8.56c0 5.62-1.34 10.83-5 14.6A7 7 0 0 1 11 20Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/></>) },
  { name: 'sprout',         use: 'Stage 1, launch', paths: (<><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2 2 3.3-1.3.4-2.7.2-3.8-.5-1.1-.8-1.8-2-2-3.3 1.3-.5 2.7-.2 3.8.5z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.7-1 5-2.4.6-.8 1-1.7 1-2.6-1.4-.1-2.8.4-3.9 1z"/></>) },
  { name: 'tree-pine',      use: 'Carbon negative, stage 3', paths: (<><path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z"/><path d="M12 22v-3"/></>) },
  { name: 'heart-handshake',use: 'Partnership', paths: (<><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M12 5 9.04 7.96a2.17 2.17 0 0 0 0 3.08v0c.82.82 2.13.85 3 .07l2.07-1.9a2.82 2.82 0 0 1 3.79 0l2.96 2.66"/><path d="m18 15-2-2"/><path d="m15 18-2-2"/></>) },
  { name: 'sparkles',       use: 'AI features', paths: (<><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></>) },
  { name: 'arrow-up-right', use: 'Outbound, CTA arrow', paths: (<><path d="M7 7h10v10"/><path d="M7 17 17 7"/></>) },
  { name: 'arrow-right',    use: 'Continue, next', paths: (<><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>) },
  { name: 'chevron-down',   use: 'Dropdowns, expand', paths: (<path d="m6 9 6 6 6-6"/>) },
  { name: 'home',           use: 'Overview', paths: (<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2h-4v-7H10v7H6a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></>) },
  { name: 'inbox',          use: 'Requests', paths: (<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>) },
  { name: 'kanban',         use: 'Pipeline / board view', paths: (<><path d="M6 5v11"/><path d="M12 5v6"/><path d="M18 5v14"/></>) },
  { name: 'users',          use: 'Clients, team', paths: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>) },
  { name: 'receipt',        use: 'Invoices', paths: (<><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/></>) },
  { name: 'bar-chart',      use: 'Reports', paths: (<><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></>) },
  { name: 'calendar',       use: 'Due dates, calls', paths: (<><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>) },
  { name: 'clock',          use: 'Time tracker', paths: (<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>) },
  { name: 'bell',           use: 'Notifications', paths: (<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>) },
  { name: 'search',         use: 'Top-nav search', paths: (<><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>) },
  { name: 'plus',           use: 'Create new', paths: (<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>) },
  { name: 'check-circle',   use: 'Delivered, complete', paths: (<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>) },
  { name: 'alert-triangle', use: 'Warning, error', paths: (<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>) },
  { name: 'trending-up',    use: 'KPI delta positive', paths: (<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></>) },
  { name: 'settings',       use: 'Settings, options', paths: (<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></>) },
  { name: 'more-horizontal',use: 'Row actions', paths: (<><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>) },
]

function LucideIcon({ children, size = 24, stroke = 1.5, color = 'currentColor' }: {
  children: React.ReactNode, size?: number, stroke?: number, color?: string,
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true">
      {children}
    </svg>
  )
}

function IconographySection() {
  return (
    <SectionShell
      id="iconography"
      title="Iconography"
      intro="Lucide at 1.5px stroke is the only icon set. No emoji, ever. The leaf glyph is a separate brand mark — used as the chip dot and the tagline-leader."
    >
      <Card>
        <GroupHeading>Icons in use</GroupHeading>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {ICONS.map(icon => (
            <div key={icon.name} style={{
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-leaf-sm)',
              padding: '0.875rem',
              display: 'flex', alignItems: 'center', gap: '0.75rem',
            }}>
              <div style={{ color: 'var(--color-brand-dark)', flexShrink: 0 }}>
                <LucideIcon>{icon.paths}</LucideIcon>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{icon.name}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {icon.use}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <GroupHeading>The leaf glyph</GroupHeading>
        <div className="flex flex-wrap items-center gap-6">
          <div style={{ color: 'var(--color-brand)' }}>
            <LeafGlyph size={48} />
          </div>
          <div className="space-y-1" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.6, maxWidth: '32rem' }}>
            <div>Separate from Lucide. The Tahi tagline-leader, the chip dot, and the <em>i</em>-dot on the short wordmark.</div>
            <div>Never substitute with an emoji. Never invert. Rendered in <Mono>var(--color-brand)</Mono> at small sizes; gradient at large.</div>
          </div>
        </div>
      </Card>
    </SectionShell>
  )
}

function LeafGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96a1 1 0 0 1 1.8.56c0 5.62-1.34 10.83-5 14.6A7 7 0 0 1 11 20Z" />
    </svg>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Brand
// ────────────────────────────────────────────────────────────────────────
function BrandSection() {
  return (
    <SectionShell
      id="brand"
      title="Brand"
      intro="The Tahi mark is itself a leaf — a stylised drop on the i of Tahi. Used as the wordmark, the icon, the chip dot, and the tagline-leader."
    >
      <Card>
        <GroupHeading>Wordmark</GroupHeading>
        <div className="flex flex-wrap items-center gap-12">
          <div style={{ color: 'var(--color-brand-deepest)', fontSize: '3.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Tahi<span style={{ color: 'var(--color-brand)' }}>.</span>
          </div>
          <div style={{
            background: 'var(--color-brand-deepest)',
            color: 'var(--color-text-on-dark)',
            padding: '1.5rem 2rem',
            borderRadius: 'var(--radius-leaf)',
            fontSize: '3.5rem', fontWeight: 700, letterSpacing: '-0.02em',
          }}>
            Tahi<span style={{ color: 'var(--color-brand-bright)' }}>.</span>
          </div>
        </div>
      </Card>

      <Card>
        <GroupHeading>Tone &amp; voice</GroupHeading>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-subtle)', marginBottom: '0.5rem' }}>Sound like</div>
            <ul style={{ fontSize: '0.875rem', lineHeight: 1.7, color: 'var(--color-text)' }} className="space-y-1.5">
              <li>Honest — &ldquo;If your brief has a problem, we say so.&rdquo;</li>
              <li>Concrete — &ldquo;From $2,500. One-off. Scoped individually.&rdquo;</li>
              <li>Plant-rooted — grow, track, tune, sprout</li>
              <li>Reassuring — &ldquo;No long queues, no half-finished tasks.&rdquo;</li>
            </ul>
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-subtle)', marginBottom: '0.5rem' }}>Never sound like</div>
            <ul style={{ fontSize: '0.875rem', lineHeight: 1.7, color: 'var(--color-text)' }} className="space-y-1.5">
              <li>Title-cased headlines. Sentence case only.</li>
              <li>&ldquo;World-class&rdquo;, &ldquo;cutting-edge&rdquo;, &ldquo;rockstar&rdquo;</li>
              <li>&ldquo;Our team&rdquo;, &ldquo;the client&rdquo; in body copy</li>
              <li>Emoji or exclamation marks</li>
            </ul>
          </div>
        </div>
      </Card>
    </SectionShell>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Components (placeholder for A4)
// ────────────────────────────────────────────────────────────────────────
function ComponentsSection() {
  return (
    <SectionShell
      id="components"
      title="Components"
      intro="Primitives refresh lands in A4 — buttons, badges, chips, callouts, toasts, pagination, stepper, progress, data table, kanban card. Each one tied back to the tokens above."
    >
      <Card>
        <div style={{
          padding: '2rem 1.5rem',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          fontSize: '0.875rem',
          lineHeight: 1.6,
        }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-subtle)', marginBottom: '0.5rem' }}>
            Phase A4
          </div>
          <div style={{ maxWidth: '36rem', margin: '0 auto' }}>
            Ships the refreshed primitives in <Mono>components/tahi/</Mono>. Each will live here with all its states (rest, hover, focus, pressed, disabled, loading) and a usage note.
          </div>
        </div>
      </Card>
    </SectionShell>
  )
}
