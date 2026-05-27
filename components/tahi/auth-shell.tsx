'use client'

/**
 * <AuthShell> — premium split-panel layout for Tahi sign-in / sign-up.
 *
 * Desktop: 45/55 split. Brand panel left (gradient surface, big icon mark,
 * headline + three value props with leaf bullets, decorative oversized
 * leaf in the bottom-right corner). Form panel right with the Clerk
 * widget centred, brand-locked theming, and a switch-to-other-auth link
 * below.
 *
 * Mobile: brand panel collapses to a compact top band with the icon
 * mark + tagline. Form panel takes the full width below.
 *
 * Dark mode safe — surfaces, text, decorative gradient all use design
 * tokens. The decorative leaf in the corner uses brand-light at low
 * opacity so it reads on both light and dark themes.
 */

import * as React from 'react'
import Link from 'next/link'
import { LeafGlyph, TahiStudioWordmark } from '@/components/tahi/tahi-glyphs'

interface ValueProp {
  title: string
  body: string
}

interface AuthShellProps {
  /** Headline on the right form panel ("Welcome back", "Create your account"). */
  title: string
  /** One-line subheading under the title. */
  subtitle: string
  /** Brand-side headline ("One dashboard. Every part of your studio."). */
  marketingHeadline: string
  /** Three short value props rendered with leaf bullets. */
  valueProps: ValueProp[]
  /** Footer prompt label (e.g. "New to Tahi?" or "Already have an account?"). */
  footerPrompt: string
  /** Footer link text + href. */
  footerLinkLabel: string
  footerLinkHref: string
  /** Clerk widget. */
  children: React.ReactNode
}

export function AuthShell({
  title,
  subtitle,
  marketingHeadline,
  valueProps,
  footerPrompt,
  footerLinkLabel,
  footerLinkHref,
  children,
}: AuthShellProps) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'row',
        background: 'var(--color-bg)',
      }}
      className="tahi-auth-shell"
    >
      <BrandPanel headline={marketingHeadline} valueProps={valueProps} />

      <main
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem 1.5rem',
          background: 'var(--color-bg)',
        }}
      >
        <div style={{ width: '100%', maxWidth: '26rem' }}>
          {/* Mobile-only compact brand header */}
          <div
            className="tahi-auth-mobile-brand"
            style={{
              display: 'none',
              marginBottom: '2rem',
              textAlign: 'center',
              color: 'var(--color-text)',
            }}
          >
            <TahiStudioWordmark height={28} />
          </div>

          <header style={{ marginBottom: '1.5rem', textAlign: 'center' }}>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                letterSpacing: '-0.015em',
                color: 'var(--color-text)',
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              {title}
            </h1>
            <p
              style={{
                marginTop: '0.5rem',
                fontSize: '0.875rem',
                color: 'var(--color-text-muted)',
                lineHeight: 1.5,
              }}
            >
              {subtitle}
            </p>
          </header>

          <div>{children}</div>

          <footer
            style={{
              marginTop: '1.5rem',
              fontSize: '0.8125rem',
              color: 'var(--color-text-muted)',
              textAlign: 'center',
            }}
          >
            <span>{footerPrompt} </span>
            <Link
              href={footerLinkHref}
              style={{
                color: 'var(--color-brand)',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              {footerLinkLabel}
            </Link>
          </footer>
        </div>
      </main>

      <style>{`
        @media (max-width: 56rem) {
          .tahi-auth-shell .tahi-auth-brand-panel {
            display: none !important;
            width: 0 !important;
            min-width: 0 !important;
          }
          .tahi-auth-shell .tahi-auth-mobile-brand {
            display: block !important;
          }
        }
      `}</style>
    </div>
  )
}

