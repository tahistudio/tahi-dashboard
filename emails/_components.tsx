/**
 * Shared building blocks for every Tahi email template.
 *
 * Email clients are weird. We use inline styles, table-friendly layouts,
 * brand colours from the Tahi token list, and the leaf radius
 * (`0 16px 0 16px`) on primary buttons + cards. Most desktop and mobile
 * clients respect asymmetric border-radius now, so the leaf signature
 * survives. Outlook flattens it to a regular box, which still reads fine.
 *
 * The visual language mirrors the proposal viewer cover: a brand-glass
 * header band with two soft radial glows on a brand-green base, the
 * Tahi Studio wordmark in white, asymmetric leaf radius on the band's
 * bottom-right corner. Every primary CTA is a gradient leaf button.
 *
 * The `Button` here renders as an anchor styled like a button, since real
 * <button> elements are stripped or restyled by many clients.
 *
 * Brand palette (do not invent new hexes):
 *   bg          #FFFFFF                   page #f5f7f5
 *   text        #121A0F                   muted #5a6657   subtle #8a9987
 *   brand       #5A824E                   dark #425F39    light #7aab6b
 *   brand-50    #f0f7ee                   100 #dcefd8
 *   border      #d4e0d0                   subtle #e8f0e6
 */
import type { ReactNode } from 'react'
import { Container, Heading, Hr, Link, Section, Text } from '@react-email/components'
import { publicUrl } from '@/lib/app-url'

export const EMAIL_TOKENS = {
  bg: '#f5f7f5',
  surface: '#ffffff',
  text: '#121A0F',
  textMuted: '#5a6657',
  textSubtle: '#8a9987',
  brand: '#5A824E',
  brandDark: '#425F39',
  brandDeep: '#3e5a35',
  brandLight: '#7aab6b',
  brandGlow: '#93c98a',
  brand50: '#f0f7ee',
  brand100: '#dcefd8',
  brandHaze: '#dcefd8',
  border: '#d4e0d0',
  borderSubtle: '#e8f0e6',
  success: '#16a34a',
  successBg: '#f0fdf4',
  successBorder: '#bbf7d0',
  warning: '#fb923c',
  warningBg: '#fff7ed',
  warningBorder: '#fed7aa',
  danger: '#dc2626',
  dangerBg: '#fef2f2',
  dangerBorder: '#fecaca',
  info: '#1e40af',
  infoBg: '#eff6ff',
  infoBorder: '#bfdbfe',
  fontStack: 'Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  monoStack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
  leafRadius: '0 16px 0 16px',
  leafRadiusSm: '0 10px 0 10px',
  leafRadiusLg: '0 24px 0 24px',
  cardRadius: '0.75rem',
  buttonRadius: '0 16px 0 16px',
} as const

// ─── Page-level wrappers ───────────────────────────────────────────────────

export const emailBodyStyle = {
  backgroundColor: EMAIL_TOKENS.bg,
  fontFamily: EMAIL_TOKENS.fontStack,
  margin: 0,
  padding: 0,
  WebkitFontSmoothing: 'antialiased' as const,
  MozOsxFontSmoothing: 'grayscale' as const,
} as const

export const emailContainerStyle = {
  maxWidth: '600px',
  margin: '0 auto',
  padding: '1.25rem 0 2rem',
} as const

// ─── Header band ──────────────────────────────────────────────────────────
//
// 8rem-tall brand-glass band that mirrors the proposal viewer cover:
// brand-green base with two layered radial glows (warm white at top-right,
// brand-light at bottom-left). The band carries the Tahi Studio wordmark
// in white. Bottom-right leaf radius matches the rest of the brand
// signature; the top corners stay square so the band sits flush at the top
// of the email canvas. A subtle ring motif sits to the right edge to
// echo the cover's "circle background element".
//
// Outlook flattens box-shadow and gradients; a solid brand-green fallback
// keeps it on-brand there. Other clients render the full atmosphere.

const headerBandStyle = {
  position: 'relative' as const,
  margin: '0 1rem',
  padding: '1.75rem 2rem 2rem',
  height: '8rem',
  boxSizing: 'border-box' as const,
  background: [
    'radial-gradient(60% 60% at 85% 0%, rgba(255,255,255,0.22) 0%, transparent 55%)',
    'radial-gradient(80% 60% at 0% 110%, rgba(122,170,114,0.45) 0%, transparent 60%)',
    'linear-gradient(135deg, #5A824E 0%, #3e5a35 100%)',
  ].join(', '),
  backgroundColor: EMAIL_TOKENS.brand,
  borderRadius: '0 0 16px 0',
  boxShadow: '0 12px 28px -16px rgba(31,44,26,0.32)',
  overflow: 'hidden' as const,
} as const

