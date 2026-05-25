/**
 * Shared builder primitives for proposal / contract / schedule builders.
 *
 * The proposal builder pioneered the three-column shell pattern in
 * app/(dashboard)/proposals/[id]/proposal-detail.tsx; this module lifts
 * those primitives so the contracts builder (and future builders like
 * schedules) reuse the same vocabulary without copy-paste drift.
 *
 * Design vocabulary:
 *  - Sticky top header bar with leaf-radius accents
 *  - Left navigator (~17rem) with section groups + active rail-stripe
 *  - Centre editor (fadeIn animation on switch)
 *  - Right rail (~19rem) for resource-level metadata
 *  - Mobile: rail folds under main at 1280px, full stack at 900px
 *
 * Tokens: every visible style uses CSS vars so dark mode keeps working.
 * Primitives stay layout-only - feature-specific copy lives in callers.
 */
'use client'

import React, { useEffect, useState } from 'react'
import { Check, MoreHorizontal } from 'lucide-react'

// ─── Layout shells & global builder styles ───────────────────────────────

/**
 * <BuilderShell> - the root flex column that takes over the dashboard
 * page area. Negative margins cancel the dashboard's standard padding so
 * the sticky header butts against the top nav. Wraps children with the
 * <BuilderStyles/> tag so the responsive @media rules apply once.
 */
export function BuilderShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div style={builderShellStyle} className={`tahi-builder ${className ?? ''}`}>
      <BuilderStyles />
      {children}
    </div>
  )
}

/**
 * <BuilderStyles> - keyframes + responsive grid + nav hover rules.
 * Targets `.tahi-builder` so the rules don't leak into other pages.
 */
function BuilderStyles() {
  return (
    <style>{`
      /* Single-rail layout — navigator + metadata combined in one right column.
         Used by proposals, contracts, schedules. */
      @media (max-width: 1024px) {
        .tahi-builder .tahi-builder-grid-single {
          grid-template-columns: 1fr !important;
        }
        .tahi-builder .tahi-builder-rail-wide {
          position: static !important;
          height: auto !important;
          border-left: none !important;
          border-top: 1px solid var(--color-border-subtle) !important;
          padding: 1.125rem clamp(1rem, 3vw, 2.5rem) !important;
        }
      }

      /* Mobile-overflow safety: any content inside a builder
         (gantt grids, wide tables, etc.) gets a horizontal scroll
         WITHIN its container, instead of pushing the whole page out.
         Without this, the schedule builder's gantt + RACI tables
         force horizontal scroll on the entire page on phones. */
      @media (max-width: 768px) {
        .tahi-builder {
          overflow-x: hidden;
          max-width: 100vw;
        }
        .tahi-builder main,
        .tahi-builder aside {
          min-width: 0;
          max-width: 100vw;
        }
        .tahi-builder .tahi-builder-rail-wide {
          padding: 1rem 0.875rem !important;
        }
        /* Hide the inline save indicator on phones — the header is
           already cramped with title + status pill + actions. Saves
           still fire silently; if the caller wants a visible signal
           they can listen for the savingCount transition and toast. */
        .tahi-builder .tahi-builder-save-indicator {
          display: none !important;
        }
        /* Opt-in: pages that mount the rail content inside a SlideOver
           on phones (see schedule-detail) add this class to the
           BuilderShell. Hides the inline rail entirely and collapses
           the single-rail grid to one column so the editor uses the
           full width. */
        .tahi-builder.rail-mobile-popover .tahi-builder-rail-wide {
          display: none !important;
        }
        .tahi-builder.rail-mobile-popover .tahi-builder-grid-single {
          grid-template-columns: 1fr !important;
        }
      }
      /* The Menu trigger button is mobile-only — hide it on tablet+
         where the inline rail is already visible. */
      @media (min-width: 769px) {
        .tahi-builder .schedule-mobile-rail-btn {
          display: none !important;
        }
      }

      /* Legacy three-column layout — kept for callers that still split nav and
         rail. Folds rail under main below 1280px, stacks below 900px. */
      @media (max-width: 1280px) {
        .tahi-builder .tahi-builder-grid {
          grid-template-columns: 17rem minmax(0, 1fr) !important;
        }
        .tahi-builder .tahi-builder-rail {
          position: static !important;
          height: auto !important;
          grid-column: 1 / -1 !important;
          border-left: none !important;
          border-top: 1px solid var(--color-border-subtle) !important;
          padding: 1.125rem clamp(1rem, 3vw, 2.5rem) !important;
        }
      }
      @media (max-width: 900px) {
        .tahi-builder .tahi-builder-grid {
          grid-template-columns: 1fr !important;
        }
        .tahi-builder .tahi-builder-nav {
          position: static !important;
          height: auto !important;
          max-height: none !important;
          border-right: none !important;
          border-bottom: 1px solid var(--color-border-subtle) !important;
        }
      }
      @keyframes tahiBuilderEditorFadeIn {
        from { opacity: 0; transform: translateY(0.375rem); }
        to { opacity: 1; transform: translateY(0); }
      }
      .tahi-builder .nav-item-hover:hover { background: var(--color-bg-secondary) !important; }
      .tahi-builder .nav-item-active {
        background: linear-gradient(135deg, var(--color-brand-50) 0%, transparent 100%) !important;
        color: var(--color-text) !important;
      }
      .tahi-builder .nav-item-active::before {
        content: '';
        position: absolute;
        left: 0; top: 0.625rem; bottom: 0.625rem;
        width: 0.1875rem;
        background: var(--color-brand);
        border-radius: 0 0.1875rem 0.1875rem 0;
      }
    `}</style>
  )
}

const builderShellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 'calc(100vh - 4rem)',
  marginTop: 'calc(-1 * var(--space-5))',
  marginLeft: 'calc(-1 * var(--space-5))',
  marginRight: 'calc(-1 * var(--space-5))',
}

// ─── Header / title / action toolbar ─────────────────────────────────────

export const builderHeader: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  gap: '0.875rem',
  padding: '0.625rem 1rem',
  background: 'rgba(255,255,255,0.85)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderBottom: '1px solid var(--color-border-subtle)',
}

export const builderTitleInput: React.CSSProperties = {
  display: 'block',
  width: '100%',
  fontSize: '1rem',
  fontWeight: 700,
  color: 'var(--color-text)',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: '0.375rem',
  padding: '0.25rem 0.5rem',
  outline: 'none',
  letterSpacing: '-0.01em',
  transition: 'border-color 200ms ease, background 200ms ease',
}

export const builderGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '17rem minmax(0, 1fr) 19rem',
  flex: 1,
  minHeight: 0,
}

export const builderNav: React.CSSProperties = {
  position: 'sticky',
  top: '3.625rem',
  alignSelf: 'start',
  height: 'calc(100vh - 3.625rem)',
  overflowY: 'auto',
  borderRight: '1px solid var(--color-border-subtle)',
  padding: '1rem 0.625rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
  background: 'var(--color-bg)',
}

export const builderMain: React.CSSProperties = {
  padding: 'clamp(1rem, 3vw, 2.5rem)',
  animation: 'tahiBuilderEditorFadeIn 240ms cubic-bezier(0.22, 1, 0.36, 1)',
  minWidth: 0,
}

export const builderRail: React.CSSProperties = {
  position: 'sticky',
  top: '3.625rem',
  alignSelf: 'start',
  height: 'calc(100vh - 3.625rem)',
  overflowY: 'auto',
  borderLeft: '1px solid var(--color-border-subtle)',
  padding: '1.125rem 1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  background: 'var(--color-bg)',
}

/**
 * Single-rail layout — navigator + metadata in one combined right column.
 * Use with `builderGridSingleRail` for a 2-column shell (editor + rail).
 */
export const builderGridSingleRail: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 22rem',
  flex: 1,
  minHeight: 0,
}

