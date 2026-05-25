/**
 * Shared visual primitives for "deliverable" surfaces — public client-
 * facing pages where the goal is to make Tahi look like the kind of
 * agency you'd hire for an enterprise build, not a vendor.
 *
 * The reference is the Tahi Studio schedule PDF (see Tevalis +
 * Giant Group examples). The visual system: cream surface, brand-green
 * accent on key words, decorative organic circles, Tahi leaf top-left,
 * page number top-right, metadata footer strip on the cover, sectioned
 * page-by-page flow with consistent chrome.
 *
 * Used by:
 *   - app/p/schedule/[token]/schedule-viewer.tsx (Slice 1)
 *   - app/p/proposal/[token]/proposal-viewer.tsx (Slice 2)
 *
 * Title accent syntax: wrap words in {{double braces}} to render in
 * brand-green. Example: "Giant Group {{12 week build plan}}." renders
 * "Giant Group" in default colour and "12 week build plan" in green.
 */
'use client'

import * as React from 'react'

// ── Brand tokens (mirror the PDF) ─────────────────────────────────────────
//
// Hardcoded hex (not CSS vars) so the public viewer renders consistently
// regardless of whether the app's brand tokens are loaded. The dashboard
// /globals.css does define these, but public-token pages need to be
// self-contained because they sometimes load before token CSS.

export const BRAND = {
  // Surfaces
  surface: '#ffffff',
  cream: '#fafbf9',
  band: '#f5f7f5',
  // Type
  ink: '#1f2c1a',
  body: '#2d3a26',
  muted: '#5a6657',
  subtle: '#8a9987',
  // Brand greens
  green: '#5A824E',
  greenDark: '#425F39',
  greenLight: '#7aab6b',
  green50: '#f0f7ee',
  green100: '#dcefd8',
  // Borders
  border: '#d4e0d0',
  borderSubtle: '#e8f0e6',
  // Accents (for callouts / impact pills)
  amberBg: '#fff7ed',
  amberInk: '#c2410c',
  amberBorder: '#fed7aa',
  redBg: '#fef2f2',
  redInk: '#dc2626',
  redBorder: '#fecaca',
  sageBg: '#f0f7ee',
  sageInk: '#425F39',
  sageBorder: '#dcefd8',
} as const

// ── Title accent renderer ─────────────────────────────────────────────────

/** Render a title string with {{accent words}} highlighted in brand-green. */
export function AccentTitle({
  text,
  size = 'lg',
  as: Tag = 'h1',
  style,
  /** When rendering on a dark surface (cover hero), flip the accent
   *  colour to light-green so it stays readable. Defaults to false. */
  onDark = false,
}: {
  text: string
  size?: 'lg' | 'md' | 'sm'
  as?: 'h1' | 'h2' | 'h3'
  style?: React.CSSProperties
  onDark?: boolean
}) {
  const fontSize = size === 'lg'
    ? 'clamp(2rem, 5vw, 3.25rem)'
    : size === 'md'
    ? 'clamp(1.5rem, 3.5vw, 2.25rem)'
    : 'clamp(1.125rem, 2.5vw, 1.5rem)'
  const lineHeight = size === 'lg' ? 1.04 : size === 'md' ? 1.1 : 1.2
  const weight = size === 'lg' ? 800 : 700

  // Split on {{...}} preserving the tokens
  const parts = text.split(/(\{\{[^}]+\}\})/g).filter(Boolean)
  const accentColour = onDark ? BRAND.greenLight : BRAND.green

  return (
    <Tag
      style={{
        margin: 0,
        fontSize,
        fontWeight: weight,
        color: BRAND.ink,
        lineHeight,
        letterSpacing: '-0.015em',
        overflowWrap: 'break-word',
        ...style,
      }}
    >
      {parts.map((part, i) => {
        const m = part.match(/^\{\{([^}]+)\}\}$/)
        return m ? (
          <span key={i} style={{ color: accentColour }}>{m[1]}</span>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      })}
    </Tag>
  )
}

// ── Brand mark (logo + wordmark) ──────────────────────────────────────────

