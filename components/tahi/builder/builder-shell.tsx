/**
 * Builder shell primitives — shared across the proposal, schedule, and
 * contract editors. They give every long-form authoring surface in the
 * dashboard the same vocabulary:
 *
 *   - Sticky header with inline title, status pill, save indicator,
 *     publish/preview/more actions.
 *   - Three-column shell (left navigator, centre editor, right rail) that
 *     gracefully collapses below 1280px and stacks below 900px.
 *   - Brand-tinted active states with a 3px brand stripe on the navigator.
 *   - Reusable nav groups, nav items, more menus, and section-of-rail
 *     scaffolding.
 *
 * Keep the visual vocabulary consistent: leaf radius for slide numbers,
 * rem sizing only, CSS var references for tokens, no em/en dashes.
 */
'use client'

import React, { useEffect, useState } from 'react'
import { Check, MoreHorizontal } from 'lucide-react'

// ─── Shell layout ───────────────────────────────────────────────────────

export const builderShell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 'calc(100vh - 4rem)',
  marginTop: 'calc(-1 * var(--space-5))',
  marginLeft: 'calc(-1 * var(--space-5))',
  marginRight: 'calc(-1 * var(--space-5))',
}

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
  animation: 'editorFadeIn 240ms cubic-bezier(0.22, 1, 0.36, 1)',
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

export const toolbarBtn: React.CSSProperties = {
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
}

export const toolbarPrimary: React.CSSProperties = {
  padding: '0.4375rem 0.75rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  background: 'var(--color-brand)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  gap: '0.375rem',
  cursor: 'pointer',
}