export const builderRailWide: React.CSSProperties = {
  position: 'sticky',
  top: '3.625rem',
  alignSelf: 'start',
  height: 'calc(100vh - 3.625rem)',
  overflowY: 'auto',
  borderLeft: '1px solid var(--color-border-subtle)',
  padding: '1.125rem 1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
  background: 'var(--color-bg)',
}

// ─── Toolbar buttons ─────────────────────────────────────────────────────

// Bake display: inline-flex + alignItems: center into the toolbar styles
// so callers can't accidentally render an icon-then-label that wraps the
// icon onto its own line. Older callsites with className="inline-flex
// items-center" continue to work — they just override with the same
// values.
export const toolbarBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.4375rem 0.75rem',
  fontSize: '0.75rem',
  fontWeight: 500,
  background: 'var(--color-bg)',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  gap: '0.375rem',
  cursor: 'pointer',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

export const toolbarPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.4375rem 0.75rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  background: 'var(--color-brand)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  gap: '0.375rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

export const railBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.4375rem 0.625rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  gap: '0.375rem',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

export const navAddBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4375rem',
  padding: '0.4375rem 0.625rem',
  marginTop: '0.25rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  background: 'transparent',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  width: '100%',
  justifyContent: 'flex-start',
  transition: 'background 160ms ease, color 160ms ease, border-color 160ms ease',
}

export const metaInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.375rem 0.5rem',
  fontSize: '0.8125rem',
  fontWeight: 500,
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text)',
}

// ─── Status pill (caller-defined palette) ────────────────────────────────

/**
 * Generic status pill style - caller passes a palette so each builder can
 * map its own status vocabulary (proposal: draft/shared/accepted; contract:
 * draft/sent/signed; etc).
 */
export function statusPillStyle(p: { bg: string; fg: string; bd: string }): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: '0.625rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    padding: '0.25rem 0.625rem',
    borderRadius: '999px',
    background: p.bg,
    color: p.fg,
    border: `1px solid ${p.bd}`,
    flexShrink: 0,
  }
}

// ─── Save indicator ──────────────────────────────────────────────────────

/**
 * <SaveIndicator> - pulsing dot while saves are in flight, then a green
 * tick + relative time once they've all settled. Re-renders on a 5s tick
 * so "Saved 12s ago" updates without external state.
 *
 * Mobile: the inline indicator is hidden via a CSS class
 * (.tahi-builder-save-indicator hidden under 640px). Saves still complete
 * silently in the background — the toolbar stays uncluttered on phones.
 * If you want a visible confirmation on mobile, wrap your builder in
 * the toast provider and pass `mobileToast` so each save fires a brief
 * "Saved" toast.
 */
export function SaveIndicator({
  savingCount,
  lastSavedAt,
}: {
  savingCount: number
  lastSavedAt: number | null
}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 5000)
    return () => clearInterval(t)
  }, [])
  if (savingCount > 0) {
    return (
      <span className="tahi-builder-save-indicator" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
        <span aria-hidden="true" style={{ width: '0.375rem', height: '0.375rem', borderRadius: '50%', background: 'var(--color-warning, #fb923c)', animation: 'pulse 1s ease-in-out infinite' }} />
        Saving...
      </span>
    )
  }
  if (!lastSavedAt) return <span style={{ width: '0.5rem' }} aria-hidden="true" />
  const elapsedSec = Math.max(1, Math.round((Date.now() - lastSavedAt) / 1000))
  const label = elapsedSec < 5 ? 'Saved' : elapsedSec < 60 ? `Saved ${elapsedSec}s ago` : `Saved ${Math.round(elapsedSec / 60)}m ago`
  return (
    <span className="tahi-builder-save-indicator" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
      <Check size={11} style={{ color: 'var(--color-brand)' }} />
      {label}
    </span>
  )
}

// ─── More menu ────────────────────────────────────────────────────────────

