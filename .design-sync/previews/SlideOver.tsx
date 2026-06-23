/**
 * SlideOver renders via position:fixed (full viewport overlay + panel).
 * When open={true}, the backdrop and panel mount at z-index 60/70,
 * outside and on top of the preview card container entirely.
 *
 * Approach: render the panel chrome inline using plain divs that match
 * the SlideOver panel layout exactly (header, body, footer tokens/styles).
 * The actual <SlideOver open={true}> component CAN be mounted -- it will
 * render but the screenshot will capture the fixed-positioned overlay
 * covering the whole page, not scoped to the card.
 *
 * We therefore render both:
 *   1. A static inline panel replica (always visible in the card bounds)
 *   2. The live component mounted open (for orchestrator override capture)
 *
 * cfg.overrides.SlideOver = { "viewport": "900x700", "cardMode": "fullpage" }
 * is recommended so the live overlay is captured properly.
 */

import { SlideOver, TahiButton } from 'tahi-dashboard'

const SparklesIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3L13.5 8.5H19L14.5 11.5L16 17L12 14L8 17L9.5 11.5L5 8.5H10.5Z" />
  </svg>
)

const FileIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
)

/** Static inline panel replica -- always visible within card bounds */
export const InlinePanelStatic = () => (
  <div style={{ padding: '1.25rem', background: 'var(--color-bg-cream)', minWidth: '26rem' }}>
    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', margin: '0 0 0.75rem', fontWeight: 500 }}>
      SlideOver (inline replica -- live component renders outside card via fixed portal)
    </p>
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
      display: 'flex',
      flexDirection: 'column',
      maxWidth: '28rem',
      boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '1rem 1.25rem',
        borderBottom: '1px solid var(--color-border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
      }}>
        <div style={{
          width: '2rem',
          height: '2rem',
          borderRadius: 'var(--radius-leaf-sm)',
          background: 'var(--color-brand-50)',
          color: 'var(--color-brand)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <SparklesIcon />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)', letterSpacing: '-0.005em' }}>
            Draft request with AI
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>
            Propel Digital
          </div>
        </div>
        <div style={{ width: '2rem', height: '2rem', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </div>
      </div>
      {/* Body */}
      <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: '0.375rem' }}>
            What do you need?
          </label>
          <div style={{
            padding: '0.625rem 0.75rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            fontSize: '0.8125rem',
            color: 'var(--color-text)',
            background: 'var(--color-bg)',
            lineHeight: 1.5,
          }}>
            Redesign the pricing page to match the new brand direction Staci signed off on. Three tiers, annual toggle, FAQ section.
          </div>
        </div>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: '0.375rem' }}>
            Assign to
          </label>
          <div style={{
            padding: '0.625rem 0.75rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border)',
            fontSize: '0.8125rem',
            color: 'var(--color-text-muted)',
            background: 'var(--color-bg)',
          }}>
            Staci Bonnie
          </div>
        </div>
        <div style={{ padding: '0.75rem', background: 'var(--color-brand-50)', borderRadius: 'var(--radius-sm)', fontSize: '0.8125rem', color: 'var(--color-brand-dark)', lineHeight: 1.5 }}>
          AI suggested: "Pricing page redesign -- 3 tiers". Estimated 2 large track slots.
        </div>
      </div>
      {/* Footer */}
      <div style={{
        padding: '0.875rem 1.25rem',
        borderTop: '1px solid var(--color-border-subtle)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        background: 'var(--color-bg)',
      }}>
        <TahiButton size="sm">Create request</TahiButton>
        <TahiButton size="sm" variant="ghost">Cancel</TahiButton>
      </div>
    </div>
  </div>
)

/** Live SlideOver mounted open -- renders outside card via position:fixed portal */
export const LiveOpenPanel = () => (
  <div style={{ padding: '1.25rem', background: 'var(--color-bg-cream)', minHeight: '200px' }}>
    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', margin: '0 0 0.5rem', fontWeight: 500 }}>
      Live SlideOver (panel renders at viewport right via fixed position)
    </p>
    <SlideOver
      open={true}
      onClose={() => {}}
      title="New contract"
      subtitle="Aotea Credit Union"
      icon={<FileIcon />}
      maxWidth="26rem"
    >
      <SlideOver.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: '0.375rem' }}>
              Contract type
            </label>
            <div style={{ padding: '0.625rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: '0.8125rem', color: 'var(--color-text)', background: 'var(--color-bg)' }}>
              MSA -- Master Service Agreement
            </div>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: '0.375rem' }}>
              Signatory
            </label>
            <div style={{ padding: '0.625rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: '0.8125rem', color: 'var(--color-text)', background: 'var(--color-bg)' }}>
              Sarah Ngata, CEO
            </div>
          </div>
          <div>
            <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', display: 'block', marginBottom: '0.375rem' }}>
              Start date
            </label>
            <div style={{ padding: '0.625rem 0.75rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: '0.8125rem', color: 'var(--color-text)', background: 'var(--color-bg)' }}>
              1 July 2026
            </div>
          </div>
        </div>
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton size="sm">Send contract</TahiButton>
        <TahiButton size="sm" variant="ghost">Save draft</TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  </div>
)