export function BrandMark({
  size = 'md',
  variant = 'dark',
}: {
  size?: 'sm' | 'md'
  /** 'dark' = dark ink on light bg (default). 'white' = white ink on
   *  dark bg (cover hero etc.) */
  variant?: 'dark' | 'white'
}) {
  const dim = size === 'sm' ? '1.125rem' : '1.4rem'
  const font = size === 'sm' ? '0.75rem' : '0.875rem'
  // White variant uses the pale wordmark with leaf on a dark surface.
  // The dashboard ships /dashboard/tahi-logo.png (pale) and
  // /dashboard/favicon.png (dark). On the white variant we use the
  // pale one; otherwise the dark favicon.
  const src = variant === 'white' ? '/dashboard/tahi-logo.png' : '/dashboard/favicon.png'
  const inkColor = variant === 'white' ? BRAND.surface : BRAND.ink
  // The pale wordmark already has type baked in, so render only the
  // image for the white variant. The dark variant pairs the favicon
  // with a "Tahi Studio" wordmark.
  if (variant === 'white') {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="Tahi Studio"
          style={{
            height: dim,
            width: 'auto',
            display: 'block',
            flexShrink: 0,
            // Pale variant; if the asset isn't pale, this brightens it.
            filter: 'brightness(0) invert(1)',
          }}
        />
      </div>
    )
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        style={{ width: dim, height: dim, display: 'block', flexShrink: 0 }}
      />
      <span
        style={{
          fontSize: font,
          fontWeight: 700,
          color: inkColor,
          letterSpacing: '-0.01em',
        }}
      >
        Tahi Studio
      </span>
    </div>
  )
}

// ── Page chrome (leaf top-left + section number top-right) ────────────────

export function PageChrome({
  sectionNumber,
  sectionName,
  projectLabel,
  children,
}: {
  /** "01" / "02" etc. Pass null to suppress the top-right label. */
  sectionNumber?: string | null
  /** "EXECUTIVE OVERVIEW" — uppercase, paired with sectionNumber. */
  sectionName?: string | null
  /** Project tagline shown in the footer, e.g. "Tevalis × Tahi Studio · build plan". */
  projectLabel?: string | null
  children: React.ReactNode
}) {
  return (
    <section
      style={{
        position: 'relative',
        width: 'calc(100% - clamp(1.5rem, 6vw, 3rem))',
        maxWidth: '76rem',
        margin: '0 auto',
        background: BRAND.surface,
        border: `1px solid ${BRAND.borderSubtle}`,
        borderRadius: '1rem',
        boxShadow: '0 4px 16px rgba(31, 44, 26, 0.05)',
        padding: 'clamp(1.25rem, 3vw, 2.5rem) clamp(1.25rem, 3vw, 2.25rem)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
      }}
    >
      {/* Top chrome */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          paddingBottom: '0.625rem',
          borderBottom: `1px solid ${BRAND.borderSubtle}`,
        }}
      >
        <BrandMark size="sm" />
        {(sectionNumber || sectionName) && (
          <span
            style={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              color: BRAND.subtle,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {sectionNumber}
            {sectionNumber && sectionName ? ' / ' : ''}
            {sectionName}
          </span>
        )}
      </div>

      <div style={{ flex: 1 }}>{children}</div>

      {/* Bottom chrome */}
      {(projectLabel || sectionName) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            paddingTop: '0.625rem',
            borderTop: `1px solid ${BRAND.borderSubtle}`,
            fontSize: '0.6875rem',
            color: BRAND.subtle,
          }}
        >
          <span style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {sectionName ?? ''}
          </span>
          <span>{projectLabel ?? ''}</span>
        </div>
      )}
    </section>
  )
}

// ── Section header (eyebrow + big title + supporting paragraph) ──────────