export const railBtn: React.CSSProperties = {
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

// ─── Shared CSS injected once per builder page ──────────────────────────

/**
 * <BuilderStyles> — drops the shared keyframes, hover, and active classes
 * into the page. Include once per builder. Same styles every detail page
 * uses so nav-item-active/nav-item-hover behave identically.
 *
 * Class names targeted:
 *   - .builder-grid        → grid containing nav/main/rail
 *   - .builder-nav         → left nav (sticky on desktop)
 *   - .builder-rail        → right rail (sticky on desktop)
 *   - .nav-item-hover      → applied to interactive nav rows
 *   - .nav-item-active     → applied to the currently-selected row
 */
export function BuilderStyles() {
  return (
    <style>{`
      @media (max-width: 1280px) {
        .builder-grid {
          grid-template-columns: 17rem minmax(0, 1fr) !important;
        }
        .builder-rail {
          position: static !important;
          height: auto !important;
          grid-column: 1 / -1 !important;
          border-left: none !important;
          border-top: 1px solid var(--color-border-subtle) !important;
          padding: 1.125rem clamp(1rem, 3vw, 2.5rem) !important;
        }
      }
      @media (max-width: 900px) {
        .builder-grid {
          grid-template-columns: 1fr !important;
        }
        .builder-nav {
          position: static !important;
          height: auto !important;
          max-height: none !important;
          border-right: none !important;
          border-bottom: 1px solid var(--color-border-subtle) !important;
        }
      }
      @keyframes editorFadeIn {
        from { opacity: 0; transform: translateY(0.375rem); }
        to { opacity: 1; transform: translateY(0); }
      }
      .nav-item-hover:hover { background: var(--color-bg-secondary) !important; }
      .nav-item-active {
        background: linear-gradient(135deg, var(--color-brand-50) 0%, transparent 100%) !important;
        color: var(--color-text) !important;
      }
      .nav-item-active::before {
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

// ─── Status pill ────────────────────────────────────────────────────────

/**
 * Shared status pill palette. Pass any status label and it falls back to
 * the draft palette if unknown. Keep this in sync between proposals,
 * schedules, and contracts so every builder reads the same.
 */
export function statusPill(status: string): React.CSSProperties {
  const palette: Record<string, { bg: string; fg: string; bd: string }> = {
    draft:     { bg: '#f7f9f6', fg: '#5a6657', bd: '#e8f0e6' },
    shared:    { bg: '#eff6ff', fg: '#1e40af', bd: '#bfdbfe' },
    accepted:  { bg: '#f0fdf4', fg: '#15803d', bd: '#bbf7d0' },
    declined:  { bg: '#fef2f2', fg: '#dc2626', bd: '#fecaca' },
    withdrawn: { bg: '#f5f5f4', fg: '#525252', bd: '#e7e5e4' },
    expired:   { bg: '#fff7ed', fg: '#9a3412', bd: '#fed7aa' },
    archived:  { bg: '#f5f5f4', fg: '#525252', bd: '#e7e5e4' },
    signed:    { bg: '#f0fdf4', fg: '#15803d', bd: '#bbf7d0' },
    sent:      { bg: '#eff6ff', fg: '#1e40af', bd: '#bfdbfe' },
    cancelled: { bg: '#fef2f2', fg: '#dc2626', bd: '#fecaca' },
  }
  const p = palette[status] ?? palette.draft
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

// ─── Save indicator ─────────────────────────────────────────────────────

/**
 * <SaveIndicator> — tiny pill that tells the user "Saving" or "Saved Ns
 * ago". Drives off two pieces of state the parent maintains via trackSave():
 *   savingCount: number of in-flight saves
 *   lastSavedAt: epoch ms of the most recent settled save (or null)
 *
 * Re-renders itself every five seconds so the elapsed time updates without
 * the parent having to push a tick.
 */
export function SaveIndicator({ savingCount, lastSavedAt }: { savingCount: number; lastSavedAt: number | null }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 5000)
    return () => clearInterval(t)
  }, [])
  if (savingCount > 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
        <span aria-hidden="true" style={{ width: '0.375rem', height: '0.375rem', borderRadius: '50%', background: 'var(--color-warning, #fb923c)', animation: 'pulse 1s ease-in-out infinite' }} />
        Saving
      </span>
    )
  }
  if (!lastSavedAt) return <span style={{ width: '0.5rem' }} aria-hidden="true" />
  const elapsedSec = Math.max(1, Math.round((Date.now() - lastSavedAt) / 1000))
  const label = elapsedSec < 5 ? 'Saved' : elapsedSec < 60 ? `Saved ${elapsedSec}s ago` : `Saved ${Math.round(elapsedSec / 60)}m ago`
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
      <Check size={11} style={{ color: 'var(--color-brand)' }} />
      {label}
    </span>
  )
}

// ─── More menu ──────────────────────────────────────────────────────────

export interface BuilderMoreMenuItem {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/**
 * <BuilderMoreMenu> — the three-dot dropdown in the sticky header. Items
 * fire onClick + close the menu. Pass `danger: true` for destructive
 * options (delete) so they render in red.
 */
export function BuilderMoreMenu({
  open, onToggle, onClose, items,
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

// ─── Nav group + item ───────────────────────────────────────────────────

export function BuilderNavGroup({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
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
  active, onClick, number, icon, label, hint, badge,
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

// ─── Rail section + field group ─────────────────────────────────────────

export function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

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

// ─── Slide editor shell (header for the centre pane) ────────────────────

/**
 * <SlideEditorShell> — wraps each centre-pane editor with the same
 * eyebrow + kicker + per-slide actions row. Used for sections, packages,
 * decisions, analytics, etc.
 */
export function SlideEditorShell({
  eyebrow, kicker, children, actions,
}: {
  eyebrow: string
  kicker: string
  children: React.ReactNode
  /** Optional action buttons (move up, move down, delete) for the right side of the header. */
  actions?: React.ReactNode
}) {
  return (
    <div style={{ maxWidth: '52rem', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', gap: '1rem' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {eyebrow}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)', marginTop: '0.25rem', letterSpacing: '-0.01em' }}>
            {kicker}
          </div>
        </div>
        {actions && <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>{actions}</div>}
      </div>
      {children}
    </div>
  )
}