const headerInnerStyle = {
  position: 'relative' as const,
  zIndex: 2,
  display: 'flex' as const,
  flexDirection: 'column' as const,
  alignItems: 'flex-start' as const,
  justifyContent: 'center' as const,
  height: '100%',
} as const

const headerWordmarkStyle = {
  display: 'inline-flex' as const,
  alignItems: 'center' as const,
  gap: '0.625rem',
  margin: 0,
} as const

const headerWordmarkTextStyle = {
  color: '#ffffff',
  fontSize: '1.0625rem',
  fontWeight: 800,
  letterSpacing: '-0.015em',
  margin: 0,
  textShadow: '0 1px 2px rgba(0,0,0,0.18)',
} as const

const headerEyebrowStyle = {
  color: 'rgba(255,255,255,0.86)',
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase' as const,
  margin: '0.625rem 0 0',
} as const

// CSS-rendered ring on the right edge that echoes the proposal cover's
// "circle background element". Pure CSS so even image-blocked email
// clients still see the depth.
const headerRingStyle = {
  position: 'absolute' as const,
  right: '-3rem',
  top: '-3rem',
  width: '10.5rem',
  height: '10.5rem',
  borderRadius: '50%',
  border: '1px solid rgba(255,255,255,0.22)',
  boxShadow: 'inset 0 0 0 1rem rgba(255,255,255,0.05)',
  pointerEvents: 'none' as const,
  zIndex: 1,
} as const

/**
 * <EmailHeader> — brand-glass band with the Tahi Studio wordmark.
 *
 * Use one per template, sitting at the very top of the shell. The optional
 * `eyebrow` line sits under the wordmark in low-contrast caps, e.g.
 * "A contract for your signature".
 */
export function EmailHeader({ eyebrow }: { eyebrow?: string }) {
  return (
    <Section style={headerBandStyle}>
      <span aria-hidden="true" style={headerRingStyle} />
      <div style={headerInnerStyle}>
        <div style={headerWordmarkStyle}>
          {/* Text-only wordmark. The previous design used the logo image
              for "Tahi" plus a text span for "Tahi Studio" → ended up
              rendering "Tahi Tahi Studio". The asset at /tahi-logo.png
              is the "Tahi" mark only (not the full lockup), so dropping
              it and rendering the wordmark as text gives the cleanest
              result across every email client. */}
          <span style={headerWordmarkTextStyle}>Tahi Studio</span>
        </div>
        {eyebrow && <Text style={headerEyebrowStyle}>{eyebrow}</Text>}
      </div>
    </Section>
  )
}

// ─── Surface card — the main content panel ────────────────────────────────

const cardSurfaceStyle = {
  backgroundColor: EMAIL_TOKENS.surface,
  borderRadius: EMAIL_TOKENS.cardRadius,
  border: `1px solid ${EMAIL_TOKENS.borderSubtle}`,
  padding: '2rem',
  margin: '-1.25rem 1rem 0',
  position: 'relative' as const,
  zIndex: 2,
  boxShadow: '0 1px 2px rgba(31, 44, 26, 0.04), 0 12px 32px rgba(31, 44, 26, 0.06)',
} as const

export function EmailCard({ children }: { children: ReactNode }) {
  return <Section style={cardSurfaceStyle}>{children}</Section>
}

// ─── Hero greeting + heading inside the card ──────────────────────────────

const headingStyle = {
  color: EMAIL_TOKENS.text,
  fontSize: '2rem',
  fontWeight: 800,
  lineHeight: 1.1,
  letterSpacing: '-0.025em',
  margin: '0 0 0.75rem',
} as const

const subheadingStyle = {
  color: EMAIL_TOKENS.brand,
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  margin: '0 0 0.625rem',
} as const

export function EmailEyebrow({ children }: { children: ReactNode }) {
  return <Text style={subheadingStyle}>{children}</Text>
}

export function EmailHeading({ children }: { children: ReactNode }) {
  return <Heading as="h2" style={headingStyle}>{children}</Heading>
}

// ─── Body text ────────────────────────────────────────────────────────────

const bodyTextStyle = {
  color: EMAIL_TOKENS.textMuted,
  fontSize: '0.9375rem',
  lineHeight: 1.65,
  margin: '0 0 1rem',
} as const

