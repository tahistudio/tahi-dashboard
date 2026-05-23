'use client'

import * as React from 'react'
import { useState } from 'react'
import { LeafGlyph, LeafIcon, TahiWordmark, TahiStudioWordmark, TahiIconMark } from '@/components/tahi/tahi-glyphs'
import {
  AnimatedSettings,
  AnimatedBell,
  AnimatedHeart,
  AnimatedRefresh,
  AnimatedSearch,
  AnimatedEye,
  AnimatedSparkles,
  AnimatedCheckCircle,
  AnimatedTrash,
} from '@/components/tahi/animated-icons'
import { TahiButton, TahiLink } from '@/components/tahi/tahi-button'
import { Avatar } from '@/components/tahi/avatar'
import { Badge } from '@/components/tahi/badge'
import { Card as CardPrim } from '@/components/tahi/card'
import { Tooltip } from '@/components/tahi/tooltip'
import { FeatureCard } from '@/components/tahi/feature-card'
import { KPICard } from '@/components/tahi/kpi-card'
import { Menu } from '@/components/tahi/menu'
import { useToast } from '@/components/tahi/toast'
import { BarChart, LineChart, Sparkline, Gauge, DonutChart, GanttChart } from '@/components/tahi/chart'
import { DataTable } from '@/components/tahi/data-table'
import { statusTone } from '@/components/tahi/badge'
import { Trash2, ExternalLink, Copy } from 'lucide-react'

