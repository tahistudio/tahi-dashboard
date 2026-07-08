'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Check, Pencil, Trash2, X } from 'lucide-react'

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
export type ChipTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'brand'
  | 'teal'
  | 'purple'
  | 'outline'

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

/* ---------- SlideSeg (animated segmented control with icons / tablist) ----
   The design's icon-capable variant of Seg: options are objects, an optional
   icon renders in a .sg-ic slot, and role='tablist' + optRole='tab' turn it
   into an accessible tab strip (Team & access uses this). Seg stays as the
   tuple-based control for existing sections. */
export interface SlideSegOpt {
  v: string
  label: string
  icon?: ReactNode
}

export interface SlideSegProps {
  opts: SlideSegOpt[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  role?: 'group' | 'tablist'
  optRole?: 'tab'
}

export function SlideSeg({ opts, value, onChange, ariaLabel, role = 'group', optRole }: SlideSegProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [ind, setInd] = useState<{ x: number; w: number }>({ x: 0, w: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const bs = el.querySelectorAll<HTMLButtonElement>('.segx-b')
      const i = Math.max(0, opts.findIndex((o) => o.v === value))
      const b = bs[i]
      if (b) setInd({ x: b.offsetLeft, w: b.offsetWidth })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [value, opts])
  return (
    <div className="segx" ref={ref} role={role} aria-label={ariaLabel}>
      <span className="segx-ind" style={{ transform: 'translateX(' + ind.x + 'px)', width: ind.w }} />
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          role={optRole}
          aria-selected={optRole === 'tab' ? value === o.v : undefined}
          className={'segx-b' + (value === o.v ? ' on' : '')}
          onClick={() => onChange(o.v)}
        >
          {o.icon && <span className="sg-ic">{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- Tri (Inherit / Allow / Deny three-way control) ---------- */
export type TriValue = 'inherit' | 'allow' | 'deny'

export interface TriProps {
  value: TriValue
  onChange: (v: TriValue) => void
  locked?: boolean
  label: string
}

const TRI_OPTS: [TriValue, string][] = [
  ['inherit', 'Inherit'],
  ['allow', 'Allow'],
  ['deny', 'Deny'],
]

export function Tri({ value, onChange, locked, label }: TriProps) {
  return (
    <div className={'tri' + (locked ? ' locked' : '')} role="radiogroup" aria-label={'Access for ' + label}>
      {TRI_OPTS.map(([v, l]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          disabled={locked}
          className={'tri-b ' + v + (value === v ? ' on' : '')}
          onClick={() => !locked && onChange(v)}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

/* ---------- Toasts (bottom-right confirmation stack) ---------- */
export interface ToastItem {
  id: number
  msg: string
  type: 'ok' | 'err'
}

export interface UseToasts {
  toasts: ToastItem[]
  toast: (msg: string, type?: 'ok' | 'err') => void
}

let toastSeq = 0

export function useToasts(): UseToasts {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toast = useCallback((msg: string, type: 'ok' | 'err' = 'ok') => {
    const id = ++toastSeq
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400)
  }, [])
  return { toasts, toast }
}

export function Toasts({ toasts }: { toasts: ToastItem[] }) {
  if (!toasts.length) return null
  return (
    <Portal>
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={'toast ' + (t.type === 'err' ? 'err' : 'ok')} role={t.type === 'err' ? 'alert' : 'status'}>
            <span className="tk">{t.type === 'err' ? <X size={16} /> : <Check size={16} />}</span>
            {t.msg}
          </div>
        ))}
      </div>
    </Portal>
  )
}

/* ---------- AvatarUpload (photo / logo picker with camera badge) ----------
   The section owns the actual persistence: onFile receives the picked File
   (upload to Clerk / R2, then update `value`). `value` is any renderable
   image URL (remote URL or data URL preview). */
export interface AvatarUploadProps {
  value: string | null | undefined
  initials: string
  onFile: (file: File) => void
  onRemove?: () => void
  size?: number
  shape?: 'circle' | 'rounded'
  busy?: boolean
  ariaLabel?: string
}

export function AvatarUpload({
  value,
  initials,
  onFile,
  onRemove,
  size = 78,
  shape = 'circle',
  busy,
  ariaLabel,
}: AvatarUploadProps) {
  const inp = useRef<HTMLInputElement>(null)
  const pick = () => inp.current?.click()
  return (
    <div className="av-up">
      <button
        type="button"
        className={'av-up-frame ' + shape}
        style={{ width: size, height: size, opacity: busy ? 0.6 : undefined }}
        onClick={pick}
        aria-label={ariaLabel ?? 'Upload image'}
        disabled={busy}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" />
        ) : (
          <span className="av-up-initials" style={size < 64 ? { fontSize: Math.round(size * 0.32) } : undefined}>
            {initials}
          </span>
        )}
        <span className="av-up-cam">
          <Camera size={15} />
        </span>
      </button>
      <div className="av-up-actions">
        <button type="button" className="btn2 sm" onClick={pick} disabled={busy}>
          {busy ? 'Uploading' : value ? 'Replace' : 'Upload'}
        </button>
        {value && onRemove && (
          <button type="button" className="btn2 sm" onClick={onRemove} disabled={busy}>
            Remove
          </button>
        )}
      </div>
      <input
        ref={inp}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/* ---------- SlideOverShell (.ov-backdrop + .so panel) ---------- */
export interface SlideOverShellProps {
  icon: ReactNode
  title: string
  sub?: string
  footNote?: string
  onClose: () => void
  ariaLabel: string
  children: ReactNode
}

export function SlideOverShell({ icon, title, sub, footNote, onClose, ariaLabel, children }: SlideOverShellProps) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <Portal>
      <div className="ov-backdrop" onClick={onClose} />
      <div className="so" role="dialog" aria-modal="true" aria-label={ariaLabel}>
        <div className="so-head">
          <span className="so-icon">{icon}</span>
          <div className="sh-t">
            <b>{title}</b>
            {sub && <small>{sub}</small>}
          </div>
          <button type="button" className="ta-icobtn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="so-body">{children}</div>
        <div className="so-foot">
          <small>{footNote ?? 'Changes save automatically'}</small>
          <button type="button" className="btn2" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Portal>
  )
}

/* ---------- TaSelect (button + floating option menu, design .ta-select) ---- */
export interface TaSelectOpt {
  value: string | null
  title: ReactNode
  desc?: string
}

export interface TaSelectProps {
  value: string | null
  display: ReactNode
  opts: TaSelectOpt[]
  onChange: (value: string | null) => void
  ariaLabel: string
}

export function TaSelect({ value, display, opts, onChange, ariaLabel }: TaSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const f = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', f)
    return () => document.removeEventListener('mousedown', f)
  }, [open])
  return (
    <div className="ta-select" ref={ref}>
      <button
        type="button"
        className="ta-select-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {display}
        <span className="chev" style={{ display: 'flex' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="ta-select-menu" role="listbox">
          {opts.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="option"
              aria-selected={value === o.value}
              className={'ta-select-opt' + (value === o.value ? ' on' : '')}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <b>{o.title}</b>
              {o.desc && <small>{o.desc}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
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