const subtleTextStyle = {
  color: EMAIL_TOKENS.textSubtle,
  fontSize: '0.8125rem',
  lineHeight: 1.55,
  margin: '0',
} as const

export function EmailParagraph({ children, subtle = false }: { children: ReactNode; subtle?: boolean }) {
  return <Text style={subtle ? subtleTextStyle : bodyTextStyle}>{children}</Text>
}

// ─── Detail card — leaf-radius brand-50 surface with label/value rows ─────
//
// Premium upgrade: an asymmetric leaf-radius surface, brand-tinted accent
// stripe down the left edge, generous internal padding, and a 2px brand
// border so the card reads as a real "frame" rather than a wash. Inline
// styles are layered through nested tables so most email clients pick up
// the visual hierarchy even when they strip backgrounds.

const detailCardStyle = {
  position: 'relative' as const,
  background: EMAIL_TOKENS.brand50,
  border: `1.5px solid ${EMAIL_TOKENS.brand100}`,
  borderLeft: `4px solid ${EMAIL_TOKENS.brand}`,
  borderRadius: EMAIL_TOKENS.leafRadius,
  padding: '1.5rem 1.5rem 1.375rem 1.5rem',
  margin: '1.5rem 0',
} as const

const detailLabelStyle = {
  color: EMAIL_TOKENS.textSubtle,
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
  margin: '0 0 0.1875rem',
} as const

const detailLabelStyleSpaced = {
  ...detailLabelStyle,
  marginTop: '1rem',
} as const

const detailValueStyle = {
  color: EMAIL_TOKENS.text,
  fontSize: '1.0625rem',
  fontWeight: 700,
  lineHeight: 1.4,
  letterSpacing: '-0.005em',
  margin: 0,
} as const

const detailValueMutedStyle = {
  color: EMAIL_TOKENS.text,
  fontSize: '0.9375rem',
  fontWeight: 500,
  lineHeight: 1.4,
  margin: 0,
} as const

/**
 * <DetailCard> — brand-50 leaf-radius card with a brand accent stripe on
 * the left edge. Children should be a series of <DetailRow> entries.
 */
export function DetailCard({ children }: { children: ReactNode }) {
  return <Section style={detailCardStyle}>{children}</Section>
}

export function DetailRow({ label, value, hero = false, first = false, mono = false }: {
  label: string
  value: ReactNode
  hero?: boolean
  first?: boolean
  mono?: boolean
}) {
  const valueStyle: React.CSSProperties = {
    ...(hero ? detailValueStyle : detailValueMutedStyle),
    ...(mono ? { fontFamily: EMAIL_TOKENS.monoStack, letterSpacing: '0.02em' } : {}),
  }
  return (
    <>
      <Text style={first ? detailLabelStyle : detailLabelStyleSpaced}>{label}</Text>
      <Text style={valueStyle}>{value}</Text>
    </>
  )
}

// ─── Custom message block — used when sender attaches a personal note ─────

const messageBlockStyle = {
  background: EMAIL_TOKENS.surface,
  border: `1px dashed ${EMAIL_TOKENS.border}`,
  borderRadius: '0.625rem',
  padding: '1rem 1.125rem',
  margin: '1.25rem 0',
} as const

const messageBlockLabelStyle = {
  color: EMAIL_TOKENS.brand,
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase' as const,
  margin: '0 0 0.375rem',
} as const

const messageBlockBodyStyle = {
  color: EMAIL_TOKENS.text,
  fontSize: '0.9375rem',
  lineHeight: 1.6,
  margin: 0,
  whiteSpace: 'pre-wrap' as const,
  fontStyle: 'italic' as const,
} as const

export function MessageBlock({ fromName, message }: { fromName: string; message: string }) {
  return (
    <Section style={messageBlockStyle}>
      <Text style={messageBlockLabelStyle}>A note from {fromName}</Text>
      <Text style={messageBlockBodyStyle}>{message}</Text>
    </Section>
  )
}

// ─── Buttons ──────────────────────────────────────────────────────────────
//
// The primary CTA is the moment that earns the email. Bigger padding,
// gradient brand surface, leaf radius, soft brand-glow shadow. Outlook
// strips gradients, so we set both `backgroundColor` (solid brand) and
// `background` (gradient) — the cascade lands on the gradient where
// supported and the solid colour everywhere else.