export function SectionHeader({
  eyebrow,
  title,
  body,
}: {
  /** Small uppercase line above the title, e.g. "EXECUTIVE OVERVIEW". */
  eyebrow?: string | null
  /** Title with optional {{accent words}} in brand-green. */
  title: string
  /** Lede paragraph(s) below the title. Plain string with \n splits, or ReactNode. */
  body?: string | React.ReactNode | null
}) {
  return (
    <header style={{ marginBottom: '1.5rem' }}>
      {eyebrow && (
        <div
          style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            color: BRAND.subtle,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '0.5rem',
          }}
        >
          {eyebrow}
        </div>
      )}
      <AccentTitle text={title} size="md" as="h2" />
      {body && (
        <div
          style={{
            marginTop: '0.875rem',
            fontSize: '0.9375rem',
            lineHeight: 1.65,
            color: BRAND.body,
            maxWidth: '50rem',
          }}
        >
          {typeof body === 'string'
            ? body.split('\n').map((line, i) => <p key={i} style={{ margin: '0 0 0.5rem' }}>{line}</p>)
            : body}
        </div>
      )}
    </header>
  )
}

// ── Cover page ────────────────────────────────────────────────────────────

export interface MetadataCell {
  label: string
  value: string
}

export function CoverPage({
  eyebrow,
  title,
  metadata,
  projectLabel,
}: {
  /** Small uppercase line above the title, e.g. "PROJECT SCHEDULE · GANTT". */
  eyebrow?: string | null
  /** Cover title with {{accent}} syntax. */
  title: string
  /** Metadata footer cells (PREPARED FOR, etc.). */
  metadata?: MetadataCell[]
  /** Project label for the bottom-right of the cover. */
  projectLabel?: string | null
}) {
  // Dark hero variant matching the proposal's 'dark' cover theme: deep
  // brand-dark green with white type. No decorative circles — the
  // glow gradient does the visual lifting instead.
  return (
    <section
      style={{
        position: 'relative',
        width: '100%',
        // Edge-to-edge: cover spans the full deliverable container,
        // unlike subsequent pages which stay at 76rem.
        background: BRAND.greenDark,
        color: BRAND.surface,
        borderRadius: '1rem',
        overflow: 'hidden',
        boxShadow: '0 16px 48px rgba(31, 44, 26, 0.24)',
      }}
    >
      {/* Two soft radial glows for depth — replaces the bordered circles. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: `
            radial-gradient(ellipse 60% 80% at 88% 18%, rgba(122, 171, 107, 0.42), transparent 60%),
            radial-gradient(ellipse 50% 70% at 8% 92%, rgba(122, 171, 107, 0.28), transparent 60%)
          `,
          pointerEvents: 'none',
        }}
      />

      {/* Top brand mark — white variant on the dark hero */}
      <div style={{ position: 'relative', padding: 'clamp(1.5rem, 4vw, 2.5rem)', paddingBottom: 0 }}>
        <BrandMark size="md" variant="white" />
      </div>

      {/* Center stack */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: 'clamp(2rem, 6vw, 4rem) clamp(1.5rem, 4vw, 3rem)',
          minHeight: 'clamp(20rem, 50vh, 32rem)',
          gap: '0.875rem',
        }}
      >
        {eyebrow && (
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: BRAND.green100,
              textTransform: 'uppercase',
              letterSpacing: '0.18em',
              opacity: 0.85,
            }}
          >
            {eyebrow}
          </div>
        )}
        <AccentTitle
          text={title}
          size="lg"
          as="h1"
          onDark
          style={{ color: BRAND.surface }}
        />
      </div>

      {/* Metadata footer strip — translucent over the dark hero */}
      {((metadata && metadata.length > 0) || projectLabel) && (
        <div
          style={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
            gap: '1.25rem',
            padding: 'clamp(1.25rem, 3vw, 1.875rem) clamp(1.5rem, 4vw, 3rem)',
            borderTop: '1px solid rgba(255, 255, 255, 0.18)',
            background: 'rgba(0, 0, 0, 0.18)',
          }}
        >
          {(metadata ?? []).map(cell => (
            <div key={cell.label} style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '0.625rem',
                  fontWeight: 600,
                  color: BRAND.green100,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: '0.375rem',
                  opacity: 0.85,
                }}
              >
                {cell.label}
              </div>
              <div
                style={{
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  color: BRAND.surface,
                  overflowWrap: 'break-word',
                  wordBreak: 'break-word',
                }}
              >
                {cell.value}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── Risk cards ("Three risks that drive the timeline") ──────────────────

export type CardImpact = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface RiskCardData {
  label: string                // "RISK 01 · CRITICAL"
  impact?: CardImpact          // colour of the top border
  title: string                // "Brand direction by Week 3"
  body: string                 // paragraph(s)
}

export function RiskCards({ cards }: { cards: RiskCardData[] }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
        gap: '0.875rem',
        marginTop: '1.25rem',
      }}
    >
      {cards.map((c, i) => {
        const accent = c.impact === 'critical' ? BRAND.redInk
          : c.impact === 'high' ? BRAND.amberInk
          : c.impact === 'medium' ? '#a16207'
          : c.impact === 'low' ? BRAND.greenDark
          : BRAND.green
        return (
          <div
            key={i}
            style={{
              padding: '1rem 1.125rem',
              background: BRAND.surface,
              border: `1px solid ${BRAND.borderSubtle}`,
              borderTop: `3px solid ${accent}`,
              borderRadius: '0.625rem',
            }}
          >
            <div
              style={{
                fontSize: '0.625rem',
                fontWeight: 700,
                color: accent,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                marginBottom: '0.5rem',
              }}
            >
              {c.label}
            </div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: BRAND.ink, marginBottom: '0.5rem' }}>
              {c.title}
            </div>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: BRAND.body, lineHeight: 1.55 }}>
              {c.body}
            </p>
          </div>
        )
      })}
    </div>
  )
}

