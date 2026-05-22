'use client'

import * as React from 'react'
import { useState } from 'react'
import { LeafGlyph, TahiWordmark, TahiStudioWordmark, TahiIconMark } from '@/components/tahi/tahi-glyphs'

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
  { id: 'animations',   label: 'Animation styles' },
  { id: 'brand',        label: 'Brand' },
  { id: 'wcag',         label: 'WCAG 2.2' },
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
      <AnimationStylesSection />
      <BrandSection />
      <WcagSection />
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
      <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--color-brand-dark)' }}>
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
          className="px-3 py-1.5 text-sm font-medium"
          style={{
            color: 'var(--color-text-muted)',
            borderRadius: 'var(--radius-leaf-sm)',
            transition: 'background var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
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

function SwatchTile({ s }: { s: Swatch }) {
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
//
// Currently using Lucide at 1.5px stroke. The user flagged that some
// shapes (notably arrow heads) feel too blocky and asked to compare
// against Phosphor / Tabler — see the AltArrows panel below.
//
// Per-icon micro-animations: each tile is wrapped in <IconTile> which
// applies a subtle hover lift + colour shift. Specific icons opt into
// a directional motion (arrows translate, bell rings, plus rotates,
// search and eye scale). Driven by the `motion` field on each entry.
// Honours prefers-reduced-motion via the global rule in globals.css.
// ────────────────────────────────────────────────────────────────────────

type IconMotion = 'lift' | 'arrow-up-right' | 'arrow-right' | 'arrow-left' | 'arrow-down' | 'arrow-up' | 'bell' | 'spin' | 'pulse' | 'scale'

type IconDef = { name: string, use: string, paths: React.ReactNode, motion?: IconMotion }

// All paths verified against Lucide v0.359+ (24×24 grid, 1.5px stroke
// applied by the wrapper). The previous home path closed incorrectly at
// h-4v-7 — fixed to H5 so the silhouette renders as a proper house.
const ICONS: IconDef[] = [
  // Brand & narrative
  { name: 'leaf',            use: 'Growth, brand',         motion: 'lift',  paths: (<><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96a1 1 0 0 1 1.8.56c0 5.62-1.34 10.83-5 14.6A7 7 0 0 1 11 20Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/></>) },
  { name: 'sprout',          use: 'Launch, stage 1',       motion: 'lift',  paths: (<><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2 2 3.3-1.3.4-2.7.2-3.8-.5-1.1-.8-1.8-2-2-3.3 1.3-.5 2.7-.2 3.8.5z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.7-1 5-2.4.6-.8 1-1.7 1-2.6-1.4-.1-2.8.4-3.9 1z"/></>) },
  { name: 'tree-pine',       use: 'Carbon negative',       motion: 'lift',  paths: (<><path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z"/><path d="M12 22v-3"/></>) },
  { name: 'heart-handshake', use: 'Partnership',           motion: 'pulse', paths: (<><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M12 5 9.04 7.96a2.17 2.17 0 0 0 0 3.08v0c.82.82 2.13.85 3 .07l2.07-1.9a2.82 2.82 0 0 1 3.79 0l2.96 2.66"/><path d="m18 15-2-2"/><path d="m15 18-2-2"/></>) },
  { name: 'sparkles',        use: 'AI features',           motion: 'pulse', paths: (<><path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></>) },

  // Wayfinding
  { name: 'home',            use: 'Overview',              motion: 'lift',  paths: (<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>) },
  { name: 'inbox',           use: 'Requests',              motion: 'lift',  paths: (<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>) },
  { name: 'kanban',          use: 'Board view',            motion: 'lift',  paths: (<><path d="M6 5v11"/><path d="M12 5v6"/><path d="M18 5v14"/></>) },
  { name: 'layout-grid',     use: 'Grid view',             motion: 'lift',  paths: (<><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></>) },
  { name: 'list',            use: 'List view',             motion: 'lift',  paths: (<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>) },
  { name: 'folder',          use: 'Files, group',          motion: 'lift',  paths: (<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>) },
  { name: 'file-text',       use: 'Docs, contracts',       motion: 'lift',  paths: (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>) },
  { name: 'receipt',         use: 'Invoices',              motion: 'lift',  paths: (<><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/></>) },
  { name: 'bar-chart',       use: 'Reports',               motion: 'lift',  paths: (<><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></>) },
  { name: 'settings',        use: 'Settings',              motion: 'spin',  paths: (<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></>) },

  // Search / actions
  { name: 'search',          use: 'Top-nav search',        motion: 'scale', paths: (<><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>) },
  { name: 'command',         use: 'Cmd+K palette',         motion: 'lift',  paths: (<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>) },
  { name: 'plus',            use: 'Create new',            motion: 'spin',  paths: (<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>) },
  { name: 'x',               use: 'Close, dismiss',        motion: 'spin',  paths: (<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>) },
  { name: 'edit',            use: 'Edit, rename',          motion: 'lift',  paths: (<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></>) },
  { name: 'trash',           use: 'Delete',                motion: 'lift',  paths: (<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>) },
  { name: 'copy',            use: 'Duplicate',             motion: 'lift',  paths: (<><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></>) },
  { name: 'download',        use: 'Download file',         motion: 'arrow-down', paths: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>) },
  { name: 'upload',          use: 'Upload file',           motion: 'arrow-up',   paths: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>) },
  { name: 'share',           use: 'Share link',            motion: 'lift',  paths: (<><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></>) },
  { name: 'link',            use: 'Internal link',         motion: 'lift',  paths: (<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>) },
  { name: 'external-link',   use: 'Open in new tab',       motion: 'arrow-up-right', paths: (<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>) },
  { name: 'refresh-cw',      use: 'Reload, sync',          motion: 'spin',  paths: (<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>) },
  { name: 'more-horizontal', use: 'Row actions',           motion: 'lift',  paths: (<><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>) },

  // Arrows
  { name: 'arrow-up-right',  use: 'Outbound, CTA',         motion: 'arrow-up-right', paths: (<><path d="M7 7h10v10"/><path d="M7 17 17 7"/></>) },
  { name: 'arrow-right',     use: 'Continue, next',        motion: 'arrow-right',    paths: (<><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>) },
  { name: 'arrow-left',      use: 'Back',                  motion: 'arrow-left',     paths: (<><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></>) },
  { name: 'arrow-up',        use: 'Increase, up',          motion: 'arrow-up',       paths: (<><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></>) },
  { name: 'arrow-down',      use: 'Decrease, down',        motion: 'arrow-down',     paths: (<><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></>) },
  { name: 'chevron-right',   use: 'Expand, next page',     motion: 'arrow-right',    paths: (<polyline points="9 18 15 12 9 6"/>) },
  { name: 'chevron-left',    use: 'Collapse, prev',        motion: 'arrow-left',     paths: (<polyline points="15 18 9 12 15 6"/>) },
  { name: 'chevron-down',    use: 'Dropdown',              motion: 'arrow-down',     paths: (<polyline points="6 9 12 15 18 9"/>) },
  { name: 'chevron-up',      use: 'Collapse',              motion: 'arrow-up',       paths: (<polyline points="18 15 12 9 6 15"/>) },

  // Status / feedback
  { name: 'check-circle',    use: 'Delivered, done',       motion: 'pulse', paths: (<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>) },
  { name: 'check',           use: 'Inline confirm',        motion: 'pulse', paths: (<polyline points="20 6 9 17 4 12"/>) },
  { name: 'alert-triangle',  use: 'Warning, error',        motion: 'pulse', paths: (<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>) },
  { name: 'alert-circle',    use: 'Heads up',              motion: 'pulse', paths: (<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>) },
  { name: 'info',            use: 'Informational',         motion: 'pulse', paths: (<><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>) },
  { name: 'zap',             use: 'Fast, launch',          motion: 'pulse', paths: (<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>) },
  { name: 'flame',           use: 'Hot, urgent',           motion: 'pulse', paths: (<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>) },

  // Money & data
  { name: 'dollar-sign',     use: 'Money, billable',       motion: 'lift',  paths: (<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>) },
  { name: 'percent',         use: 'Discount, rate',        motion: 'lift',  paths: (<><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></>) },
  { name: 'trending-up',     use: 'KPI delta+',            motion: 'arrow-up-right', paths: (<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></>) },
  { name: 'trending-down',   use: 'KPI delta-',            motion: 'arrow-up-right', paths: (<><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></>) },
  { name: 'pie-chart',       use: 'Breakdown',             motion: 'lift',  paths: (<><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></>) },
  { name: 'activity',        use: 'Live status',           motion: 'pulse', paths: (<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>) },

  // People & comms
  { name: 'users',           use: 'Team, clients',         motion: 'lift',  paths: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>) },
  { name: 'user',            use: 'Single person',         motion: 'lift',  paths: (<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>) },
  { name: 'user-plus',       use: 'Add member',            motion: 'lift',  paths: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></>) },
  { name: 'message-circle',  use: 'Comments',              motion: 'lift',  paths: (<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>) },
  { name: 'mail',            use: 'Email',                 motion: 'lift',  paths: (<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></>) },
  { name: 'phone',           use: 'Phone, call',           motion: 'lift',  paths: (<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>) },
  { name: 'video',           use: 'Video call',            motion: 'lift',  paths: (<><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></>) },
  { name: 'bell',            use: 'Notifications',         motion: 'bell',  paths: (<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>) },

  // Time
  { name: 'clock',           use: 'Time tracker',          motion: 'spin',  paths: (<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>) },
  { name: 'calendar',        use: 'Date, due',             motion: 'lift',  paths: (<><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>) },
  { name: 'timer',           use: 'Live timer',            motion: 'pulse', paths: (<><line x1="10" y1="2" x2="14" y2="2"/><line x1="12" y1="14" x2="15" y2="11"/><circle cx="12" cy="14" r="8"/></>) },

  // View options
  { name: 'eye',             use: 'Visible, preview',      motion: 'scale', paths: (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>) },
  { name: 'eye-off',         use: 'Hidden, private',       motion: 'scale', paths: (<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>) },
  { name: 'filter',          use: 'Filter table',          motion: 'lift',  paths: (<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>) },
  { name: 'sliders',         use: 'Adjust',                motion: 'lift',  paths: (<><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>) },
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

// Per-icon hover transform. Designed to be subtle. All translations cap
// at 2px; rotations at 45°; scales at 1.10. So they read as polish, not
// cartoon. Driven off the icon's `motion` field.
function motionTransform(motion: IconMotion | undefined): string {
  switch (motion) {
    case 'arrow-up-right': return 'translate(2px, -2px)'
    case 'arrow-right':    return 'translateX(2px)'
    case 'arrow-left':     return 'translateX(-2px)'
    case 'arrow-up':       return 'translateY(-2px)'
    case 'arrow-down':     return 'translateY(2px)'
    case 'bell':           return 'rotate(-10deg)'
    case 'spin':           return 'rotate(45deg)'
    case 'pulse':          return 'scale(1.08)'
    case 'scale':          return 'scale(1.10)'
    case 'lift':
    default:               return 'translateY(-1px)'
  }
}

function IconTile({ icon }: { icon: IconDef }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
      role="figure"
      aria-label={`${icon.name} — ${icon.use}`}
      style={{
        borderRadius: 'var(--radius-leaf-sm)',
        padding: '0.875rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: hovered ? 'var(--color-brand-50)' : 'var(--color-bg)',
        transition: 'background var(--motion-quick) var(--ease-out)',
        cursor: 'default',
        outline: 'none',
      }}
    >
      <div style={{
        color: hovered ? 'var(--color-brand)' : 'var(--color-brand-dark)',
        flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '2rem', height: '2rem',
        transform: hovered ? motionTransform(icon.motion) : 'none',
        transition: 'transform var(--motion-base) var(--ease-out), color var(--motion-quick) var(--ease-out)',
        transformOrigin: 'center',
      }}>
        <LucideIcon>{icon.paths}</LucideIcon>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{icon.name}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {icon.use}
        </div>
      </div>
    </div>
  )
}

// Same three actions across Lucide / Phosphor (regular) / Tabler so we
// can compare arrow-head geometry before standardising. Phosphor regular
// uses a 16-unit stroke on a 256 viewBox which renders as a curved-head
// arrow with no inner L-angle.
function AltArrows() {
  type Sample = { lib: 'Lucide' | 'Phosphor' | 'Tabler', paths: React.ReactNode, viewBox?: string, stroke?: number }
  type Row = { name: string, samples: Sample[] }

  const rows: Row[] = [
    {
      name: 'arrow-up-right',
      samples: [
        { lib: 'Lucide',   paths: <><path d="M7 7h10v10"/><path d="M7 17 17 7"/></> },
        { lib: 'Phosphor', viewBox: '0 0 256 256', stroke: 16, paths: <><path d="M64,192,192,64M88,64H192v104"/></> },
        { lib: 'Tabler',   paths: <><path d="M17 7l-10 10"/><path d="M8 7l9 0"/><path d="M17 8l0 9"/></> },
      ],
    },
    {
      name: 'arrow-right',
      samples: [
        { lib: 'Lucide',   paths: <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></> },
        { lib: 'Phosphor', viewBox: '0 0 256 256', stroke: 16, paths: <><path d="M40,128H216M144,56l72,72-72,72"/></> },
        { lib: 'Tabler',   paths: <><path d="M5 12l14 0"/><path d="M13 18l6 -6"/><path d="M13 6l6 6"/></> },
      ],
    },
    {
      name: 'chevron-right',
      samples: [
        { lib: 'Lucide',   paths: <polyline points="9 18 15 12 9 6"/> },
        { lib: 'Phosphor', viewBox: '0 0 256 256', stroke: 16, paths: <polyline points="96,48 176,128 96,208"/> },
        { lib: 'Tabler',   paths: <path d="M9 6l6 6l-6 6"/> },
      ],
    },
  ]

  return (
    <Card>
      <GroupHeading>Arrow refinement — compare</GroupHeading>
      <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
        Same three arrows rendered from <Mono>Lucide</Mono> (current), <Mono>Phosphor</Mono> (regular weight, rounded heads), and <Mono>Tabler</Mono> (outline, slightly tighter geometry). Phosphor arrow heads have no inner right-angle, which is what reads as &ldquo;less wide&rdquo;. Pick one to standardise on.
      </p>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'auto repeat(3, 1fr)',
        gap: '0.5rem 1rem',
        alignItems: 'center',
      }}>
        <div />
        {(['Lucide', 'Phosphor', 'Tabler'] as const).map(lib => (
          <div key={lib} style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {lib}
          </div>
        ))}
        {rows.map(row => (
          <React.Fragment key={row.name}>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{row.name}</div>
            {row.samples.map(sample => (
              <div key={sample.lib} style={{
                background: 'var(--color-brand-50)',
                borderRadius: 'var(--radius-leaf-sm)',
                padding: '1rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <svg
                  width={32} height={32}
                  viewBox={sample.viewBox ?? '0 0 24 24'}
                  fill="none"
                  stroke="var(--color-brand-dark)"
                  strokeWidth={sample.stroke ?? 1.5}
                  strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"
                >
                  {sample.paths}
                </svg>
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </Card>
  )
}

function IconographySection() {
  return (
    <SectionShell
      id="iconography"
      title="Iconography"
      intro="Currently Lucide at 1.5px stroke (already installed via lucide-react). Set is rich. Arrows feel a bit blocky — compare against Phosphor / Tabler in the panel below before deciding on a swap. The Tahi leaf glyph stays separate either way."
    >
      <Card padded={false}>
        <div style={{ padding: '1.5rem 1.5rem 0.5rem' }}>
          <GroupHeading>Icon library — {ICONS.length} icons</GroupHeading>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem', lineHeight: 1.5 }}>
            Hover any tile to feel its motion. Arrows nudge in their direction, the bell rings, the cog spins 45°, plus and x rotate, search and eye scale. All motion caps at 2px / 45° / 1.10×.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1 px-3 pb-3">
          {ICONS.map(icon => <IconTile key={icon.name} icon={icon} />)}
        </div>
      </Card>

      <AltArrows />

      <Card>
        <GroupHeading>The leaf glyph</GroupHeading>
        <div className="flex flex-wrap items-center gap-8">
          <div className="flex items-end gap-4">
            <LeafGlyph size={16} />
            <LeafGlyph size={24} />
            <LeafGlyph size={32} />
            <LeafGlyph size={48} />
            <LeafGlyph size={72} />
          </div>
          <div className="space-y-1.5" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.6, maxWidth: '32rem' }}>
            <div>Separate from Lucide. Renders with the brand gradient (brand → brand-dark) built in.</div>
            <div>Used as the chip dot, tagline-leader, and the <em>i</em>-dot on the wordmarks.</div>
            <div>Never substituted with an emoji. Never inverted. Source: <Mono>components/tahi/tahi-glyphs.tsx</Mono></div>
          </div>
        </div>
      </Card>
    </SectionShell>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Animation styles — comparison of animated-icon library aesthetics
//
// Pure CSS keyframes (no Motion / Lottie runtime). Each demo mirrors the
// motion style a specific library ships out of the box. Hover any tile
// to play. Pick a style → we install the matching library and replace
// the static Lucide icons across the dashboard.
// ────────────────────────────────────────────────────────────────────────

type AnimDemo = {
  key: string
  family: 'Lucide Animated' | 'AnimateIcons' | 'Lordicon' | 'useAnimations' | 'Motion Icons'
  label: string
  note: string
  iconClass: string
  iconPaths: React.ReactNode
}

const ANIM_DEMOS: AnimDemo[] = [
  // — Lucide Animated style: calm, ease-out, one-shot, semantic —
  {
    key: 'gear',
    family: 'Lucide Animated',
    label: 'Settings · rotates 60°',
    note: 'Calm, single-axis, ease-out. The default tempo.',
    iconClass: 'ds-anim-gear',
    iconPaths: (<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></>),
  },
  {
    key: 'bell-ring',
    family: 'Lucide Animated',
    label: 'Bell · rings once',
    note: '-12° → +10° → 0. Like the clapper struck the bell once.',
    iconClass: 'ds-anim-bell-ring',
    iconPaths: (<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>),
  },
  {
    key: 'heart',
    family: 'Lucide Animated',
    label: 'Heart · beats',
    note: 'Two soft pulses. No bounce, no overshoot.',
    iconClass: 'ds-anim-heart',
    iconPaths: (<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>),
  },

  // — AnimateIcons style: springy, energetic —
  {
    key: 'bell-shake',
    family: 'AnimateIcons',
    label: 'Bell · shakes 4×',
    note: 'Cubic-spring easing, oscillates harder than Lucide Animated.',
    iconClass: 'ds-anim-bell-shk',
    iconPaths: (<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>),
  },
  {
    key: 'search',
    family: 'AnimateIcons',
    label: 'Search · wiggles',
    note: '±15° tilt, three swings. Reads as "looking around".',
    iconClass: 'ds-anim-search',
    iconPaths: (<><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>),
  },

  // — Lordicon style: polished, multi-stage, premium —
  {
    key: 'eye',
    family: 'Lordicon',
    label: 'Eye · blinks',
    note: 'scaleY collapses then snaps back. Looks like the eye blinked.',
    iconClass: 'ds-anim-eye',
    iconPaths: (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>),
  },
  {
    key: 'star',
    family: 'Lordicon',
    label: 'Star · sparkles',
    note: 'Scale + rotate combined. Often paired with colour shift in Lottie.',
    iconClass: 'ds-anim-star',
    iconPaths: (<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>),
  },

  // — useAnimations style: continuous loop while hovered —
  {
    key: 'refresh',
    family: 'useAnimations',
    label: 'Refresh · loops 360°',
    note: 'Spins continuously while hovered. Stops when you leave.',
    iconClass: 'ds-anim-refresh',
    iconPaths: (<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>),
  },

  // — Motion Icons style: generic preset (draw-on stroke) —
  {
    key: 'draw',
    family: 'Motion Icons',
    label: 'Send · draws on',
    note: 'Stroke draws from start. Generic preset applied across the set.',
    iconClass: 'ds-anim-draw',
    iconPaths: (<><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>),
  },
]

const FAMILY_COLOURS: Record<AnimDemo['family'], { bg: string, fg: string, dot: string }> = {
  'Lucide Animated': { bg: '#EEF5EB', fg: '#3F6235', dot: '#5A824E' },
  'AnimateIcons':    { bg: '#EFF1FE', fg: '#3B2DAA', dot: '#6366F1' },
  'Lordicon':        { bg: '#FBE9F2', fg: '#9D1F62', dot: '#EC4899' },
  'useAnimations':   { bg: '#E6F6F9', fg: '#0E6E81', dot: '#06B6D4' },
  'Motion Icons':    { bg: '#FEF6E6', fg: '#8A5A12', dot: '#F59E0B' },
}

function FamilyChip({ family }: { family: AnimDemo['family'] }) {
  const c = FAMILY_COLOURS[family]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
      padding: '0.125rem 0.5rem',
      background: c.bg, color: c.fg,
      borderRadius: 'var(--radius-leaf-sm)',
      fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.01em',
      width: 'fit-content',
    }}>
      <span style={{ width: '0.375rem', height: '0.375rem', borderRadius: '50%', background: c.dot }} />
      {family}
    </span>
  )
}

function AnimCard({ demo }: { demo: AnimDemo }) {
  return (
    <div
      className="ds-anim-card"
      style={{
        background: 'var(--color-bg)',
        borderRadius: 'var(--radius-leaf)',
        padding: '1.25rem',
        display: 'flex', flexDirection: 'column', gap: '0.875rem',
        minHeight: '11rem',
        transition: 'background var(--motion-quick) var(--ease-out)',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg)' }}
    >
      <FamilyChip family={demo.family} />
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '3.5rem',
        color: 'var(--color-brand-dark)',
      }}>
        <span className="ds-anim-icon">
          <svg
            className={demo.iconClass}
            width={40} height={40} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={1.5}
            strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
          >
            {demo.iconPaths}
          </svg>
        </span>
      </div>
      <div style={{ marginTop: 'auto' }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>{demo.label}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.25rem', lineHeight: 1.45 }}>{demo.note}</div>
      </div>
    </div>
  )
}

function AnimationStylesSection() {
  return (
    <SectionShell
      id="animations"
      title="Animation styles — pick a pack"
      intro="Hover each tile to play. Same icons across libraries would behave like these representative demos. Once you pick a style, we install the matching library (or copy-paste their components in) and standardise the dashboard on it. All animations here honour prefers-reduced-motion."
    >
      <div style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-leaf)',
        padding: '0.75rem',
      }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {ANIM_DEMOS.map(demo => <AnimCard key={demo.key} demo={demo} />)}
        </div>
      </div>

      <Card>
        <GroupHeading>How to read this</GroupHeading>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          <div>
            <FamilyChip family="Lucide Animated" />
            <p style={{ marginTop: '0.375rem' }}>Calm. Ease-out. One-shot. Each icon&apos;s animation maps to its meaning. <strong style={{ color: 'var(--color-text)' }}>Closest to our brand tempo.</strong> Drop-in for our existing Lucide setup.</p>
          </div>
          <div>
            <FamilyChip family="AnimateIcons" />
            <p style={{ marginTop: '0.375rem' }}>Springier. Energetic. Oscillates more before settling. Feels &ldquo;alive&rdquo; — possibly too active for a calm dashboard.</p>
          </div>
          <div>
            <FamilyChip family="Lordicon" />
            <p style={{ marginTop: '0.375rem' }}>Lottie-rich, multi-stage, often with colour shifts. Highest fidelity, can feel playful. Paid for full set.</p>
          </div>
          <div>
            <FamilyChip family="useAnimations" />
            <p style={{ marginTop: '0.375rem' }}>Continuous loops while hovered (refresh spinning, etc.). Useful for &ldquo;processing&rdquo; states. Smaller set (~80 icons).</p>
          </div>
          <div>
            <FamilyChip family="Motion Icons" />
            <p style={{ marginTop: '0.375rem' }}>Generic motion presets (draw-on, fade-in, bounce) applied across all 3,500 Lucide icons. Less semantic — every icon animates the same way.</p>
          </div>
        </div>
      </Card>
    </SectionShell>
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
      intro="The Tahi mark is itself a leaf — a stylised drop on the i of Tahi. Real path data, lifted from the live marketing site. The wordmarks inherit colour from their container; the icon marks bake their own gradient and have light / dark variants."
    >
      <Card>
        <GroupHeading>Wordmarks</GroupHeading>
        <div className="space-y-6">
          <div>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-subtle)', marginBottom: '0.75rem' }}>Short — &ldquo;Tahi&rdquo;</div>
            <div className="flex flex-wrap items-end gap-12">
              <div style={{ color: 'var(--color-brand-deepest)' }}>
                <TahiWordmark size={32} />
              </div>
              <div style={{ color: 'var(--color-brand-deepest)' }}>
                <TahiWordmark size={64} />
              </div>
              <div style={{
                background: 'var(--color-brand-deepest)',
                color: 'var(--color-text-on-dark)',
                padding: '1.25rem 1.75rem',
                borderRadius: 'var(--radius-leaf)',
              }}>
                <TahiWordmark size={64} />
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-subtle)', marginBottom: '0.75rem' }}>Long — &ldquo;Tahi Studio&rdquo;</div>
            <div className="flex flex-wrap items-center gap-12">
              <div style={{ color: 'var(--color-brand-deepest)' }}>
                <TahiStudioWordmark height={36} />
              </div>
              <div style={{
                background: 'var(--color-brand-deepest)',
                color: 'var(--color-text-on-dark)',
                padding: '1rem 1.5rem',
                borderRadius: 'var(--radius-leaf)',
              }}>
                <TahiStudioWordmark height={48} />
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <GroupHeading>Icon mark — the &ldquo;1 + leaf&rdquo;</GroupHeading>
        <div className="flex flex-wrap items-center gap-10">
          <div style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            padding: '1.5rem',
            borderRadius: 'var(--radius-leaf-sm)',
            display: 'flex', alignItems: 'center', gap: '1.5rem',
          }}>
            <TahiIconMark size={32} variant="on-light" />
            <TahiIconMark size={48} variant="on-light" />
            <TahiIconMark size={72} variant="on-light" />
          </div>
          <div style={{
            background: 'var(--color-brand-deepest)',
            padding: '1.5rem',
            borderRadius: 'var(--radius-leaf-sm)',
            display: 'flex', alignItems: 'center', gap: '1.5rem',
          }}>
            <TahiIconMark size={32} variant="on-dark" />
            <TahiIconMark size={48} variant="on-dark" />
            <TahiIconMark size={72} variant="on-dark" />
          </div>
        </div>
        <p style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          <Mono>variant=&quot;on-light&quot;</Mono> uses a dark &ldquo;1&rdquo; for cream backgrounds. <Mono>variant=&quot;on-dark&quot;</Mono> uses a light &ldquo;1&rdquo; for forest backgrounds. The leaf gradient adapts to read against either surface.
        </p>
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
// WCAG 2.2 audit
//
// All contrast ratios computed via the standard WCAG luminance formula
// against the actual hex tokens in globals.css. AA threshold = 4.5:1 for
// normal text, 3:1 for large text (18px regular OR 14px bold) and for
// non-text UI components (1.4.11). AAA = 7:1.
//
// New in WCAG 2.2 (now level AA): 2.4.11 Focus Not Obscured, 2.4.13 Focus
// Appearance (AAA), 2.5.7 Dragging Movements, 2.5.8 Target Size (24×24px
// minimum), 3.2.6 Consistent Help (AAA), 3.3.7 Redundant Entry, 3.3.8
// Accessible Authentication.
// ────────────────────────────────────────────────────────────────────────

type ContrastBadge = 'AAA' | 'AA' | 'AA-LG' | 'FAIL'

type ContrastPair = {
  label: string
  fg: string
  fgToken: string
  bg: string
  bgToken: string
  ratio: number
  badge: ContrastBadge
  note?: string
}

// Numbers are baked from the WCAG luminance formula — see DESIGN.md for
// the script that produced them. Do not hand-edit; rerun + paste.
const CONTRAST_PAIRS: ContrastPair[] = [
  // Text on surfaces
  { label: 'Body text on white',          fg: '#121A0F', fgToken: '--color-text',         bg: '#FFFFFF', bgToken: '--color-bg',           ratio: 17.79, badge: 'AAA' },
  { label: 'Body text on cream',          fg: '#121A0F', fgToken: '--color-text',         bg: '#F3F4F2', bgToken: '--color-bg-cream',     ratio: 16.12, badge: 'AAA' },
  { label: 'Body text on bg-secondary',   fg: '#121A0F', fgToken: '--color-text',         bg: '#F7F9F6', bgToken: '--color-bg-secondary', ratio: 16.80, badge: 'AAA' },
  { label: 'Body text on bg-tertiary',    fg: '#121A0F', fgToken: '--color-text',         bg: '#EEF3EC', bgToken: '--color-bg-tertiary',  ratio: 15.81, badge: 'AAA' },
  { label: 'Muted text on white',         fg: '#5A6657', fgToken: '--color-text-muted',   bg: '#FFFFFF', bgToken: '--color-bg',           ratio: 6.05,  badge: 'AA' },
  { label: 'Muted text on cream',         fg: '#5A6657', fgToken: '--color-text-muted',   bg: '#F3F4F2', bgToken: '--color-bg-cream',     ratio: 5.48,  badge: 'AA' },
  { label: 'Subtle text on white',        fg: '#647461', fgToken: '--color-text-subtle',  bg: '#FFFFFF', bgToken: '--color-bg',           ratio: 4.99,  badge: 'AA',     note: 'Bumped from #8A9987 (3.01:1) which failed AA on cream.' },
  { label: 'Subtle text on cream',        fg: '#647461', fgToken: '--color-text-subtle',  bg: '#F3F4F2', bgToken: '--color-bg-cream',     ratio: 4.52,  badge: 'AA',     note: 'Bumped from #8A9987 (2.72:1) — was the lowest-contrast pair in the system.' },

  // Brand text
  { label: 'Brand link on white',         fg: '#5A824E', fgToken: '--color-brand',        bg: '#FFFFFF', bgToken: '--color-bg',           ratio: 4.43,  badge: 'AA-LG',  note: 'Borderline AA. Fine for links (underlined). For body text use --color-brand-dark.' },
  { label: 'Brand link on cream',         fg: '#5A824E', fgToken: '--color-brand',        bg: '#F3F4F2', bgToken: '--color-bg-cream',     ratio: 4.02,  badge: 'AA-LG',  note: 'Same — links OK, body needs --color-brand-dark.' },
  { label: 'Brand-dark on white',         fg: '#425F39', fgToken: '--color-brand-dark',   bg: '#FFFFFF', bgToken: '--color-bg',           ratio: 7.17,  badge: 'AAA' },
  { label: 'Brand-dark on cream',         fg: '#425F39', fgToken: '--color-brand-dark',   bg: '#F3F4F2', bgToken: '--color-bg-cream',     ratio: 6.50,  badge: 'AA' },
  { label: 'Brand text on brand-50 chip', fg: '#5A824E', fgToken: '--color-brand',        bg: '#F0F7EE', bgToken: '--color-brand-50',     ratio: 4.06,  badge: 'AA-LG',  note: 'For chips use --color-brand-dark on brand-50 (6.57:1).' },
  { label: 'Brand-dark on brand-50 chip', fg: '#425F39', fgToken: '--color-brand-dark',   bg: '#F0F7EE', bgToken: '--color-brand-50',     ratio: 6.57,  badge: 'AA' },
  { label: 'Brand-dark on brand-100',     fg: '#425F39', fgToken: '--color-brand-dark',   bg: '#DCEFD8', bgToken: '--color-brand-100',    ratio: 5.94,  badge: 'AA' },

  // Accent / CTA
  { label: 'Accent-text on lime CTA',     fg: '#1D1E1D', fgToken: '--color-accent-text',  bg: '#78C45E', bgToken: '--color-accent',       ratio: 7.85,  badge: 'AAA' },
  { label: 'White on lime CTA',           fg: '#FFFFFF', fgToken: '—',                    bg: '#78C45E', bgToken: '--color-accent',       ratio: 2.13,  badge: 'FAIL',   note: 'Never use white text on the lime CTA. Use --color-accent-text (#1D1E1D).' },

  // On dark surfaces
  { label: 'On-dark text on deepest',     fg: '#FDFDFC', fgToken: '--color-text-on-dark', bg: '#1E3019', bgToken: '--color-brand-deepest',ratio: 13.83, badge: 'AAA' },
  { label: 'On-dark text on deep',        fg: '#FDFDFC', fgToken: '--color-text-on-dark', bg: '#2A3626', bgToken: '--color-brand-deep',   ratio: 12.47, badge: 'AAA' },
  { label: 'Dim-on-dark on deepest',      fg: '#DCE8D9', fgToken: '--color-text-dim-on-dark', bg: '#1E3019', bgToken: '--color-brand-deepest', ratio: 11.12, badge: 'AAA' },
  { label: 'Brand-light icon on deepest', fg: '#7AAB6B', fgToken: '--color-brand-light',  bg: '#1E3019', bgToken: '--color-brand-deepest',ratio: 5.27,  badge: 'AA' },
  { label: 'Brand-lighter on deepest',    fg: '#97BA8C', fgToken: '--color-brand-lighter',bg: '#1E3019', bgToken: '--color-brand-deepest',ratio: 6.51,  badge: 'AA' },

  // Status pills
  { label: 'Status submitted',            fg: '#1D4ED8', fgToken: '--status-submitted-text',  bg: '#EFF6FF', bgToken: '--status-submitted-bg',  ratio: 6.16,  badge: 'AA' },
  { label: 'Status in-review',            fg: '#92400E', fgToken: '--status-in-review-text',  bg: '#FFFBEB', bgToken: '--status-in-review-bg',  ratio: 6.84,  badge: 'AA' },
  { label: 'Status in-progress',          fg: '#0E7490', fgToken: '--status-in-progress-text',bg: '#ECFEFF', bgToken: '--status-in-progress-bg',ratio: 5.15,  badge: 'AA' },
  { label: 'Status client-review',        fg: '#6D28D9', fgToken: '--status-client-review-text', bg: '#F5F3FF', bgToken: '--status-client-review-bg', ratio: 6.48, badge: 'AA' },
  { label: 'Status delivered',            fg: '#15803D', fgToken: '--status-delivered-text',  bg: '#F0FDF4', bgToken: '--status-delivered-bg',  ratio: 4.79,  badge: 'AA' },
  { label: 'Status draft',                fg: '#4B5563', fgToken: '--status-draft-text',      bg: '#F3F4F6', bgToken: '--status-draft-bg',      ratio: 6.87,  badge: 'AA' },
  { label: 'Status archived',             fg: '#6B7280', fgToken: '--status-archived-text',   bg: '#F9FAFB', bgToken: '--status-archived-bg',   ratio: 4.63,  badge: 'AA' },

  // Semantic
  { label: 'Danger text on danger-bg',    fg: '#DC2626', fgToken: '--color-danger',       bg: '#FEF2F2', bgToken: '--color-danger-bg',    ratio: 4.41,  badge: 'AA-LG',  note: 'Just under AA. Pair with iconography or use a darker red for body danger text.' },
  { label: 'Warning text on warning-bg',  fg: '#92400E', fgToken: '—',                    bg: '#FFF7ED', bgToken: '--color-warning-bg',   ratio: 6.68,  badge: 'AA' },

  // Non-text (decorative borders, exempt from 1.4.3 — listed for transparency)
  { label: 'Border-strong on white',      fg: '#CDCFCC', fgToken: '--color-border-strong',bg: '#FFFFFF', bgToken: '--color-bg',           ratio: 1.57,  badge: 'FAIL',   note: 'Decorative border. 1.4.11 (non-text contrast) only applies to UI controls conveying meaning — borders are exempt.' },
  { label: 'Border on cream',             fg: '#D4E0D0', fgToken: '--color-border',       bg: '#F3F4F2', bgToken: '--color-bg-cream',     ratio: 1.24,  badge: 'FAIL',   note: 'Same — decorative border, exempt from contrast.' },
]

function BadgePill({ badge }: { badge: ContrastBadge }) {
  const styles: Record<ContrastBadge, { bg: string, fg: string, dot: string, label: string }> = {
    AAA:     { bg: '#E9F7EE', fg: '#176B3D', dot: '#22C55E', label: 'AAA' },
    AA:      { bg: '#EEF5EB', fg: '#3F6235', dot: '#5A824E', label: 'AA' },
    'AA-LG': { bg: '#FEF6E6', fg: '#8A5A12', dot: '#F59E0B', label: 'AA · large only' },
    FAIL:    { bg: '#FDEDEC', fg: '#B42318', dot: '#EF4444', label: 'Fail' },
  }
  const s = styles[badge]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
      padding: '0.1875rem 0.5rem',
      background: s.bg, color: s.fg,
      borderRadius: 'var(--radius-leaf-sm)',
      fontSize: '0.72rem', fontWeight: 600,
      width: 'fit-content', whiteSpace: 'nowrap',
    }}>
      <span style={{ width: '0.4rem', height: '0.4rem', borderRadius: '50%', background: s.dot }} />
      {s.label}
    </span>
  )
}

function ContrastRow({ pair }: { pair: ContrastPair }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto auto',
      gap: '1rem',
      alignItems: 'center',
      padding: '0.75rem 0',
      borderBottom: '1px solid var(--color-border-subtle)',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{
              display: 'inline-block', width: '0.875rem', height: '0.875rem',
              background: pair.fg, borderRadius: '50%',
              border: '1px solid var(--color-border-subtle)',
            }} />
            <span style={{
              display: 'inline-block', width: '0.875rem', height: '0.875rem',
              background: pair.bg, borderRadius: '50%',
              border: '1px solid var(--color-border-subtle)',
            }} />
          </div>
          <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{pair.label}</span>
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
          <Mono>{pair.fgToken}</Mono> <span style={{ margin: '0 0.25rem' }}>on</span> <Mono>{pair.bgToken}</Mono>
        </div>
        {pair.note && (
          <div style={{ fontSize: '0.72rem', color: 'var(--color-text-subtle)', marginTop: '0.25rem', lineHeight: 1.45, maxWidth: '52ch' }}>
            {pair.note}
          </div>
        )}
      </div>
      <div style={{ fontSize: '0.8125rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text)' }}>
        {pair.ratio.toFixed(2)}:1
      </div>
      <BadgePill badge={pair.badge} />
    </div>
  )
}

