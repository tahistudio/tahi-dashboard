'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Pencil, Trash2 } from 'lucide-react'

/* ---------- theme-aware portal ---------- */
function currentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const scoped = document.querySelector('.ash')?.getAttribute('data-theme')
  if (scoped === 'dark' || scoped === 'light') return scoped
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted || typeof document === 'undefined') return null
  return createPortal(
    <div className="tahi-portal" data-theme={currentTheme()}>
      {children}
    </div>,
    document.body,
  )
}

/* ---------- SectionShell ---------- */
export interface SectionShellProps {
  title: string
  lede?: string
  action?: ReactNode
  children?: ReactNode
}

export function SectionShell({ title, lede, action, children }: SectionShellProps) {
  return (
    <div className="set-pane">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="set-h2">{title}</h2>
          {lede && <p className="set-lede">{lede}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

/* ---------- Toggle ---------- */
export interface ToggleProps {
  on: boolean
  onClick: () => void
  ariaLabel?: string
}

export function Toggle({ on, onClick, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      className={'sw' + (on ? ' on' : '')}
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
    />
  )
}

/* ---------- Seg (animated segmented control) ---------- */
export interface SegProps {
  opts: [string, string][]
  value: string
  onChange: (value: string) => void
  aria: string
}

export function Seg({ opts, value, onChange, aria }: SegProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ x: number; w: number }>({ x: 0, w: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const bs = el.querySelectorAll<HTMLButtonElement>('.segx-b')
      const i = Math.max(
        0,
        opts.findIndex((o) => o[0] === value),
      )
      const b = bs[i]
      if (b) setInd({ x: b.offsetLeft, w: b.offsetWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [value, opts])
  return (
    <div className="segx" ref={ref} role="group" aria-label={aria}>
      <span
        className="segx-ind"
        style={{ transform: 'translateX(' + ind.x + 'px)', width: ind.w }}
      />
      {opts.map(([v, l]) => (
        <button
          key={v}
          type="button"
          className={'segx-b' + (value === v ? ' on' : '')}
          onClick={() => onChange(v)}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

/* ---------- useManaged (add / edit / delete with insert animation) ---------- */
export type ManagedRow<T> = T & { _id: string; _new?: boolean }

export interface Managed<T> {
  rows: ManagedRow<T>[]
  add: (row: T) => string
  remove: (id: string) => void
  patch: (id: string, p: Partial<T>) => void
}

function rid(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 7)
}

export function useManaged<T extends Record<string, unknown>>(init: T[]): Managed<T> {
  const [rows, setRows] = useState<ManagedRow<T>[]>(() =>
    init.map((r) => ({ ...r, _id: rid('r') })),
  )
  const add = (row: T): string => {
    const _id = rid('n')
    setRows((rs) => [{ ...row, _id, _new: true }, ...rs])
    return _id
  }
  const remove = (id: string): void => setRows((rs) => rs.filter((r) => r._id !== id))
  const patch = (id: string, p: Partial<T>): void =>
    setRows((rs) => rs.map((r) => (r._id === id ? { ...r, ...p } : r)))
  return { rows, add, remove, patch }
}

/* ---------- RowActions ---------- */
export interface RowActionsProps {
  onEdit?: () => void
  onDelete?: () => void
}

export function RowActions({ onEdit, onDelete }: RowActionsProps) {
  return (
    <div className="lrow-acts">
      <button type="button" className="ta-icobtn sm" aria-label="Edit" onClick={onEdit}>
        <Pencil size={15} />
      </button>
      <button type="button" className="ta-icobtn sm" aria-label="Delete" onClick={onDelete}>
        <Trash2 size={15} />
      </button>
    </div>
  )
}

/* ---------- EmptyRow ---------- */
export interface EmptyRowProps {
  text: string
}

export function EmptyRow({ text }: EmptyRowProps) {
  return (
    <div className="lrow" style={{ color: 'var(--text-faint)', font: '500 13px Manrope' }}>
      {text}
    </div>
  )
}

/* ---------- Chip ---------- */
export type ChipTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'

export interface ChipProps {
  tone: ChipTone
  children: ReactNode
}

export function Chip({ tone, children }: ChipProps) {
  return <span className={'chip ' + tone}>{children}</span>
}

/* ---------- EditDialog ---------- */
export type FieldType = 'text' | 'textarea' | 'select' | 'color' | 'number'

export interface Field {
  key: string
  label: string
  type?: FieldType
  opts?: string[]
  ph?: string
  help?: string
}

export interface EditDialogProps {
  heading: string
  fields: Field[]
  row?: Record<string, unknown> | null
  onSave: (values: Record<string, string>) => void
  onClose: () => void
}

export function EditDialog({ heading, fields, row, onSave, onClose }: EditDialogProps) {
  const [v, setV] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => {
        const raw = row ? row[f.key] : undefined
        return [f.key, raw == null ? '' : String(raw)]
      }),
    ),
  )
  const dlgRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = dlgRef.current?.querySelector<HTMLElement>('input, textarea, select')
    el?.focus()
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const set = (k: string, val: string) => setV((s) => ({ ...s, [k]: val }))

  return (
    <Portal>
      <div className="dlg-backdrop" onClick={onClose}>
        <div
          ref={dlgRef}
          className="dlg"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={heading}
        >
          <h3>{heading}</h3>
          {fields.map((f, i) => (
            <div key={f.key} className="set-field" style={{ marginTop: i ? 12 : 0 }}>
              <label>{f.label}</label>
              {f.type === 'color' ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="color"
                    value={v[f.key] || '#5A824E'}
                    onChange={(e) => set(f.key, e.target.value)}
                    style={{
                      width: 44,
                      height: 40,
                      border: '1px solid var(--border)',
                      borderRadius: 9,
                      padding: 2,
                      background: 'var(--bg)',
                      cursor: 'pointer',
                    }}
                  />
                  <input
                    className="set-input"
                    value={v[f.key] || ''}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                </div>
              ) : f.type === 'select' ? (
                <select
                  className="set-input"
                  value={v[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                >
                  {(f.opts ?? []).map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : f.type === 'textarea' ? (
                <textarea
                  className="set-input"
                  style={{ height: 82, padding: '10px 12px', resize: 'vertical', lineHeight: 1.5 }}
                  value={v[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.ph || ''}
                />
              ) : f.type === 'number' ? (
                <input
                  type="number"
                  className="set-input"
                  value={v[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              ) : (
                <input
                  className="set-input"
                  value={v[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSave(v)
                  }}
                  placeholder={f.ph || ''}
                />
              )}
              {f.help && (
                <small
                  style={{
                    display: 'block',
                    marginTop: 5,
                    color: 'var(--text-faint)',
                    font: '500 12px Manrope',
                  }}
                >
                  {f.help}
                </small>
              )}
            </div>
          ))}
          <div className="dlg-foot">
            <button type="button" className="btn2" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn1" onClick={() => onSave(v)}>
              Save
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

/* ---------- PerClientHeader ---------- */
export interface PerClientHeaderProps {
  mode: string
  setMode: (v: string) => void
  client: string
  setClient: (v: string) => void
  clients: string[]
}

export function PerClientHeader({
  mode,
  setMode,
  client,
  setClient,
  clients,
}: PerClientHeaderProps) {
  return (
    <div className="set-card" style={{ marginBottom: 16 }}>
      <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
        <div className="sr-t">
          <b>Applies to</b>
          <small>
            {mode === 'global'
              ? 'These defaults apply to every client.'
              : 'Overrides just this client; others keep the global set.'}
          </small>
        </div>
        <div className="ctl-line">
          <Seg
            aria="Scope"
            value={mode}
            onChange={setMode}
            opts={[
              ['global', 'All clients'],
              ['client', 'Per client'],
            ]}
          />
          {mode === 'client' && (
            <select
              className="set-input"
              style={{ maxWidth: 240 }}
              value={client}
              onChange={(e) => setClient(e.target.value)}
            >
              {clients.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </div>
  )
}