const primaryButtonBase = {
  display: 'inline-block' as const,
  fontSize: '1rem',
  fontWeight: 700,
  letterSpacing: '-0.005em',
  padding: '1rem 2.25rem',
  borderRadius: EMAIL_TOKENS.buttonRadius,
  textDecoration: 'none',
  boxShadow: '0 8px 22px -6px rgba(90, 130, 78, 0.45), 0 2px 4px rgba(31, 44, 26, 0.08)',
  textAlign: 'center' as const,
  minWidth: '12rem',
} as const

export function PrimaryButton({ href, children, variant = 'brand' }: {
  href: string
  children: ReactNode
  variant?: 'brand' | 'warning' | 'danger'
}) {
  const palette =
    variant === 'warning'
      ? {
          bg: EMAIL_TOKENS.warning,
          gradient: 'linear-gradient(135deg, #fbbf24 0%, #fb923c 100%)',
          color: '#ffffff',
          glow: '0 8px 22px -6px rgba(251, 146, 60, 0.45), 0 2px 4px rgba(31, 44, 26, 0.08)',
        }
      : variant === 'danger'
        ? {
            bg: EMAIL_TOKENS.danger,
            gradient: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
            color: '#ffffff',
            glow: '0 8px 22px -6px rgba(220, 38, 38, 0.45), 0 2px 4px rgba(31, 44, 26, 0.08)',
          }
        : {
            bg: EMAIL_TOKENS.brand,
            gradient: 'linear-gradient(135deg, #5A824E 0%, #425F39 100%)',
            color: '#ffffff',
            glow: '0 8px 22px -6px rgba(90, 130, 78, 0.45), 0 2px 4px rgba(31, 44, 26, 0.08)',
          }

  return (
    <Section style={{ textAlign: 'center' as const, margin: '1.75rem 0 1rem' }}>
      <Link
        href={href}
        style={{
          ...primaryButtonBase,
          backgroundColor: palette.bg,
          background: palette.gradient,
          color: palette.color,
          boxShadow: palette.glow,
        }}
      >
        {children}
      </Link>
    </Section>
  )
}

const secondaryButtonBase = {
  display: 'inline-block',
  fontSize: '0.875rem',
  fontWeight: 600,
  padding: '0.75rem 1.25rem',
  borderRadius: '0.5rem',
  textDecoration: 'none',
  backgroundColor: EMAIL_TOKENS.surface,
  color: EMAIL_TOKENS.textMuted,
  border: `1px solid ${EMAIL_TOKENS.border}`,
} as const

export function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} style={secondaryButtonBase}>{children}</Link>
}

// ─── Footnote — small, low-contrast helper text under the CTA ─────────────
//
// Upgrade: instead of loose plain text, the footnote now sits on a
// brand-50 leaf-radius surface so the cryptographic detail reads as a
// considered footer rather than fine-print noise. Monospace ranges (e.g.
// "SHA-256") are caller's responsibility: pass them as <code> children.

const footnoteStyle = {
  color: EMAIL_TOKENS.textMuted,
  fontSize: '0.75rem',
  lineHeight: 1.6,
  margin: '1.5rem 0 0',
  textAlign: 'left' as const,
} as const

const footnoteSurfaceStyle = {
  background: EMAIL_TOKENS.brand50,
  border: `1px solid ${EMAIL_TOKENS.brand100}`,
  borderRadius: EMAIL_TOKENS.leafRadiusSm,
  padding: '0.875rem 1rem',
  margin: '1.5rem 0 0',
} as const

const footnoteSurfaceTextStyle = {
  ...footnoteStyle,
  margin: 0,
} as const

export function EmailFootnote({ children, framed = false }: { children: ReactNode; framed?: boolean }) {
  if (framed) {
    return (
      <Section style={footnoteSurfaceStyle}>
        <Text style={footnoteSurfaceTextStyle}>{children}</Text>
      </Section>
    )
  }
  return <Text style={footnoteStyle}>{children}</Text>
}

/** Inline monospace span for cryptographic identifiers, IDs etc inside a footnote. */
export function Mono({ children }: { children: ReactNode }) {
  return (
    <span style={{
      fontFamily: EMAIL_TOKENS.monoStack,
      fontSize: '0.75rem',
      letterSpacing: '0.02em',
      color: EMAIL_TOKENS.brandDark,
      fontWeight: 600,
    }}>
      {children}
    </span>
  )
}

// ─── Footer ───────────────────────────────────────────────────────────────
//
// Mirrored brand bar at the bottom for symmetry with the header band.
// Footer typography elevated: studio name in the brand-dark voice, address
// + contact line in muted, unsubscribe in subtle.

