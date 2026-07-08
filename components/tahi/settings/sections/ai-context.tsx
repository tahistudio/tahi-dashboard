'use client'

/**
 * AiContextSection - the Docs Hub pages that ground the studio AI in Tahi's
 * voice and offer. Each grounding slot (ICP, Brand DNA, Tone, etc) is a
 * setting key pointing at a doc page id. Editing the linked doc updates the
 * AI behaviour; the actual loading + caching happens server-side in
 * lib/ai-context.ts.
 *
 * Reuses the existing AI-context wiring:
 *   GET   /api/admin/docs      - list doc pages (id, title, slug, category)
 *   GET   /api/admin/settings  - current key -> value map (holds the doc ids)
 *   PATCH /api/admin/settings  - save a single key/value ({ key, value })
 *
 * Layout matches the design: a card-grid2 of six single-row cards (leaf doc
 * icon, slot name, linked doc title, Change button). Change opens a picker
 * dialog over the Docs Hub pages; the pick persists on Save.
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Toasts, useToasts } from '@/components/tahi/settings/primitives'

interface DocLite {
  id: string
  title: string
  slug: string
  category: string | null
}

interface AiContextRow {
  settingKey: string
  label: string
}

// The canonical grounding docs wired into the AI prompts, in display order.
const AI_CONTEXT_ROWS: AiContextRow[] = [
  { settingKey: 'ai.icpDocId', label: 'Ideal Client Profile' },
  { settingKey: 'ai.brandDnaDocId', label: 'Brand DNA' },
  { settingKey: 'ai.toneDocId', label: 'Tone of Voice' },
  { settingKey: 'ai.liamVoiceDocId', label: 'Liam Personal Voice' },
  { settingKey: 'ai.aiTellsDocId', label: 'AI Writing Tells' },
  { settingKey: 'ai.servicesDocId', label: 'Services + Pricing' },
]

interface SettingsResponse {
  settings: Record<string, string | null>
}

interface DocsResponse {
  pages: DocLite[]
}

function portalTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const scoped = document.querySelector('.ash')?.getAttribute('data-theme')
  if (scoped === 'dark' || scoped === 'light') return scoped
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/* Picker dialog over the Docs Hub pages, in the design's .dlg language. */
function ChangeDocDialog({
  label,
  currentId,
  docs,
  busy,
  onSave,
  onClose,
}: {
  label: string
  currentId: string
  docs: DocLite[]
  busy: boolean
  onSave: (docId: string) => void
  onClose: () => void
}) {
  const [sel, setSel] = useState(currentId)
  const [mounted, setMounted] = useState(false)
  const selectRef = useRef<HTMLSelectElement>(null)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (mounted) selectRef.current?.focus()
  }, [mounted])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!mounted || typeof document === 'undefined') return null

  const selDoc = docs.find(d => d.id === sel)

  return createPortal(
    <div className="tahi-portal" data-theme={portalTheme()}>
      <div className="dlg-backdrop" onClick={onClose}>
        <div
          className="dlg"
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={`Linked doc for ${label}`}
        >
          <h3>Change linked doc</h3>
          <div className="set-field">
            <label>{label}</label>
            <select
              ref={selectRef}
              className="set-input"
              value={sel}
              disabled={docs.length === 0}
              onChange={e => setSel(e.target.value)}
            >
              <option value="">{docs.length === 0 ? 'No docs in the hub yet' : 'Not linked'}</option>
              {docs.map(d => (
                <option key={d.id} value={d.id}>
                  {d.category ? `${d.category} · ${d.title}` : d.title}
                </option>
              ))}
            </select>
            <small
              style={{ display: 'block', marginTop: 5, color: 'var(--text-faint)', font: '500 12px Manrope' }}
            >
              Edit the doc in the Docs Hub and the AI picks up the change automatically.
            </small>
          </div>
          {selDoc && (
            <a
              className="dlg-preview"
              style={{ display: 'inline-block', textDecoration: 'underline', color: 'var(--text-muted)' }}
              href={apiPath(`/docs/${selDoc.slug}`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open {selDoc.title} in the Docs Hub
            </a>
          )}
          <div className="dlg-foot">
            <button type="button" className="btn2" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn1" disabled={busy} onClick={() => onSave(sel)}>
              {busy ? 'Saving' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function AiContextSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  // Optimistic layer over the fetched settings so a pick reflects instantly.
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const { toasts, toast } = useToasts()

  const {
    data: settingsData,
    isLoading: loadingSettings,
    mutate: mutateSettings,
  } = useResource<SettingsResponse>(isAdmin === false ? null : '/api/admin/settings')
  const { data: docsData, isLoading: loadingDocs } = useResource<DocsResponse>(
    isAdmin === false ? null : '/api/admin/docs',
  )

  const settings = settingsData?.settings ?? {}
  const docs = docsData?.pages ?? []
  const loading = loadingSettings || loadingDocs

  const sortedDocs = docs
    .slice()
    .sort(
      (a, b) =>
        (a.category ?? '').localeCompare(b.category ?? '') || a.title.localeCompare(b.title),
    )

  async function saveDoc(key: string, value: string) {
    setSavingKey(key)
    setOverrides(prev => ({ ...prev, [key]: value }))
    try {
      const res = await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) throw new Error('Failed to save')
      await mutateSettings()
      setEditingKey(null)
      toast('Linked doc updated')
    } catch {
      // Roll the optimistic pick back on failure.
      setOverrides(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
      toast('Could not save the link', 'err')
    } finally {
      setSavingKey(null)
    }
  }

  if (isAdmin === false) return null

  const editingRow = editingKey
    ? AI_CONTEXT_ROWS.find(r => r.settingKey === editingKey) ?? null
    : null

  return (
    <SectionShell
      title="AI context"
      lede="The docs that ground the studio AI in your voice and offer."
    >
      {loading ? (
        <div className="card-grid2">
          {AI_CONTEXT_ROWS.map(row => (
            <div key={row.settingKey} className="set-card">
              <div className="set-row" aria-hidden="true">
                <span className="lrow-ic leaf" style={{ opacity: 0.4 }}>
                  <FileText size={16} />
                </span>
                <div className="sr-t">
                  <span
                    className="animate-pulse"
                    style={{ display: 'block', height: 12, width: 130, borderRadius: 6, background: 'var(--border-subtle)' }}
                  />
                  <span
                    className="animate-pulse"
                    style={{ display: 'block', height: 9, width: 80, borderRadius: 6, background: 'var(--border-subtle)', marginTop: 7 }}
                  />
                </div>
                <span
                  className="animate-pulse"
                  style={{ display: 'block', height: 30, width: 64, borderRadius: 9, background: 'var(--border-subtle)', flexShrink: 0 }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card-grid2">
          {AI_CONTEXT_ROWS.map(row => {
            const currentId = overrides[row.settingKey] ?? settings[row.settingKey] ?? ''
            const currentDoc = docs.find(d => d.id === currentId)
            return (
              <div key={row.settingKey} className="set-card">
                <div className="set-row">
                  <span className="lrow-ic leaf">
                    <FileText size={16} />
                  </span>
                  <div className="sr-t">
                    <b>{row.label}</b>
                    <small>{currentDoc ? currentDoc.title : 'No doc linked yet'}</small>
                  </div>
                  <button
                    type="button"
                    className="btn2 sm"
                    onClick={() => setEditingKey(row.settingKey)}
                  >
                    Change
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editingRow && (
        <ChangeDocDialog
          label={editingRow.label}
          currentId={overrides[editingRow.settingKey] ?? settings[editingRow.settingKey] ?? ''}
          docs={sortedDocs}
          busy={savingKey === editingRow.settingKey}
          onSave={v => void saveDoc(editingRow.settingKey, v)}
          onClose={() => setEditingKey(null)}
        />
      )}

      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
