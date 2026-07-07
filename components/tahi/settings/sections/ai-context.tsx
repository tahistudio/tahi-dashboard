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
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useState } from 'react'
import { FileText, ExternalLink } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Chip, EmptyRow } from '@/components/tahi/settings/primitives'

interface DocLite {
  id: string
  title: string
  slug: string
  category: string | null
}

interface AiContextRow {
  settingKey: string
  label: string
  description: string
  surfaces: string
}

// The canonical grounding docs wired into the AI prompts, in display order.
const AI_CONTEXT_ROWS: AiContextRow[] = [
  {
    settingKey: 'ai.icpDocId',
    label: 'Ideal Client Profile',
    description: 'Drives lead scoring and enrichment fit. The discriminating signal for the AI.',
    surfaces: 'Scoring, enrichment, reply drafting',
  },
  {
    settingKey: 'ai.brandDnaDocId',
    label: 'Brand DNA',
    description: 'Tahi positioning and voice principles. Frames how the AI talks about us.',
    surfaces: 'Reply drafting',
  },
  {
    settingKey: 'ai.toneDocId',
    label: 'Tone of Voice',
    description: 'Cadence and phrasing rules. NZ English, direct and warm.',
    surfaces: 'Reply drafting',
  },
  {
    settingKey: 'ai.liamVoiceDocId',
    label: 'Liam Personal Voice',
    description: 'How Liam writes personally. Outreach style for first-touch replies.',
    surfaces: 'Reply drafting',
  },
  {
    settingKey: 'ai.aiTellsDocId',
    label: 'AI Writing Tells',
    description: 'Anti-patterns the AI must avoid. Phrases that scream it was AI written.',
    surfaces: 'Reply drafting',
  },
  {
    settingKey: 'ai.servicesDocId',
    label: 'Services and Pricing',
    description: 'The product catalogue. The AI knows what we sell when assessing fit.',
    surfaces: 'Scoring, enrichment',
  },
]

interface SettingsResponse {
  settings: Record<string, string | null>
}

interface DocsResponse {
  pages: DocLite[]
}

export function AiContextSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  const [savingKey, setSavingKey] = useState<string | null>(null)
  // Optimistic layer over the fetched settings so a pick reflects instantly.
  const [overrides, setOverrides] = useState<Record<string, string>>({})

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
    } catch {
      // Roll the optimistic pick back on failure.
      setOverrides(prev => {
        const next = { ...prev }
        delete next[key]
        return next
      })
    } finally {
      setSavingKey(null)
    }
  }

  if (isAdmin === false) return null

  return (
    <SectionShell
      title="AI context"
      lede="The docs that ground the studio AI in your voice and offer. Edit the linked doc in the Docs Hub and the AI updates within minutes."
    >
      {loading ? (
        <div className="set-card lrow-wrap">
          <EmptyRow text="Loading grounding docs..." />
        </div>
      ) : (
        <div className="card-grid2">
          {AI_CONTEXT_ROWS.map(row => {
            const currentId = overrides[row.settingKey] ?? settings[row.settingKey] ?? ''
            const currentDoc = docs.find(d => d.id === currentId)
            const busy = savingKey === row.settingKey
            return (
              <div
                key={row.settingKey}
                className="set-card"
                style={{ flexDirection: 'column', alignItems: 'stretch' }}
              >
                <div className="set-row">
                  <span className="lrow-ic leaf">
                    <FileText size={16} />
                  </span>
                  <div className="sr-t">
                    <b>{row.label}</b>
                    <small>{currentDoc ? currentDoc.title : 'No doc linked yet'}</small>
                  </div>
                  <Chip tone={currentDoc ? 'success' : 'warning'}>
                    {currentDoc ? 'Wired' : 'Not set'}
                  </Chip>
                </div>
                <div
                  style={{
                    padding: '0 18px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <small style={{ font: '400 12.5px/1.5 Manrope', color: 'var(--text-muted)' }}>
                    {row.description}
                  </small>
                  <small style={{ font: '500 11.5px Manrope', color: 'var(--text-faint)' }}>
                    Used by: {row.surfaces}
                  </small>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <select
                      className="set-input"
                      style={{ flex: '1 1 160px', minWidth: 0 }}
                      value={currentId}
                      disabled={busy || docs.length === 0}
                      onChange={e => {
                        void saveDoc(row.settingKey, e.target.value)
                      }}
                      aria-label={`Linked doc for ${row.label}`}
                    >
                      <option value="">
                        {docs.length === 0 ? 'No docs in the hub yet' : 'Pick a doc'}
                      </option>
                      {sortedDocs.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.category ? `${d.category} · ${d.title}` : d.title}
                        </option>
                      ))}
                    </select>
                    {currentDoc && (
                      <a
                        href={`/docs/${currentDoc.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn2 sm"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
                      >
                        <ExternalLink size={14} />
                        Open
                      </a>
                    )}
                  </div>
                  {busy && (
                    <small style={{ font: '500 12px Manrope', color: 'var(--text-faint)' }}>
                      Saving...
                    </small>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </SectionShell>
  )
}
