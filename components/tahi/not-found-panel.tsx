/**
 * <NotFoundPanel>. The branded 404 body, shared by the two not-found
 * boundaries: app/not-found.tsx (an unmatched URL, which renders under the
 * root layout only, so there is no sidebar) and app/(dashboard)/not-found.tsx
 * (a notFound() thrown from inside the dashboard, which renders inside the
 * shell). Before this, a mistyped URL in a signed-in session handed back the
 * raw Next.js 404: black on white, no brand, no way back.
 *
 * Server component, tokens only, so it is correct in dark mode without a
 * second set of rules. `standalone` adds the full-viewport centring the
 * sidebar-free boundary needs; inside the shell the page wrapper already owns
 * the width.
 */

import Link from 'next/link'
import { LeafGlyph } from '@/components/tahi/tahi-glyphs'

export function NotFoundPanel({ standalone = false }: { standalone?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: '1rem',
        padding: '3rem 1.5rem',
        minHeight: standalone ? '100vh' : '60vh',
        background: standalone ? 'var(--color-bg-cream)' : 'transparent',
        color: 'var(--color-text)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '3.5rem',
          height: '3.5rem',
          borderRadius: 'var(--radius-leaf)',
          background: 'var(--color-brand-50)',
          border: '1px solid var(--color-brand-100)',
        }}
      >
        <LeafGlyph size={22} />
      </span>

      <h1 style={{ margin: 0, fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
        We could not find that page
      </h1>

      <p
        style={{
          margin: 0,
          maxWidth: '28rem',
          fontSize: '0.875rem',
          lineHeight: 1.6,
          color: 'var(--color-text-muted)',
        }}
      >
        The link may be out of date, or the page may have moved. Nothing is broken on
        your account.
      </p>

      <Link
        href="/overview"
        className="tahi-focus-ring not-found-cta"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '2.75rem',
          marginTop: '0.5rem',
          padding: '0 1.25rem',
          borderRadius: 'var(--radius-leaf-sm)',
          background: 'var(--color-brand)',
          color: '#ffffff',
          fontSize: '0.875rem',
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        Back to Overview
      </Link>
    </div>
  )
}
