'use client'

/**
 * Skip-to-content link. Invisible until it receives keyboard focus,
 * then slides into view at the top-left. Lets screen-reader and
 * keyboard users jump past the sidebar and top nav straight to the
 * page content. WCAG 2.4.1 Bypass Blocks.
 */

export function SkipToContent() {
  return (
    <a
      href="#main-content"
      style={{
        position: 'fixed',
        top: '0.5rem',
        left: '0.5rem',
        zIndex: 100,
        padding: '0.625rem 1rem',
        background: 'var(--color-brand-deepest)',
        color: 'var(--color-text-on-dark)',
        fontSize: '0.8125rem',
        fontWeight: 600,
        borderRadius: 'var(--radius-md)',
        textDecoration: 'none',
        transform: 'translateY(-200%)',
        transition: 'transform var(--motion-quick, 220ms) var(--ease-out, ease-out)',
      }}
      onFocus={e => { e.currentTarget.style.transform = 'translateY(0)' }}
      onBlur={e => { e.currentTarget.style.transform = 'translateY(-200%)' }}
    >
      Skip to content
    </a>
  )
}