// ── Callout box ("Watch this", "Reading the chart") ────────────────────

export function Callout({
  tone = 'sage',
  title,
  children,
}: {
  tone?: 'sage' | 'amber' | 'red'
  title: string
  children: React.ReactNode
}) {
  const palette = tone === 'amber'
    ? { bg: BRAND.amberBg, border: BRAND.amberInk, ink: BRAND.amberInk }
    : tone === 'red'
    ? { bg: BRAND.redBg, border: BRAND.redInk, ink: BRAND.redInk }
    : { bg: BRAND.sageBg, border: BRAND.sageInk, ink: BRAND.sageInk }
  return (
    <div
      style={{
        marginTop: '1rem',
        padding: '0.75rem 1rem',
        background: palette.bg,
        borderLeft: `3px solid ${palette.border}`,
        borderRadius: '0 0.5rem 0.5rem 0',
        fontSize: '0.8125rem',
        color: BRAND.body,
        lineHeight: 1.55,
      }}
    >
      <strong style={{ color: palette.ink, marginRight: '0.375rem' }}>{title}</strong>
      {children}
    </div>
  )
}

// ── Legend (used by gantt sections) ──────────────────────────────────────

export interface LegendItem {
  label: string
  swatch: 'tahi' | 'client' | 'joint' | 'parallel' | 'gate' | 'critical'
}

export function LegendBar({ items }: { items: LegendItem[] }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1.25rem 1.5rem',
        alignItems: 'center',
        padding: '0.625rem 0.875rem',
        background: BRAND.band,
        border: `1px solid ${BRAND.borderSubtle}`,
        borderRadius: '0.5rem',
        marginTop: '1rem',
      }}
    >
      {items.map(it => (
        <span
          key={it.label}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.75rem',
            color: BRAND.body,
          }}
        >
          <LegendSwatch swatch={it.swatch} />
          {it.label}
        </span>
      ))}
    </div>
  )
}

function LegendSwatch({ swatch }: { swatch: LegendItem['swatch'] }) {
  if (swatch === 'gate' || swatch === 'critical') {
    return (
      <span
        style={{
          display: 'inline-block',
          width: '0.75rem',
          height: '0.75rem',
          transform: 'rotate(45deg)',
          background: 'transparent',
          border: `2px solid ${swatch === 'critical' ? BRAND.redInk : BRAND.greenDark}`,
        }}
      />
    )
  }
  const color = swatch === 'tahi' ? BRAND.greenDark
    : swatch === 'client' ? BRAND.amberInk
    : swatch === 'joint' ? '#c2a634'
    : BRAND.green100  // parallel
  return (
    <span
      style={{
        display: 'inline-block',
        width: '1.25rem',
        height: '0.5rem',
        borderRadius: '0.125rem',
        background: color,
      }}
    />
  )
}