/**
 * /design-system. The canonical token + primitive reference.
 *
 * Hidden route (no sidebar link). Admin only. Built from the Tahi Studio
 * design-system handoff bundle. When a primitive disagrees with a page,
 * the page is wrong. Check this surface and fix the page.
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
            borderRadius: 'var(--radius-md)',
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
      borderRadius: 'var(--radius-lg)',
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

// Palette pulled from the Tahi design pack with two refinements:
//   Client review shifted to fuchsia so it sits in a different hue family
//   from the cool blue / teal cluster (CIE-Lab distance from submitted
//   jumps from 17 to 84).
//   Archived shifted to warm taupe to pull further from cool draft gray.
const STATUS_SWATCHES: Array<{ key: string, bg: string, text: string, label: string }> = [
  { key: 'draft',          bg: '#F2F4F2', text: '#525A52', label: 'Draft' },
  { key: 'submitted',      bg: '#EBF1FE', text: '#1F4FBA', label: 'Submitted' },
  { key: 'in-review',      bg: '#FEF6E6', text: '#8A5A12', label: 'In review' },
  { key: 'in-progress',    bg: '#E6F6F9', text: '#0E6E81', label: 'In progress' },
  { key: 'client-review',  bg: '#FDF4FF', text: '#A21CAF', label: 'Client review' },
  { key: 'delivered',      bg: '#E9F7EE', text: '#176B3D', label: 'Delivered' },
  { key: 'archived',       bg: '#F5F0E8', text: '#7C6C5F', label: 'Archived' },
]

function SwatchTile({ s }: { s: Swatch }) {
  return (
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
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
          <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '-0.5rem', marginBottom: '0.875rem', lineHeight: 1.5 }}>
            Each chip leads with the brand leaf glyph tinted to the chip&apos;s text colour. Submitted is indigo (was blue) so it reads distinct from in-progress (teal).
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {STATUS_SWATCHES.map(s => (
              <div key={s.key} style={{
                background: s.bg, color: s.text,
                padding: '0.25rem 0.5625rem',
                borderRadius: 'var(--radius-sm)',
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                fontSize: '0.75rem', fontWeight: 500,
                width: 'fit-content',
              }}>
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
      intro="Manrope across the entire system at 300 to 800. Two ladders: marketing display (hero, section headlines, big numbers) and dashboard UI (dense, 12 to 24px). 500 is the default body weight. Heavier than most systems, which is what gives Manrope its quiet confidence."
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
            <TypeSpec label="Base"  size="--text-base" weight={500} tracking="0" sample="Default body. Every dense list, every form." />
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
      title="Radii. The leaf shape"
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
                borderRadius: 'var(--radius-md)',
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
  { token: '--motion-base',   ms: '420ms',  use: 'Default hover. The studio tempo' },
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
      intro="Calm. Slower than most systems. Ease-out only. Never bounce. The cubic 0.22, 1, 0.36, 1 reads as premium. All animations honour prefers-reduced-motion."
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
                  borderRadius: 'var(--radius-md)',
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
// Two clearly separated subsections:
//   1. Static Lucide icons. The default everywhere. Just hover-tint, no
//      motion. 1.5px stroke. Imported from `lucide-react` in production.
//   2. Animated icons. Used selectively. Motion-powered. Imported from
//      `components/tahi/animated-icons.tsx`. Each one has a picked home
//      where motion carries meaning. Static Lucide everywhere else.
// ────────────────────────────────────────────────────────────────────────

type IconDef = { name: string, use: string, paths: React.ReactNode }

// All paths verified against Lucide v0.359+ (24×24 grid, 1.5px stroke
// applied by the wrapper). The previous home path closed incorrectly at
// h-4v-7. Fixed to H5 so the silhouette renders as a proper house.
const ICONS: IconDef[] = [
  // Brand & narrative
  { name: 'leaf',            use: 'Growth, brand',  paths: (<><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96a1 1 0 0 1 1.8.56c0 5.62-1.34 10.83-5 14.6A7 7 0 0 1 11 20Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/></>) },
  { name: 'sprout',          use: 'Launch, stage 1',  paths: (<><path d="M7 20h10"/><path d="M10 20c5.5-2.5.8-6.4 3-10"/><path d="M9.5 9.4c1.1.8 1.8 2 2 3.3-1.3.4-2.7.2-3.8-.5-1.1-.8-1.8-2-2-3.3 1.3-.5 2.7-.2 3.8.5z"/><path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.7-1 5-2.4.6-.8 1-1.7 1-2.6-1.4-.1-2.8.4-3.9 1z"/></>) },
  { name: 'tree-pine',       use: 'Carbon negative',  paths: (<><path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z"/><path d="M12 22v-3"/></>) },
  { name: 'heart-handshake', use: 'Partnership', paths: (<><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M12 5 9.04 7.96a2.17 2.17 0 0 0 0 3.08v0c.82.82 2.13.85 3 .07l2.07-1.9a2.82 2.82 0 0 1 3.79 0l2.96 2.66"/><path d="m18 15-2-2"/><path d="m15 18-2-2"/></>) },
  { name: 'sparkles',        use: 'AI features', paths: (<><path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></>) },

  // Wayfinding
  { name: 'home',            use: 'Overview',  paths: (<><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>) },
  { name: 'inbox',           use: 'Requests',  paths: (<><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>) },
  { name: 'kanban',          use: 'Board view',  paths: (<><path d="M6 5v11"/><path d="M12 5v6"/><path d="M18 5v14"/></>) },
  { name: 'layout-grid',     use: 'Grid view',  paths: (<><rect width="7" height="7" x="3" y="3" rx="1"/><rect width="7" height="7" x="14" y="3" rx="1"/><rect width="7" height="7" x="14" y="14" rx="1"/><rect width="7" height="7" x="3" y="14" rx="1"/></>) },
  { name: 'list',            use: 'List view',  paths: (<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>) },
  { name: 'folder',          use: 'Files, group',  paths: (<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>) },
  { name: 'file-text',       use: 'Docs, contracts',  paths: (<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>) },
  { name: 'receipt',         use: 'Invoices',  paths: (<><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/></>) },
  { name: 'bar-chart',       use: 'Reports',  paths: (<><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></>) },
  { name: 'settings',        use: 'Settings',  paths: (<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></>) },

  // Search / actions
  { name: 'search',          use: 'Top-nav search', paths: (<><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>) },
  { name: 'command',         use: 'Cmd+K palette',  paths: (<path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z"/>) },
  { name: 'plus',            use: 'Create new',  paths: (<><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>) },
  { name: 'x',               use: 'Close, dismiss',  paths: (<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>) },
  { name: 'edit',            use: 'Edit, rename',  paths: (<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></>) },
  { name: 'trash',           use: 'Delete',  paths: (<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>) },
  { name: 'copy',            use: 'Duplicate',  paths: (<><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></>) },
  { name: 'download',        use: 'Download file', paths: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>) },
  { name: 'upload',          use: 'Upload file',   paths: (<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>) },
  { name: 'share',           use: 'Share link',  paths: (<><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></>) },
  { name: 'link',            use: 'Internal link',  paths: (<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>) },
  { name: 'external-link',   use: 'Open in new tab', paths: (<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>) },
  { name: 'refresh-cw',      use: 'Reload, sync',  paths: (<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>) },
  { name: 'more-horizontal', use: 'Row actions',  paths: (<><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>) },

  // Arrows
  { name: 'arrow-up-right',  use: 'Outbound, CTA', paths: (<><path d="M7 7h10v10"/><path d="M7 17 17 7"/></>) },
  { name: 'arrow-right',     use: 'Continue, next',    paths: (<><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>) },
  { name: 'arrow-left',      use: 'Back',     paths: (<><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></>) },
  { name: 'arrow-up',        use: 'Increase, up',       paths: (<><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></>) },
  { name: 'arrow-down',      use: 'Decrease, down',     paths: (<><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></>) },
  { name: 'chevron-right',   use: 'Expand, next page',    paths: (<polyline points="9 18 15 12 9 6"/>) },
  { name: 'chevron-left',    use: 'Collapse, prev',     paths: (<polyline points="15 18 9 12 15 6"/>) },
  { name: 'chevron-down',    use: 'Dropdown',     paths: (<polyline points="6 9 12 15 18 9"/>) },
  { name: 'chevron-up',      use: 'Collapse',       paths: (<polyline points="18 15 12 9 6 15"/>) },

  // Status / feedback
  { name: 'check-circle',    use: 'Delivered, done', paths: (<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>) },
  { name: 'check',           use: 'Inline confirm', paths: (<polyline points="20 6 9 17 4 12"/>) },
  { name: 'alert-triangle',  use: 'Warning, error', paths: (<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>) },
  { name: 'alert-circle',    use: 'Heads up', paths: (<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>) },
  { name: 'info',            use: 'Informational', paths: (<><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>) },
  { name: 'zap',             use: 'Fast, launch', paths: (<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>) },
  { name: 'flame',           use: 'Hot, urgent', paths: (<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>) },

  // Money & data
  { name: 'dollar-sign',     use: 'Money, billable',  paths: (<><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>) },
  { name: 'percent',         use: 'Discount, rate',  paths: (<><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></>) },
  { name: 'trending-up',     use: 'KPI delta+', paths: (<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></>) },
  { name: 'trending-down',   use: 'KPI delta-', paths: (<><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></>) },
  { name: 'pie-chart',       use: 'Breakdown',  paths: (<><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></>) },
  { name: 'activity',        use: 'Live status', paths: (<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>) },

  // People & comms
  { name: 'users',           use: 'Team, clients',  paths: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>) },
  { name: 'user',            use: 'Single person',  paths: (<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>) },
  { name: 'user-plus',       use: 'Add member',  paths: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></>) },
  { name: 'message-circle',  use: 'Comments',  paths: (<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>) },
  { name: 'mail',            use: 'Email',  paths: (<><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></>) },
  { name: 'phone',           use: 'Phone, call',  paths: (<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>) },
  { name: 'video',           use: 'Video call',  paths: (<><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></>) },
  { name: 'bell',            use: 'Notifications',  paths: (<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>) },

  // Time
  { name: 'clock',           use: 'Time tracker',  paths: (<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>) },
  { name: 'calendar',        use: 'Date, due',  paths: (<><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>) },
  { name: 'timer',           use: 'Live timer', paths: (<><line x1="10" y1="2" x2="14" y2="2"/><line x1="12" y1="14" x2="15" y2="11"/><circle cx="12" cy="14" r="8"/></>) },

  // View options
  { name: 'eye',             use: 'Visible, preview', paths: (<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>) },
  { name: 'eye-off',         use: 'Hidden, private', paths: (<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>) },
  { name: 'filter',          use: 'Filter table',  paths: (<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>) },
  { name: 'sliders',         use: 'Adjust',  paths: (<><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>) },
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

// Single tile used for both static and animated icon grids. Just a
// hover-tint on the surface and a colour shift on the glyph. No motion.
function IconTile({ icon, glyph }: { icon: IconDef, glyph?: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
      role="figure"
      aria-label={icon.name + ' · ' + icon.use}
      style={{
        borderRadius: 'var(--radius-md)',
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
        transition: 'color var(--motion-quick) var(--ease-out)',
      }}>
        {glyph ?? <LucideIcon>{icon.paths}</LucideIcon>}
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

// Animated icon entries. Each pairs a Lucide name with its animated
// component and a picked production home (where motion will ship).
type AnimatedRow = { name: string, use: string, Component: React.ComponentType<{ size?: number }> }
const ANIMATED_ROWS: AnimatedRow[] = [
  { name: 'settings',     use: 'Settings nav, options',  Component: AnimatedSettings },
  { name: 'bell',         use: 'Notification badge',     Component: AnimatedBell },
  { name: 'refresh-cw',   use: 'Sync, reload buttons',   Component: AnimatedRefresh },
  { name: 'sparkles',     use: 'AI moments',             Component: AnimatedSparkles },
  { name: 'check-circle', use: 'Save success',           Component: AnimatedCheckCircle },
  { name: 'search',       use: 'Top-nav search focus',   Component: AnimatedSearch },
  { name: 'eye',          use: 'Show / preview',         Component: AnimatedEye },
  { name: 'trash',        use: 'Delete-confirm hover',   Component: AnimatedTrash },
  { name: 'heart',        use: 'Favourite, like',        Component: AnimatedHeart },
]

function IconographySection() {
  return (
    <SectionShell
      id="iconography"
      title="Iconography"
      intro="Two libraries, used deliberately. Static Lucide is the default everywhere. Animated icons (Motion-powered) are reserved for a small picked subset where motion carries meaning."
    >
      <Card padded={false}>
        <div style={{ padding: '1.5rem 1.5rem 0.5rem' }}>
          <GroupHeading>Static (Lucide, {ICONS.length} icons)</GroupHeading>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem', lineHeight: 1.5 }}>
            1.5px stroke, no hover motion. The default for every nav item, button icon, table header, status row. Import from <Mono>lucide-react</Mono>.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1 px-3 pb-3">
          {ICONS.map(icon => <IconTile key={icon.name} icon={icon} />)}
        </div>
      </Card>

      <Card padded={false}>
        <div style={{ padding: '1.5rem 1.5rem 0.5rem' }}>
          <GroupHeading>Animated ({ANIMATED_ROWS.length} icons)</GroupHeading>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem', lineHeight: 1.5 }}>
            Hover any tile to play. Animation runs to completion regardless of cursor position. Each entry lists its picked production home. Import from <Mono>components/tahi/animated-icons.tsx</Mono>.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1 px-3 pb-3">
          {ANIMATED_ROWS.map(row => (
            <IconTile
              key={row.name}
              icon={{ name: row.name, use: row.use, paths: null }}
              glyph={<row.Component size={20} />}
            />
          ))}
        </div>
      </Card>

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
            <div>Separate from Lucide. Renders with the brand gradient built in.</div>
            <div>Used as the chip dot, tagline-leader, and the <em>i</em>-dot on the wordmarks.</div>
            <div>Never substituted with an emoji. Never inverted. Source: <Mono>components/tahi/tahi-glyphs.tsx</Mono></div>
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
      intro="The Tahi mark is itself a leaf. A stylised drop on the i of Tahi. Real path data, lifted from the live marketing site. The wordmarks inherit colour from their container; the icon marks bake their own gradient and have light / dark variants."
    >
      <Card>
        <GroupHeading>Wordmarks</GroupHeading>
        <div className="space-y-6">
          <div>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-subtle)', marginBottom: '0.75rem' }}>Short. &ldquo;Tahi&rdquo;</div>
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
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-subtle)', marginBottom: '0.75rem' }}>Long. &ldquo;Tahi Studio&rdquo;</div>
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
        <GroupHeading>Icon mark. The &ldquo;1 + leaf&rdquo;</GroupHeading>
        <div className="flex flex-wrap items-center gap-10">
          <div style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            padding: '1.5rem',
            borderRadius: 'var(--radius-lg)',
            display: 'flex', alignItems: 'center', gap: '1.5rem',
          }}>
            <TahiIconMark size={32} variant="on-light" />
            <TahiIconMark size={48} variant="on-light" />
            <TahiIconMark size={72} variant="on-light" />
          </div>
          <div style={{
            background: 'var(--color-brand-deepest)',
            padding: '1.5rem',
            borderRadius: 'var(--radius-lg)',
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
              <li>Honest. &ldquo;If your brief has a problem, we say so.&rdquo;</li>
              <li>Concrete. &ldquo;From $2,500. One-off. Scoped individually.&rdquo;</li>
              <li>Plant-rooted. Grow, track, tune, sprout</li>
              <li>Reassuring. &ldquo;No long queues, no half-finished tasks.&rdquo;</li>
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
// Components. Batch 1 (Button · Avatar · Badge · Card)
//
// Each primitive's source lives in components/tahi/. The blocks below
// render every state we expect to see in production. A second-level
// sub-nav sits at the top so reviewers can jump between primitives
// without scrolling through the rest of the design system every time.
//
// Sub-nav lives inline here for batch 1; it gets extracted to
// components/tahi/section-nav.tsx in batch 2.
// ────────────────────────────────────────────────────────────────────────

const COMPONENTS_NAV = [
  { id: 'comp-button',       label: 'Button',       ready: true },
  { id: 'comp-avatar',       label: 'Avatar',       ready: true },
  { id: 'comp-badge',        label: 'Badge',        ready: true },
  { id: 'comp-card',         label: 'Card',         ready: true },
  { id: 'comp-feature-card', label: 'Feature card', ready: true },
  { id: 'comp-kpi-card',     label: 'KPI card',     ready: true },
  { id: 'comp-tooltip',      label: 'Tooltip',      ready: true },
  { id: 'comp-menu',         label: 'Menu',         ready: true },
  { id: 'comp-toast',        label: 'Toast',        ready: true },
  { id: 'comp-chart',        label: 'Charts',       ready: true  },
  { id: 'comp-table',        label: 'Data table',   ready: true  },
  { id: 'comp-chip',         label: 'Chip',         ready: false },
  { id: 'comp-empty',        label: 'Empty state',  ready: false },
  { id: 'comp-callout',      label: 'Callout',      ready: false },
  { id: 'comp-pagination',   label: 'Pagination',   ready: false },
  { id: 'comp-stepper',      label: 'Stepper',      ready: false },
  { id: 'comp-progress',     label: 'Progress',     ready: false },
]

function ComponentsSubNav() {
  return (
    <nav
      aria-label="Components"
      style={{
        position: 'sticky',
        top: '3.5rem',
        zIndex: 9,
        background: 'var(--color-bg-cream)',
        paddingTop: '0.5rem',
        paddingBottom: '0.5rem',
        marginBottom: '0.5rem',
      }}
    >
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.375rem',
        padding: '0.375rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 'var(--radius-md)',
      }}>
        {COMPONENTS_NAV.map(item => (
          <a
            key={item.id}
            href={item.ready ? `#${item.id}` : undefined}
            aria-disabled={!item.ready || undefined}
            style={{
              padding: '0.3rem 0.7rem',
              fontSize: 'var(--text-xs)',
              fontWeight: 500,
              borderRadius: 'var(--radius-sm)',
              color: item.ready ? 'var(--color-text-muted)' : 'var(--color-text-subtle)',
              background: 'transparent',
              opacity: item.ready ? 1 : 0.5,
              pointerEvents: item.ready ? 'auto' : 'none',
              cursor: item.ready ? 'pointer' : 'default',
              transition: 'background var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
            }}
            onMouseEnter={e => {
              if (!item.ready) return
              e.currentTarget.style.background = 'var(--color-brand-50)'
              e.currentTarget.style.color = 'var(--color-brand-dark)'
            }}
            onMouseLeave={e => {
              if (!item.ready) return
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--color-text-muted)'
            }}
          >
            {item.label}
            {!item.ready && (
              <span style={{
                fontSize: '0.6rem',
                padding: '0.0625rem 0.3125rem',
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-subtle)',
                borderRadius: 'var(--radius-leaf-sm)',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}>
                Next
              </span>
            )}
          </a>
        ))}
      </div>
    </nav>
  )
}

function PrimitiveShell({
  id,
  title,
  source,
  intro,
  children,
}: {
  id: string
  title: string
  source: string
  intro: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-32 space-y-4">
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
      }}>
        <div>
          <h3 style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 600,
            letterSpacing: 'var(--tracking-tight)',
          }}>{title}</h3>
          <p style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-muted)',
            marginTop: '0.25rem',
            lineHeight: 1.5,
            maxWidth: '52ch',
          }}>{intro}</p>
        </div>
        <Mono>{source}</Mono>
      </div>
      {children}
    </section>
  )
}

function StateRow({ label, children }: { label: string, children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '8rem 1fr',
      gap: '1rem',
      padding: '1rem 0',
      borderBottom: '1px solid var(--color-border-subtle)',
      alignItems: 'center',
    }}>
      <div style={{
        fontSize: '0.72rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        color: 'var(--color-text-subtle)',
      }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
        {children}
      </div>
    </div>
  )
}

function ButtonShowcase() {
  return (
    <PrimitiveShell
      id="comp-button"
      title="Button"
      source="components/tahi/tahi-button.tsx"
      intro="Primary uses the lime CTA + leaf radius. Trailing icon is the brand default; pass `iconLeft` only when you need the icon before the label. Hover lifts 1px with a soft brand glow; never scales."
    >
      <Card padded={false}>
        <div style={{ padding: '0 1.5rem' }}>
          <StateRow label="Variants">
            <TahiButton variant="primary" icon={<ArrowGlyph />}>Get started</TahiButton>
            <TahiButton variant="secondary">View work</TahiButton>
            <TahiButton variant="ghost">Skip for now</TahiButton>
            <TahiButton variant="danger">Delete</TahiButton>
            <TahiLink href="#" icon={<ArrowGlyph />}>How it works</TahiLink>
          </StateRow>
          <StateRow label="Sizes (primary)">
            <TahiButton variant="primary" size="sm" icon={<ArrowGlyph size={12} />}>Small</TahiButton>
            <TahiButton variant="primary" size="md" icon={<ArrowGlyph />}>Medium</TahiButton>
            <TahiButton variant="primary" size="lg" icon={<ArrowGlyph size={16} />}>Large</TahiButton>
          </StateRow>
          <StateRow label="Icon · trailing default">
            <TahiButton variant="primary" icon={<ArrowGlyph />}>Continue</TahiButton>
            <TahiButton variant="secondary" iconLeft={<SearchGlyph />}>Search clients</TahiButton>
          </StateRow>
          <StateRow label="Loading + disabled">
            <TahiButton variant="primary" loading>Saving</TahiButton>
            <TahiButton variant="secondary" loading>Importing</TahiButton>
            <TahiButton variant="primary" disabled>Disabled</TahiButton>
            <TahiButton variant="secondary" disabled>Disabled</TahiButton>
          </StateRow>
        </div>
      </Card>
    </PrimitiveShell>
  )
}

function AvatarShowcase() {
  return (
    <PrimitiveShell
      id="comp-avatar"
      title="Avatar"
      source="components/tahi/avatar.tsx"
      intro="Image when src is set, gradient-initials fallback otherwise (brand-lighter → brand-dark, 135°). Stacked variant overlaps and adds a +N overflow tile when truncated."
    >
      <Card padded={false}>
        <div style={{ padding: '0 1.5rem' }}>
          <StateRow label="Sizes (initials)">
            <Avatar name="Liam Miller" size="xs" />
            <Avatar name="Liam Miller" size="sm" />
            <Avatar name="Liam Miller" size="md" />
            <Avatar name="Liam Miller" size="lg" />
            <Avatar name="Liam Miller" size="xl" />
          </StateRow>
          <StateRow label="With status dot">
            <Avatar name="Olivia Chen"  status="online" />
            <Avatar name="Pita Tama"    status="away" />
            <Avatar name="Sam Brooks"   status="offline" />
          </StateRow>
          <StateRow label="Stack · max 3">
            <Avatar.Stack max={3}>
              <Avatar name="Alex" />
              <Avatar name="Bree" />
              <Avatar name="Cara" />
              <Avatar name="Dean" />
              <Avatar name="Emma" />
            </Avatar.Stack>
          </StateRow>
          <StateRow label="Stack · spacings">
            <Avatar.Stack spacing="tight">
              <Avatar name="A B" />
              <Avatar name="C D" />
              <Avatar name="E F" />
            </Avatar.Stack>
            <Avatar.Stack spacing="normal">
              <Avatar name="A B" />
              <Avatar name="C D" />
              <Avatar name="E F" />
            </Avatar.Stack>
            <Avatar.Stack spacing="loose">
              <Avatar name="A B" />
              <Avatar name="C D" />
              <Avatar name="E F" />
            </Avatar.Stack>
          </StateRow>
        </div>
      </Card>
    </PrimitiveShell>
  )
}

function BadgeShowcase() {
  const tones: BadgeTonePick[] = ['brand', 'positive', 'warning', 'danger', 'info', 'teal', 'purple', 'rose', 'neutral']
  // Compact inline Lucide icons for the icon-leader demo.
  const i = (paths: React.ReactNode) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width="100%" height="100%">{paths}</svg>
  )
  const iconForTone: Record<BadgeTonePick, React.ReactNode> = {
    brand:    i(<><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19.2 2.96a1 1 0 0 1 1.8.56c0 5.62-1.34 10.83-5 14.6A7 7 0 0 1 11 20Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6"/></>),
    positive: i(<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>),
    warning:  i(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>),
    danger:   i(<><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>),
    info:     i(<><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></>),
    teal:     i(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>),
    purple:   i(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>),
    rose:     i(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>),
    neutral:  i(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>),
  }
  return (
    <PrimitiveShell
      id="comp-badge"
      title="Badge"
      source="components/tahi/badge.tsx"
      intro="Status pills, chips, count badges. Default has no leader (Stripe-style, label carries the meaning). Optional leaders: 'dot' (classic 6px circle), 'icon' (Lucide icon, most informative), 'leaf' (Tahi-branded chips only)."
    >
      <Card padded={false}>
        <div style={{ padding: '0 1.5rem' }}>
          <StateRow label="No leader (default)">
            {tones.map(t => (
              <Badge key={t} tone={t}>{labelForTone(t)}</Badge>
            ))}
          </StateRow>
          <StateRow label="Dot leader">
            {tones.map(t => (
              <Badge key={t} tone={t} leader="dot">{labelForTone(t)}</Badge>
            ))}
          </StateRow>
          <StateRow label="Icon leader">
            {tones.map(t => (
              <Badge key={t} tone={t} leader="icon" icon={iconForTone[t]}>{labelForTone(t)}</Badge>
            ))}
          </StateRow>
          <StateRow label="Variants">
            <Badge tone="positive" variant="soft">Soft (no leader)</Badge>
            <Badge tone="positive" variant="solid">Solid</Badge>
            <Badge tone="positive" variant="outline" leader="dot">Outline + dot</Badge>
            <Badge tone="brand"    variant="count">12</Badge>
          </StateRow>
          <StateRow label="Sizes">
            <Badge tone="info" size="sm">Small</Badge>
            <Badge tone="info" size="md">Medium</Badge>
            <Badge tone="info" leader="dot" size="sm">Small dot</Badge>
            <Badge tone="info" leader="dot" size="md">Medium dot</Badge>
          </StateRow>
        </div>
      </Card>
    </PrimitiveShell>
  )
}

function CardShowcase() {
  return (
    <PrimitiveShell
      id="comp-card"
      title="Card"
      source="components/tahi/card.tsx"
      intro="Leaf radius, 1px border-strong at rest. Interactive cards lift 1px on hover with a soft brand-tinted shadow. Compound API: Card.Header / Title / Subtitle / Action / Body / Section / Footer / Divider."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CardPrim variant="default" padding="md">
          <CardPrim.Header>
            <div>
              <CardPrim.Title>Default card</CardPrim.Title>
              <CardPrim.Subtitle>Rest state. 1px border-strong, no shadow</CardPrim.Subtitle>
            </div>
            <CardPrim.Action><TahiButton size="sm" variant="ghost">Edit</TahiButton></CardPrim.Action>
          </CardPrim.Header>
          <CardPrim.Body>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              Content goes here. Hover the card to see the lift + brand glow.
            </p>
          </CardPrim.Body>
        </CardPrim>

        <CardPrim variant="default" padding="md" interactive>
          <CardPrim.Header>
            <div>
              <CardPrim.Title>Interactive card</CardPrim.Title>
              <CardPrim.Subtitle>Hover me. Border darkens, soft brand shadow, lifts 1px</CardPrim.Subtitle>
            </div>
          </CardPrim.Header>
        </CardPrim>

        <CardPrim variant="elevated" padding="md">
          <CardPrim.Header>
            <div>
              <CardPrim.Title>Elevated</CardPrim.Title>
              <CardPrim.Subtitle>Resting shadow-md. Popovers and floating UI</CardPrim.Subtitle>
            </div>
          </CardPrim.Header>
        </CardPrim>

        <CardPrim variant="flat" padding="md">
          <CardPrim.Header>
            <div>
              <CardPrim.Title>Flat</CardPrim.Title>
              <CardPrim.Subtitle>No border, no shadow. For nesting inside another card</CardPrim.Subtitle>
            </div>
          </CardPrim.Header>
        </CardPrim>
      </div>
    </PrimitiveShell>
  )
}

function TooltipShowcase() {
  const iconButtonStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: '2.5rem', height: '2.5rem',
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border-strong)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-muted)',
    cursor: 'pointer',
    transition: 'background var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out), border-color var(--motion-quick) var(--ease-out)',
  }
  return (
    <PrimitiveShell
      id="comp-tooltip"
      title="Tooltip"
      source="components/tahi/tooltip.tsx"
      intro="Small dark label on hover or keyboard focus. Portaled to body so it never clips. 400ms hover delay, instant on focus. Forest-dark surface against any background. Wraps long text up to 20rem. Pairs naturally with animated icons (below) on icon-only buttons."
    >
      <Card padded={false}>
        <div style={{ padding: '0 1.5rem' }}>
          <StateRow label="Icon buttons (animated)">
            <Tooltip label="Sync with Stripe">
              <button aria-label="Sync" style={iconButtonStyle}><AnimatedRefresh size={18} /></button>
            </Tooltip>
            <Tooltip label="Notifications">
              <button aria-label="Notifications" style={iconButtonStyle}><AnimatedBell size={18} /></button>
            </Tooltip>
            <Tooltip label="Settings">
              <button aria-label="Settings" style={iconButtonStyle}><AnimatedSettings size={18} /></button>
            </Tooltip>
            <Tooltip label="Tahi AI">
              <button aria-label="AI" style={iconButtonStyle}><AnimatedSparkles size={18} /></button>
            </Tooltip>
            <Tooltip label="Search">
              <button aria-label="Search" style={iconButtonStyle}><AnimatedSearch size={18} /></button>
            </Tooltip>
          </StateRow>
          <StateRow label="On truncated text">
            <Tooltip label="Webflow Cloud worker deployment via wf-app-prod.cosmic">
              <span style={{
                display: 'inline-block',
                maxWidth: '14rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '0.8125rem',
                color: 'var(--color-text-muted)',
                padding: '0.25rem 0.5rem',
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-md)',
                tabIndex: 0,
              } as React.CSSProperties}>
                Webflow Cloud worker deployment via wf-app-prod.cosmic
              </span>
            </Tooltip>
          </StateRow>
          <StateRow label="Sides (auto-flips)">
            <Tooltip label="Above by default" side="top">
              <button style={iconButtonStyle} aria-label="Top">▲</button>
            </Tooltip>
            <Tooltip label="Below when forced" side="bottom">
              <button style={iconButtonStyle} aria-label="Bottom">▼</button>
            </Tooltip>
          </StateRow>
        </div>
      </Card>

      <Card>
        <GroupHeading>How and when to use it</GroupHeading>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-subtle)', marginBottom: '0.5rem' }}>Use it on</div>
            <ul style={{ fontSize: '0.8125rem', lineHeight: 1.7 }} className="space-y-1">
              <li>Icon-only buttons (kebab, bell, gear, refresh)</li>
              <li>Truncated text that needs the full value on hover</li>
              <li>Status badges where the meaning isn&apos;t obvious from the label</li>
              <li>Disabled controls where the reason needs explaining</li>
            </ul>
          </div>
          <div>
            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-subtle)', marginBottom: '0.5rem' }}>Don&apos;t use it on</div>
            <ul style={{ fontSize: '0.8125rem', lineHeight: 1.7 }} className="space-y-1">
              <li>Elements that already show a visible label</li>
              <li>Actions that need long explanation (use a popover or inline help)</li>
              <li>Touch-only surfaces (tooltips don&apos;t trigger on tap)</li>
              <li>Decoration. If a user can ignore it, it&apos;s noise</li>
            </ul>
          </div>
        </div>
        <div style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          Defaults: 400ms hover delay (no pop on accidental cursor pass), instant on keyboard focus, auto-flip if there&apos;s no room above. Always pass an <Mono>aria-label</Mono> on the wrapped element too. The tooltip is decorative; the label is the source of truth for assistive tech.
        </div>
      </Card>
    </PrimitiveShell>
  )
}

// ── Feature card showcase ──────────────────────────────────────────────
function FeatureCardShowcase() {
  return (
    <PrimitiveShell
      id="comp-feature-card"
      title="Feature card"
      source="components/tahi/feature-card.tsx"
      intro="The loud card for hero moments. Use sparingly: the AI briefing, the one featured KPI in a strip, a launch banner. Variants: lime fill, forest gradient, photo background, plain cream."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FeatureCard variant="lime" padding="lg">
          <FeatureCard.Eyebrow>Featured</FeatureCard.Eyebrow>
          <FeatureCard.Title>Total projects</FeatureCard.Title>
          <FeatureCard.Description>
            24 active across pipeline, delivery, and onboarding. Up 18% on last quarter.
          </FeatureCard.Description>
          <FeatureCard.Footer>
            <TahiButton variant="secondary" size="sm">Open reports</TahiButton>
          </FeatureCard.Footer>
        </FeatureCard>

        <FeatureCard variant="forest" padding="lg">
          <FeatureCard.Eyebrow>Tahi AI &middot; daily briefing</FeatureCard.Eyebrow>
          <FeatureCard.Title>Three things to look at today</FeatureCard.Title>
          <FeatureCard.Description>
            Physitrack proposal has been in negotiation for 12 days. BCS Q2 retainer renewed for $48,000. Glasswall is 110% allocated next week.
          </FeatureCard.Description>
          <FeatureCard.Footer>
            <TahiButton variant="primary" size="sm">Open briefing</TahiButton>
            <TahiLink href="#" tone="on-dark">All AI features</TahiLink>
          </FeatureCard.Footer>
        </FeatureCard>

        <FeatureCard variant="photo" padding="lg">
          <FeatureCard.Eyebrow>Time tracker</FeatureCard.Eyebrow>
          <FeatureCard.Title>02:48:06</FeatureCard.Title>
          <FeatureCard.Description>
            Currently tracking on Glasswall &middot; WCAG audit.
          </FeatureCard.Description>
          <FeatureCard.Footer>
            <TahiButton variant="primary" size="sm">Pause</TahiButton>
            <TahiButton variant="secondary" size="sm">Stop &amp; log</TahiButton>
          </FeatureCard.Footer>
        </FeatureCard>

        <FeatureCard variant="cream" padding="lg">
          <FeatureCard.Eyebrow>Quiet variant</FeatureCard.Eyebrow>
          <FeatureCard.Title>For when the surface should sit still</FeatureCard.Title>
          <FeatureCard.Description>
            Use the plain cream variant when the content needs to be the hero, not the card.
          </FeatureCard.Description>
        </FeatureCard>
      </div>
    </PrimitiveShell>
  )
}

// ── KPI card showcase ──────────────────────────────────────────────────
function KPICardShowcase() {
  return (
    <PrimitiveShell
      id="comp-kpi-card"
      title="KPI card"
      source="components/tahi/kpi-card.tsx"
      intro="Single-metric tile. Big bold number, delta with up / down chevron, optional trailing sub-label. Clickable cards show an arrow-up-right top-right that translates on hover. One per strip can be variant='featured' (lime) to mark the hero metric."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          variant="featured"
          label="Total revenue"
          value="$689,372"
          delta={{ value: '+15%', direction: 'up' }}
          trailing="vs last month"
          href="#"
        />
        <KPICard
          label="Total earnings"
          value="$950"
          delta={{ value: '+8%', direction: 'up' }}
          trailing="vs last month"
          href="#"
        />
        <KPICard
          label="Total spending"
          value="$700"
          delta={{ value: '-4%', direction: 'down' }}
          trailing="vs last month"
          href="#"
        />
        <KPICard
          label="Saved"
          value="$1,050"
          delta={{ value: '+12%', direction: 'up' }}
          trailing="vs last month"
          href="#"
        />
      </div>

      <Card>
        <GroupHeading>How to use it</GroupHeading>
        <ul style={{ fontSize: '0.8125rem', lineHeight: 1.7 }} className="space-y-1">
          <li>One featured (lime) variant per strip marks the hero metric.</li>
          <li>Pair delta with trailing sub-label (&ldquo;vs last month&rdquo;, &ldquo;7-day&rdquo;) so the number reads in context.</li>
          <li>Set <Mono>href</Mono> or <Mono>onClick</Mono> for clickable tiles. The arrow-up-right indicator appears in the top-right and translates on hover.</li>
          <li>Pass children to add a sparkline below the value (chart-area placeholder).</li>
        </ul>
      </Card>
    </PrimitiveShell>
  )
}

// ── Toast showcase ─────────────────────────────────────────────────────
function ToastShowcase() {
  const { showToast } = useToast()
  return (
    <PrimitiveShell
      id="comp-toast"
      title="Toast"
      source="components/tahi/toast.tsx"
      intro="Transient feedback at the bottom-right. Dark forest surface, no icon, tone-coloured leading word (Saved, Error, Heads up, Tip). Optional action button (Undo, View). Auto-dismiss after 3.5s."
    >
      <Card padded={false}>
        <div style={{ padding: '0 1.5rem' }}>
          <StateRow label="Tones">
            <TahiButton variant="secondary" size="sm" onClick={() => showToast('Client saved', 'success')}>Success</TahiButton>
            <TahiButton variant="secondary" size="sm" onClick={() => showToast("Couldn't connect to Xero", 'error')}>Error</TahiButton>
            <TahiButton variant="secondary" size="sm" onClick={() => showToast('Capacity over 100% next week', 'warning')}>Warning</TahiButton>
            <TahiButton variant="secondary" size="sm" onClick={() => showToast('Syncing with Stripe', 'info')}>Info</TahiButton>
          </StateRow>
          <StateRow label="With action">
            <TahiButton variant="secondary" size="sm" onClick={() => showToast('Deal moved to Won', 'success', { action: { label: 'Undo', onClick: () => showToast('Reverted', 'info') } })}>Undoable</TahiButton>
            <TahiButton variant="secondary" size="sm" onClick={() => showToast('Invoice INV-0042 sent', 'success', { action: { label: 'View', onClick: () => showToast('Opening invoice', 'info') } })}>With view</TahiButton>
          </StateRow>
        </div>
      </Card>
    </PrimitiveShell>
  )
}

// ── Menu showcase ──────────────────────────────────────────────────────
function MenuShowcase() {
  const g = (paths: React.ReactNode) => (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
  )
  return (
    <PrimitiveShell
      id="comp-menu"
      title="Menu"
      source="components/tahi/menu.tsx"
      intro="Standardised dropdown menu built on top of Popover. Used for kebab menus, sort/filter pickers, user dropdowns. Composable: Menu.Item, Menu.Divider, Menu.Label. Tone='danger' for destructive actions."
    >
      <Card padded={false}>
        <div style={{ padding: '0 1.5rem' }}>
          <StateRow label="Kebab menu (row action)">
            <Menu
              trigger={
                <button
                  type="button"
                  aria-label="Row actions"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '2.25rem',
                    height: '2.25rem',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border-strong)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {g(<><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>)}
                </button>
              }
              align="start"
              width="11rem"
            >
              <Menu.Item icon={g(<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></>)}>Rename</Menu.Item>
              <Menu.Item icon={g(<><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></>)} trailing="⌘D">Duplicate</Menu.Item>
              <Menu.Item icon={g(<><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></>)}>Share</Menu.Item>
              <Menu.Divider />
              <Menu.Label>Move</Menu.Label>
              <Menu.Item icon={g(<><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></>)}>Archive</Menu.Item>
              <Menu.Item icon={g(<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></>)} tone="danger">Delete</Menu.Item>
            </Menu>
          </StateRow>

          <StateRow label="Sort picker">
            <Menu
              trigger={
                <button
                  type="button"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    padding: '0.5rem 0.75rem',
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border-strong)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--color-text)',
                    fontSize: '0.8125rem',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Sort: Newest first
                  {g(<polyline points="6 9 12 15 18 9"/>)}
                </button>
              }
              align="start"
              width="12rem"
            >
              <Menu.Item>Newest first</Menu.Item>
              <Menu.Item>Oldest first</Menu.Item>
              <Menu.Item>Highest value</Menu.Item>
              <Menu.Item>Most recent activity</Menu.Item>
            </Menu>
          </StateRow>
        </div>
      </Card>
    </PrimitiveShell>
  )
}

function ComponentsSection() {
  return (
    <SectionShell
      id="components"
      title="Components"
      intro="The reusable primitives in components/tahi/. Each block below shows every state and the source path."
    >
      <ComponentsSubNav />
      <div className="space-y-12">
        <ButtonShowcase />
        <AvatarShowcase />
        <BadgeShowcase />
        <CardShowcase />
        <FeatureCardShowcase />
        <KPICardShowcase />
        <TooltipShowcase />
        <MenuShowcase />
        <ToastShowcase />
        <ChartShowcase />
        <DataTableShowcase />
      </div>
    </SectionShell>
  )
}

// ── Chart showcase ─────────────────────────────────────────────────────

const BAR_DATA = [
  { label: 'Mon', value: 8.5 },
  { label: 'Tue', value: 12.0 },
  { label: 'Wed', value: 6.4 },
  { label: 'Thu', value: 14.2 },
  { label: 'Fri', value: 9.8 },
  { label: 'Sat', value: 4.6, striped: true },
  { label: 'Sun', value: 3.2, striped: true },
]

const LINE_DATA = [
  { label: 'Jan', value: 42 },
  { label: 'Feb', value: 48 },
  { label: 'Mar', value: 46 },
  { label: 'Apr', value: 55 },
  { label: 'May', value: 62 },
  { label: 'Jun', value: 71 },
  { label: 'Jul', value: 68 },
]

function ChartShowcase() {
  return (
    <PrimitiveShell
      id="comp-chart"
      title="Charts"
      source="components/tahi/chart.tsx"
      intro="Recharts wrappers that pull from the shared CHART palette and apply consistent grid, axis, tooltip, and motion defaults. BarChart has standard / pill / striped variants. LineChart can fill below the line as an area. Sparkline is inline. Gauge is a circular progress ring."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CardPrim>
          <GroupHeading>BarChart &middot; standard</GroupHeading>
          <BarChart
            data={BAR_DATA}
            height={200}
            formatValue={v => `${v}h`}
            ariaLabel="Hours tracked this week"
          />
        </CardPrim>

        <CardPrim>
          <GroupHeading>BarChart &middot; pill + value callout</GroupHeading>
          <BarChart
            data={BAR_DATA}
            height={200}
            variant="pill"
            valueCallout
            formatValue={v => `${v}h`}
            ariaLabel="Hours tracked this week, pill variant"
          />
        </CardPrim>

        <CardPrim>
          <GroupHeading>LineChart &middot; area</GroupHeading>
          <LineChart
            data={LINE_DATA}
            height={200}
            area
            formatValue={v => `${v}k`}
            ariaLabel="Monthly revenue"
          />
        </CardPrim>

        <CardPrim>
          <GroupHeading>Gauge</GroupHeading>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem 0', minHeight: 200 }}>
            <Gauge value={68} label="Capacity used" sub="32% headroom" />
          </div>
        </CardPrim>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CardPrim>
          <GroupHeading>DonutChart</GroupHeading>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem 0' }}>
            <DonutChart
              centreLabel="Pipeline"
              centreValue="$287k"
              segments={[
                { label: 'Discovery',   value: 32 },
                { label: 'Proposal',    value: 48 },
                { label: 'Negotiation', value: 24 },
                { label: 'Verbal',      value: 16 },
              ]}
            />
          </div>
        </CardPrim>

        <CardPrim>
          <GroupHeading>GanttChart</GroupHeading>
          <GanttChart
            rangeStart={new Date('2026-05-01')}
            rangeEnd={new Date('2026-09-01')}
            today={new Date('2026-06-12')}
            rows={[
              { id: 'a', label: 'Discovery', sub: 'Liam',  colourIndex: 0, start: new Date('2026-05-04'), end: new Date('2026-05-22') },
              { id: 'b', label: 'Strategy',  sub: 'Staci', colourIndex: 1, start: new Date('2026-05-18'), end: new Date('2026-06-08'), milestones: [{ date: new Date('2026-06-01') }] },
              { id: 'c', label: 'Design',    sub: 'Sarah', colourIndex: 2, start: new Date('2026-06-01'), end: new Date('2026-07-04') },
              { id: 'd', label: 'Build',     sub: 'James', colourIndex: 3, start: new Date('2026-06-20'), end: new Date('2026-08-12'), milestones: [{ date: new Date('2026-07-15') }] },
              { id: 'e', label: 'Launch',    sub: 'Team',  colourIndex: 4, start: new Date('2026-08-05'), end: new Date('2026-08-22') },
            ]}
          />
        </CardPrim>
      </div>

      <CardPrim>
        <GroupHeading>Sparkline &middot; inline</GroupHeading>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap', padding: '0.25rem 0' }}>
          <SparkRow label="MRR" tone="positive" data={[12, 14, 13, 16, 18, 17, 21]} value="$11,921" />
          <SparkRow label="Outstanding" tone="negative" data={[8, 9, 7, 6, 7, 5, 4]} value="$11,678" />
          <SparkRow label="Weighted pipeline" tone="neutral" data={[40, 44, 42, 50, 55, 53, 58]} value="$114,803" />
        </div>
      </CardPrim>

      <CardPrim>
        <GroupHeading>How to use it</GroupHeading>
        <ul style={{ fontSize: '0.8125rem', lineHeight: 1.7 }} className="space-y-1">
          <li>Every chart picks colours from the shared <Mono>CHART</Mono> palette so the same metric stays the same colour across the dashboard.</li>
          <li>Use <Mono>variant=&quot;pill&quot;</Mono> when bars should feel like data pills (capacity, time tracked). Combine with <Mono>valueCallout</Mono> to highlight the peak. Pill rounds the top corners only so bars sit flat on the axis.</li>
          <li>Use <Mono>striped</Mono> per-bar (or <Mono>variant=&quot;striped&quot;</Mono>) for inactive / projected periods.</li>
          <li><Mono>DonutChart</Mono> takes any number of segments; centre label + value sit inside the ring. Legend below shows percentages.</li>
          <li><Mono>GanttChart</Mono> renders horizontal bars across a date range. Pass <Mono>today</Mono> for the brand-coloured guide. <Mono>colourIndex</Mono> picks from the categorical rotation; <Mono>tone</Mono> picks a semantic colour. <Mono>milestones</Mono> render as diamonds on the bar.</li>
          <li><Mono>Sparkline</Mono> stays inline (default 100&times;28). Wrap next to a value + label.</li>
          <li><Mono>Gauge</Mono> takes a 0-100 value, optional <Mono>label</Mono> + <Mono>sub</Mono> for the centre.</li>
          <li>Every chart animates when it scrolls into view, not on initial mount. <Mono>prefers-reduced-motion</Mono> disables animation.</li>
        </ul>
      </CardPrim>
    </PrimitiveShell>
  )
}

function SparkRow({
  label,
  value,
  tone,
  data,
}: {
  label: string
  value: string
  tone: 'positive' | 'negative' | 'neutral'
  data: number[]
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{label}</div>
        <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--color-text)' }}>{value}</div>
      </div>
      <Sparkline data={data} tone={tone} ariaLabel={`${label} sparkline`} />
    </div>
  )
}

// ── DataTable showcase ─────────────────────────────────────────────────

interface InvoiceDemo {
  id: string
  number: string
  client: string
  amount: number
  status: 'paid' | 'sent' | 'overdue' | 'draft'
  due: string
}

const INVOICE_ROWS: InvoiceDemo[] = [
  { id: '1', number: 'INV-1041', client: 'Physitrack',  amount:  8400, status: 'paid',    due: '2026-04-12' },
  { id: '2', number: 'INV-1040', client: 'Glasswall',   amount:  3200, status: 'overdue', due: '2026-04-02' },
  { id: '3', number: 'INV-1039', client: 'Beta Labs',   amount:  6750, status: 'sent',    due: '2026-04-21' },
  { id: '4', number: 'INV-1038', client: 'Acme Corp',   amount: 12480, status: 'paid',    due: '2026-03-30' },
  { id: '5', number: 'INV-1037', client: 'Tahi Studio', amount:  1500, status: 'draft',   due: '—' },
]

function DataTableShowcase() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterQuery, setFilterQuery] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')

  const filteredRows = INVOICE_ROWS.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false
    if (filterQuery && !`${r.number} ${r.client}`.toLowerCase().includes(filterQuery.toLowerCase())) return false
    return true
  })

  const rowActionsFor = (r: InvoiceDemo) => ([
    { label: 'Open in new tab', icon: <ExternalLink size={14} />, onClick: () => alert(`Open ${r.number}`) },
    { label: 'Duplicate',       icon: <Copy size={14} />,         onClick: () => alert(`Duplicate ${r.number}`) },
    { label: 'Delete',          icon: <Trash2 size={14} />,       tone: 'danger' as const, onClick: () => alert(`Delete ${r.number}`) },
  ])

  const wideColumns = [
    'Invoice','Client','Amount','Status','Due','Issued','Source','Currency','Tax','Discount','Total','Notes',
  ]

  return (
    <PrimitiveShell
      id="comp-table"
      title="Data table"
      source="components/tahi/data-table.tsx"
      intro="The shared list-page table. Real <table> for semantics, sticky thead, h-scroll for overflow, sortable headers, selectable rows, expandable rows, per-row action menu via 3-dots button OR right-click anywhere on the row."
    >
      {/* Primary demo: selection + actions + expand + filter bar */}
      <div className="space-y-3">
        {/* Filter bar */}
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div className="tahi-input-group" style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            padding: '0 var(--space-2)', height: '2.25rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-md)',
            flex: '1 1 16rem', maxWidth: '24rem',
          }}>
            <SearchGlyph size={14} />
            <input
              type="text"
              placeholder="Search invoices"
              value={filterQuery}
              onChange={e => setFilterQuery(e.target.value)}
              style={{
                flex: 1, minWidth: 0,
                border: 'none', outline: 'none', background: 'transparent',
                fontSize: 'var(--text-sm)', color: 'var(--color-text)',
              }}
              aria-label="Search invoices"
            />
          </div>
          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            aria-label="Filter by status"
            style={{
              height: '2.25rem',
              padding: '0 var(--space-3)',
              fontSize: 'var(--text-sm)',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: filterStatus === 'all' ? 'var(--color-text-muted)' : 'var(--color-text)',
              cursor: 'pointer',
            }}
          >
            <option value="all">All statuses</option>
            <option value="paid">Paid</option>
            <option value="sent">Sent</option>
            <option value="overdue">Overdue</option>
            <option value="draft">Draft</option>
          </select>
          {selected.size > 0 && (
            <div
              role="status"
              aria-live="polite"
              style={{
                marginLeft: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: '0 var(--space-3)',
                height: '2.25rem',
                background: 'var(--color-brand-50)',
                border: '1px solid var(--color-brand-100)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-active)',
                fontWeight: 500,
              }}
            >
              {selected.size} selected
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                style={{
                  background: 'transparent', border: 'none',
                  padding: '0 var(--space-1)',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-xs)',
                  textDecoration: 'underline',
                }}
              >Clear</button>
            </div>
          )}
        </div>

        <Card padded={false}>
          <DataTable<InvoiceDemo>
            ariaLabel="Demo invoices"
            getRowId={r => r.id}
            defaultSort={{ key: 'number', dir: 'desc' }}
            selectable
            selectedIds={selected}
            onSelectionChange={setSelected}
            rowActions={rowActionsFor}
            renderExpand={r => (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-4)' }}>
                <ExpandField label="Invoice" value={r.number} />
                <ExpandField label="Status" value={r.status} />
                <ExpandField label="Issued" value="3 Apr 2026" />
                <ExpandField label="Client" value={r.client} />
                <ExpandField label="Due" value={r.due} />
                <ExpandField label="Total" value={`$${r.amount.toLocaleString()}`} />
              </div>
            )}
            columns={[
              { key: 'number', header: 'Invoice', sortable: true,
                accessor: r => r.number,
                sortValue: r => r.number,
                minWidth: '7rem' },
              { key: 'client', header: 'Client', sortable: true,
                accessor: r => r.client,
                sortValue: r => r.client,
                minWidth: '10rem' },
              { key: 'amount', header: 'Amount', sortable: true, align: 'right',
                render: r => `$${r.amount.toLocaleString()}`,
                sortValue: r => r.amount,
                minWidth: '7rem' },
              { key: 'status', header: 'Status',
                render: r => <Badge tone={statusTone(r.status)} variant="soft" size="sm" leader={false}>{r.status}</Badge>,
                minWidth: '7rem' },
              { key: 'due', header: 'Due', sortable: true,
                accessor: r => r.due,
                sortValue: r => r.due,
                muted: true,
                minWidth: '7rem' },
            ]}
            rows={filteredRows}
          />
        </Card>
      </div>

      {/* Wide-overflow demo: more columns than fit, h-scroll */}
      <CardPrim>
        <GroupHeading>Overflow &middot; h-scroll on narrow viewports</GroupHeading>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginTop: '-0.25rem' }}>
          When the table has more columns than fit, the outer wrapper scrolls horizontally instead of wrapping cells. Scroll the table below sideways to see the rest.
        </p>
        <Card padded={false}>
          <DataTable<InvoiceDemo>
            getRowId={r => r.id}
            columns={wideColumns.map((label, i) => ({
              key: `c${i}`,
              header: label,
              render: r =>
                label === 'Amount' || label === 'Total' || label === 'Tax' || label === 'Discount'
                  ? `$${r.amount.toLocaleString()}`
                  : label === 'Status'
                    ? <Badge tone={statusTone(r.status)} variant="soft" size="sm" leader={false}>{r.status}</Badge>
                    : label === 'Invoice'
                      ? r.number
                      : label === 'Client'
                        ? r.client
                        : label === 'Currency'
                          ? 'NZD'
                          : label === 'Source'
                            ? 'Manual'
                            : label === 'Notes'
                              ? 'Long notes column that should not wrap'
                              : r.due,
              minWidth: '8rem',
              align: label === 'Amount' || label === 'Total' || label === 'Tax' || label === 'Discount' ? 'right' : 'left',
            }))}
            rows={INVOICE_ROWS}
          />
        </Card>
      </CardPrim>

      {/* States */}
      <CardPrim>
        <GroupHeading>States</GroupHeading>
        <StateRow label="Loading">
          <Card padded={false}>
            <DataTable<InvoiceDemo>
              loading
              getRowId={r => r.id}
              columns={[
                { key: 'number', header: 'Invoice', minWidth: '7rem' },
                { key: 'client', header: 'Client', minWidth: '10rem' },
                { key: 'amount', header: 'Amount', align: 'right', minWidth: '6rem' },
              ]}
              rows={[]}
            />
          </Card>
        </StateRow>
        <StateRow label="Empty">
          <Card padded={false}>
            <DataTable<InvoiceDemo>
              getRowId={r => r.id}
              columns={[
                { key: 'number', header: 'Invoice', minWidth: '7rem' },
                { key: 'client', header: 'Client', minWidth: '10rem' },
                { key: 'amount', header: 'Amount', align: 'right', minWidth: '6rem' },
              ]}
              rows={[]}
              empty={
                <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                  <p style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: 'var(--text-sm)' }}>No invoices yet</p>
                  <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginTop: '0.25rem' }}>
                    Create one to start billing this client.
                  </p>
                </div>
              }
            />
          </Card>
        </StateRow>
        <StateRow label="Compact">
          <Card padded={false}>
            <DataTable<InvoiceDemo>
              density="compact"
              getRowId={r => r.id}
              columns={[
                { key: 'number', header: 'Invoice', accessor: r => r.number, minWidth: '7rem' },
                { key: 'client', header: 'Client', accessor: r => r.client, minWidth: '10rem' },
                { key: 'amount', header: 'Amount', align: 'right',
                  render: r => `$${r.amount.toLocaleString()}`, minWidth: '6rem' },
              ]}
              rows={INVOICE_ROWS.slice(0, 3)}
            />
          </Card>
        </StateRow>
      </CardPrim>

      <CardPrim>
        <GroupHeading>How to use it</GroupHeading>
        <ul style={{ fontSize: '0.8125rem', lineHeight: 1.7 }} className="space-y-1">
          <li>Define <Mono>columns</Mono> once. Each has a <Mono>key</Mono>, header, and either <Mono>accessor</Mono> (simple value) or <Mono>render</Mono> (full custom cell).</li>
          <li>Pass <Mono>selectable</Mono> + <Mono>selectedIds</Mono> + <Mono>onSelectionChange</Mono> for row selection. The header gets a select-all checkbox; the selection bar above is your responsibility (a Card or a coloured chip works).</li>
          <li>Pass <Mono>rowActions</Mono> to enable the 3-dots menu column AND right-click context menu on the row.</li>
          <li>Pass <Mono>renderExpand</Mono> to enable inline expansion. Clicking the row toggles the slide-down panel instead of firing <Mono>onRowClick</Mono>.</li>
          <li>Set <Mono>sortable: true</Mono> per column. Pass <Mono>sort</Mono> + <Mono>onSortChange</Mono> for controlled sort.</li>
          <li>Default behaviour: <Mono>onRowClick</Mono> navigates. With <Mono>renderExpand</Mono> set, the row expands. With both, the row expands and the 3-dots menu carries the &ldquo;Open&rdquo; action.</li>
          <li>Outer wrapper inherits its parent&apos;s border-radius + clips overflow so a wrapping Card&apos;s rounded corners cut the table cleanly.</li>
        </ul>
      </CardPrim>
    </PrimitiveShell>
  )
}

function ExpandField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
      }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)', marginTop: '0.125rem' }}>
        {value}
      </div>
    </div>
  )
}

// Type alias to avoid name collisions inside this file.
type BadgeTonePick = 'brand' | 'positive' | 'warning' | 'danger' | 'info' | 'teal' | 'purple' | 'rose' | 'neutral'

function labelForTone(t: BadgeTonePick): string {
  switch (t) {
    case 'brand':    return 'Brand'
    case 'positive': return 'Delivered'
    case 'warning':  return 'In review'
    case 'danger':   return 'Overdue'
    case 'info':     return 'Submitted'
    case 'teal':     return 'In progress'
    case 'purple':   return 'Client review'
    case 'rose':     return 'Urgent'
    case 'neutral':  return 'Draft'
  }
}

// Tiny SVG glyphs used inside the button showcase. We don't import
// Lucide here to keep this demo self-contained. The default trailing
// glyph is arrow-up-right so the hover translate(3px, -3px) points the
// arrow toward where it's lifting.
function ArrowGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  )
}
function SearchGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}