function BrandPanel({ headline, valueProps }: { headline: string; valueProps: ValueProp[] }) {
  return (
    <aside
      className="tahi-auth-brand-panel"
      aria-hidden="true"
      style={{
        position: 'relative',
        width: '45%',
        minWidth: '24rem',
        padding: '3rem 3rem 4rem',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: 'linear-gradient(160deg, var(--color-brand-50) 0%, var(--color-brand-100) 100%)',
        overflow: 'hidden',
      }}
    >
      {/* Decorative oversized leaf in the bottom-right corner. */}
      <div
        style={{
          position: 'absolute',
          right: '-4rem',
          bottom: '-4rem',
          opacity: 0.18,
          pointerEvents: 'none',
        }}
      >
        <LeafGlyph size={420} />
      </div>

      {/* Top: brand lockup */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          zIndex: 1,
          color: 'var(--color-brand-deep, #2A3626)',
        }}
      >
        <TahiStudioWordmark height={32} />
      </div>

      {/* Middle: marketing headline + value props */}
      <div style={{ position: 'relative', zIndex: 1, maxWidth: '28rem' }}>
        <h2
          style={{
            fontSize: '2rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: 'var(--color-brand-deepest, #1E3019)',
            margin: 0,
            lineHeight: 1.15,
          }}
        >
          {headline}
        </h2>

        <ul
          style={{
            marginTop: '2rem',
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          {valueProps.map(vp => (
            <li
              key={vp.title}
              style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem' }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: '1.75rem',
                  height: '1.75rem',
                  borderRadius: 'var(--radius-leaf-sm)',
                  background: 'rgba(255, 255, 255, 0.6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <LeafGlyph size={14} />
              </span>
              <div>
                <div
                  style={{
                    fontSize: '0.9375rem',
                    fontWeight: 600,
                    color: 'var(--color-brand-deep, #2A3626)',
                    lineHeight: 1.3,
                  }}
                >
                  {vp.title}
                </div>
                <div
                  style={{
                    marginTop: '0.1875rem',
                    fontSize: '0.8125rem',
                    color: 'var(--color-brand-darker, #354D2E)',
                    lineHeight: 1.5,
                    opacity: 0.85,
                  }}
                >
                  {vp.body}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Bottom: subtle attribution / tagline */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          fontSize: '0.75rem',
          color: 'var(--color-brand-darker, #354D2E)',
          opacity: 0.7,
        }}
      >
        Designed in Aotearoa, New Zealand
      </div>
    </aside>
  )
}

/**
 * Shared Clerk appearance preset for both sign-in and sign-up.
 * Strips Clerk's default chrome (its own card, header, branding) so
 * our shell owns the layout, while keeping the form fields legible
 * and theming the primary button + accent links to brand-green.
 */
export const tahiClerkAppearance = {
  elements: {
    rootBox: 'w-full',
    // Strip Clerk's card: our shell already provides the canvas.
    card: 'shadow-none bg-transparent p-0 border-0',
    headerTitle: 'hidden',
    headerSubtitle: 'hidden',
    // Hide Clerk's own footer (we render a custom Link below).
    footer: 'hidden',
    // Inputs.
    formFieldInput:
      'rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] focus:border-[var(--color-brand)] focus:ring-2 focus:ring-[var(--color-brand-100)]',
    formFieldLabel: 'text-[var(--color-text-muted)] text-xs font-semibold uppercase tracking-wider',
    // Primary CTA — leaf-radius, brand colour, hover deepens.
    formButtonPrimary:
      'bg-[var(--color-brand)] hover:bg-[var(--color-brand-dark)] text-white font-semibold rounded-[var(--radius-leaf-sm)] shadow-none normal-case tracking-normal text-sm',
    // Social + secondary buttons.
    socialButtonsBlockButton:
      'border border-[var(--color-border)] bg-[var(--color-bg)] hover:bg-[var(--color-bg-secondary)] text-[var(--color-text)] rounded-[var(--radius-md)]',
    socialButtonsBlockButtonText: 'text-[var(--color-text)] font-medium',
    // Divider.
    dividerLine: 'bg-[var(--color-border-subtle)]',
    dividerText: 'text-[var(--color-text-subtle)] text-xs uppercase tracking-wider',
    // Misc accent links inside Clerk's body (forgot password, etc).
    formResendCodeLink: 'text-[var(--color-brand)] hover:text-[var(--color-brand-dark)]',
    identityPreviewEditButton: 'text-[var(--color-brand)]',
    formFieldAction: 'text-[var(--color-brand)] hover:text-[var(--color-brand-dark)]',
    alternativeMethodsBlockButton:
      'border border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)] text-[var(--color-text)] rounded-[var(--radius-md)]',
  },
} as const