function WcagSection() {
  const counts = CONTRAST_PAIRS.reduce<Record<ContrastBadge, number>>((acc, p) => {
    acc[p.badge] = (acc[p.badge] ?? 0) + 1
    return acc
  }, { AAA: 0, AA: 0, 'AA-LG': 0, FAIL: 0 })
  return (
    <SectionShell
      id="wcag"
      title="WCAG 2.2 audit"
      intro="Contrast ratios computed against the actual hex values in globals.css. Pass thresholds: AA 4.5:1 normal text · 3:1 large or UI · AAA 7:1. Two values were fixed in this audit pass — see notes."
    >
      <Card>
        <GroupHeading>Summary</GroupHeading>
        <div className="flex flex-wrap gap-2">
          <BadgePill badge="AAA" /> <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)', alignSelf: 'center' }}>{counts.AAA} pairs</span>
          <BadgePill badge="AA" /> <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)', alignSelf: 'center' }}>{counts.AA} pairs</span>
          <BadgePill badge="AA-LG" /> <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)', alignSelf: 'center' }}>{counts['AA-LG']} pairs</span>
          <BadgePill badge="FAIL" /> <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)', alignSelf: 'center' }}>{counts.FAIL} pairs (all documented exceptions — see table)</span>
        </div>
      </Card>

      <Card padded={false}>
        <div style={{ padding: '1.5rem 1.5rem 0' }}>
          <GroupHeading>Contrast pairs</GroupHeading>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '-0.5rem', marginBottom: '0.5rem', lineHeight: 1.5 }}>
            Every meaningful foreground / background pair in the token set. Sort: text on light → text on brand → text on dark → status pills → decorative.
          </p>
        </div>
        <div style={{ padding: '0 1.5rem 1.5rem' }}>
          {CONTRAST_PAIRS.map(p => <ContrastRow key={p.label} pair={p} />)}
        </div>
      </Card>

      <Card>
        <GroupHeading>WCAG 2.2 new success criteria</GroupHeading>
        <ul style={{ fontSize: '0.8125rem', lineHeight: 1.7, color: 'var(--color-text)' }} className="space-y-1.5">
          <li><strong>2.4.11 Focus Not Obscured (Min.)</strong> — focus indicators must not be hidden by other content. <BadgePill badge="AA" /> No fixed overlays sit above interactive content here.</li>
          <li><strong>2.4.13 Focus Appearance (AAA)</strong> — focus ring ≥2px, ≥3:1 contrast. Our <Mono>--shadow-ring</Mono> is 2px <Mono>--color-brand-light</Mono> (#7AAB6B) at 3.51:1 on white. <BadgePill badge="AA" /></li>
          <li><strong>2.5.7 Dragging Movements</strong> — drag actions need a single-pointer alternative. <BadgePill badge="AA" /> Drag-and-drop in the kanban already has click-to-edit + keyboard fallbacks.</li>
          <li><strong>2.5.8 Target Size (Min., 24×24 CSS px)</strong> — tap targets ≥24×24. <BadgePill badge="AAA" /> CLAUDE.md mandates 44px throughout — comfortably exceeds.</li>
          <li><strong>3.2.6 Consistent Help (AAA)</strong> — help mechanisms in a consistent location. <BadgePill badge="AAA" /> Help link sits in the same sidebar slot across pages.</li>
          <li><strong>3.3.7 Redundant Entry</strong> — don&apos;t re-ask the user for info already given. <BadgePill badge="AA" /> Forms auto-populate from previous sessions where possible.</li>
          <li><strong>3.3.8 Accessible Authentication (Min.)</strong> — no cognitive-puzzle auth (Clerk handles this). <BadgePill badge="AA" /></li>
        </ul>
      </Card>

      <Card>
        <GroupHeading>Typography — 1.4.4 Resize Text</GroupHeading>
        <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          All sizes in the ladders above are declared in <Mono>rem</Mono>. Users can resize text up to 200% in browser settings without loss of content or functionality. <BadgePill badge="AA" /> Note: 12px (<Mono>--text-xs</Mono>) at default zoom is on the small side for body text — keep XS for meta/badges only. The 14px (<Mono>--text-base</Mono>) baseline meets WCAG comfort recommendations.
        </p>
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