export interface BuilderMoreMenuItem {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/**
 * <BuilderMoreMenu> - three-dot overflow trigger + popover menu for
 * actions that don't earn a place in the toolbar (Save as template,
 * Delete, etc).
 */
export function BuilderMoreMenu({
  open,
  onToggle,
  onClose,
  items,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  items: BuilderMoreMenuItem[]
}) {
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target?.closest?.('[data-more-menu]')) onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, onClose])
  return (
    <div data-more-menu style={{ position: 'relative' }}>
      <button
        onClick={onToggle}
        aria-label="More actions"
        aria-expanded={open}
        style={{ ...toolbarBtn, padding: '0.4375rem 0.5rem' }}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.375rem)',
            right: 0,
            minWidth: '14rem',
            padding: '0.25rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 16px 40px -12px rgba(31, 44, 26, 0.18)',
            zIndex: 30,
          }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => { onClose(); if (!it.disabled) it.onClick() }}
              disabled={it.disabled}
              role="menuitem"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.625rem',
                fontSize: '0.8125rem',
                color: it.danger ? 'var(--color-danger)' : 'var(--color-text)',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: it.disabled ? 'not-allowed' : 'pointer',
                opacity: it.disabled ? 0.4 : 1,
                textAlign: 'left',
              }}
              className="nav-item-hover"
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Navigator ───────────────────────────────────────────────────────────

export function BuilderNavGroup({
  label,
  count,
  children,
}: {
  label: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 0.625rem', marginBottom: '0.4375rem' }}>
        <span style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {label}
        </span>
        {count !== undefined && count > 0 && (
          <span style={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--color-text-subtle)' }}>{count}</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
        {children}
      </div>
    </div>
  )
}

export function BuilderNavItem({
  active,
  onClick,
  number,
  icon,
  label,
  hint,
  badge,
}: {
  active: boolean
  onClick: () => void
  number?: number
  icon?: React.ReactNode
  label: string
  hint?: string
  badge?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={active ? 'nav-item-active' : 'nav-item-hover'}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        width: '100%',
        padding: '0.5rem 0.625rem',
        background: 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'var(--color-text-muted)',
        transition: 'background 160ms ease, color 160ms ease',
      }}
    >
      {number !== undefined && (
        <span style={{
          flexShrink: 0,
          width: '1.25rem',
          height: '1.25rem',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.625rem',
          fontWeight: 700,
          color: active ? '#FFFFFF' : 'var(--color-text-subtle)',
          background: active ? 'var(--color-brand)' : 'var(--color-bg-secondary)',
          border: active ? 'none' : '1px solid var(--color-border-subtle)',
          borderRadius: '0 6px 0 6px',
          letterSpacing: '-0.02em',
        }}>{number}</span>
      )}
      {icon && number === undefined && (
        <span style={{
          flexShrink: 0,
          width: '1.25rem',
          height: '1.25rem',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: active ? 'var(--color-brand)' : 'var(--color-text-subtle)',
        }}>{icon}</span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: active ? 700 : 500, color: active ? 'var(--color-text)' : 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </div>
        {hint && (
          <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {hint}
          </div>
        )}
      </span>
      {badge && (
        <span style={{ fontSize: '0.5625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-brand)', flexShrink: 0 }}>
          {badge}
        </span>
      )}
    </button>
  )
}

// ─── Right rail section ──────────────────────────────────────────────────

export function RailSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

// ─── Field group + form helpers ──────────────────────────────────────────

export function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

// ─── Slide editor shell ──────────────────────────────────────────────────

/**
 * <BuilderEditorShell> - the framed container around an editor pane.
 * Centres a max-width column, places an eyebrow + kicker title, and
 * exposes optional move-up/move-down/delete buttons aligned to the right.
 */
export function BuilderEditorShell({
  eyebrow,
  kicker,
  children,
  actions,
}: {
  eyebrow: string
  kicker: string
  children: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div style={{ maxWidth: '52rem', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {eyebrow}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)', marginTop: '0.25rem', letterSpacing: '-0.01em' }}>
            {kicker}
          </div>
        </div>
        {actions && (
          <div style={{ display: 'flex', gap: '0.375rem' }}>
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