const footerBarStyle = {
  height: '0.5rem',
  background: 'linear-gradient(90deg, #7aab6b 0%, #5A824E 50%, #425F39 100%)',
  borderRadius: '16px 0 16px 0',
  margin: '0 1rem 1rem',
} as const

const hrStyle = {
  borderColor: EMAIL_TOKENS.borderSubtle,
  borderTop: `1px solid ${EMAIL_TOKENS.borderSubtle}`,
  borderBottom: 0,
  margin: '2rem 1rem 1.25rem',
} as const

const footerStyle = {
  padding: '0 2rem 1rem',
  textAlign: 'center' as const,
} as const

const footerStudioStyle = {
  color: EMAIL_TOKENS.brandDark,
  fontSize: '0.875rem',
  fontWeight: 800,
  letterSpacing: '-0.015em',
  margin: '0 0 0.25rem',
} as const

const footerLineStyle = {
  color: EMAIL_TOKENS.textSubtle,
  fontSize: '0.75rem',
  lineHeight: 1.6,
  margin: '0.125rem 0',
} as const

const footerLinkStyle = {
  color: EMAIL_TOKENS.textMuted,
  textDecoration: 'underline',
  fontWeight: 600,
} as const

/**
 * <EmailFooter> — single source of truth for our sign-off block.
 *
 * Studio wordmark (brand-dark, prominent), tagline, contact + site links,
 * optional unsubscribe, and a closing brand bar that mirrors the header.
 */
export function EmailFooter({ unsubscribeUrl }: { unsubscribeUrl?: string }) {
  return (
    <>
      <Hr style={hrStyle} />
      <Section style={footerStyle}>
        <Text style={footerStudioStyle}>Tahi Studio</Text>
        <Text style={footerLineStyle}>
          Founder-led design and development studio
        </Text>
        <Text style={{ ...footerLineStyle, marginTop: '0.5rem' }}>
          <Link href="mailto:business@tahi.studio" style={footerLinkStyle}>business@tahi.studio</Link>
          {' '}·{' '}
          <Link href="https://tahi.studio" style={footerLinkStyle}>tahi.studio</Link>
        </Text>
        {unsubscribeUrl && (
          <Text style={{ ...footerLineStyle, marginTop: '0.625rem' }}>
            <Link href={unsubscribeUrl} style={{ color: EMAIL_TOKENS.textSubtle, textDecoration: 'underline' }}>
              Unsubscribe
            </Link>
          </Text>
        )}
      </Section>
      <div style={footerBarStyle} />
    </>
  )
}

// ─── Banner — pill-shaped status chip ─────────────────────────────────────
//
// Upgrade: was a full-width status bar. Now reads as a tight, centred pill
// chip with leaf radius and brand-tinted surface. Great for "Confidential"
// or "Delivered" callouts that should sit *inside* the message, not above
// it like a system alert.

const bannerWrapStyle = {
  textAlign: 'center' as const,
  margin: '0 0 1.5rem',
} as const

const bannerPillStyle = {
  display: 'inline-block' as const,
  borderRadius: EMAIL_TOKENS.leafRadiusSm,
  padding: '0.4375rem 0.875rem',
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
  margin: 0,
} as const

export function EmailBanner({ kind, children }: {
  kind: 'success' | 'warning' | 'danger' | 'info'
  children: ReactNode
}) {
  const palette = (
    kind === 'success' ? { bg: EMAIL_TOKENS.successBg, color: EMAIL_TOKENS.success, border: EMAIL_TOKENS.successBorder } :
    kind === 'warning' ? { bg: EMAIL_TOKENS.warningBg, color: EMAIL_TOKENS.warning, border: EMAIL_TOKENS.warningBorder } :
    kind === 'danger'  ? { bg: EMAIL_TOKENS.dangerBg,  color: EMAIL_TOKENS.danger,  border: EMAIL_TOKENS.dangerBorder } :
                         { bg: EMAIL_TOKENS.infoBg,    color: EMAIL_TOKENS.info,    border: EMAIL_TOKENS.infoBorder }
  )
  return (
    <Section style={bannerWrapStyle}>
      <Text style={{
        ...bannerPillStyle,
        background: palette.bg,
        color: palette.color,
        border: `1px solid ${palette.border}`,
      }}>
        {children}
      </Text>
    </Section>
  )
}

// ─── Use container so consumers don't need to import it themselves ────────

export function EmailShell({ children }: { children: ReactNode }) {
  return <Container style={emailContainerStyle}>{children}</Container>
}
