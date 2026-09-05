'use client'

/**
 * <AiHealthCheckCard>. Admin-triggered. A human clicks Generate; the model
 * returns a narrative, risk flags and a suggested status. NOTHING persists
 * until the human clicks one of the two explicit apply actions (both PATCH
 * the org endpoint) or dismisses the suggestion. Human in the loop: no
 * auto-run, no auto-apply.
 */

import { useState } from 'react'
import { AlertTriangle, Check, ChevronRight, Sparkles, X } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Card } from '@/components/tahi/card'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { Organisation } from './types'

// ── AI health check card ───────────────────────────────────────────────────────
//
// Admin-triggered. A human clicks Generate; the model returns a narrative,
// risk flags and a suggested status. NOTHING persists until the human clicks
// one of the two explicit apply actions (both PATCH the org endpoint) or the
// suggestion is dismissed. Human-in-the-loop: no auto-run, no auto-apply.

export interface HealthCheckResult {
  generatedAt: string
  currentHealthStatus: string | null
  healthNarrative: string
  riskFlags: string[]
  suggestedHealthStatus: 'green' | 'amber' | 'red'
  suggestedActions: string[]
}

const SUGGESTED_HEALTH_META: Record<'green' | 'amber' | 'red', { label: string; dot: string; bg: string; fg: string }> = {
  green: { label: 'Healthy',  dot: '#22C55E', bg: 'var(--color-brand-50)',   fg: 'var(--color-brand)' },
  amber: { label: 'Watch',    dot: '#F59E0B', bg: 'var(--color-warning-bg)', fg: 'var(--color-warning)' },
  red:   { label: 'At risk',  dot: '#EF4444', bg: 'var(--color-danger-bg)',  fg: 'var(--color-danger)' },
}

export function AiHealthCheckCard({ org, onUpdated }: { org: Organisation; onUpdated: () => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<HealthCheckResult | null>(null)
  const [applying, setApplying] = useState<'status' | 'note' | null>(null)
  const [appliedStatus, setAppliedStatus] = useState(false)
  const [savedNote, setSavedNote] = useState(false)

  const generate = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    setAppliedStatus(false)
    setSavedNote(false)
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${org.id}/health-summary`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const json = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setError((json && typeof json.error === 'string' ? json.error : null) ?? 'Could not generate a health check. Please try again.')
        return
      }
      setResult(json as HealthCheckResult)
    } catch {
      setError('Could not reach the health check service. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const applyStatus = async () => {
    if (!result) return
    setApplying('status')
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${org.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthStatus: result.suggestedHealthStatus }),
      })
      if (!res.ok) throw new Error('Failed')
      setAppliedStatus(true)
      onUpdated()
    } catch {
      setError('Could not apply the health status. Please try again.')
    } finally {
      setApplying(null)
    }
  }

  const saveNote = async () => {
    if (!result) return
    setApplying('note')
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${org.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ healthNote: result.healthNarrative }),
      })
      if (!res.ok) throw new Error('Failed')
      setSavedNote(true)
      onUpdated()
    } catch {
      setError('Could not save the note. Please try again.')
    } finally {
      setApplying(null)
    }
  }

  const dismiss = () => {
    setResult(null)
    setError(null)
    setAppliedStatus(false)
    setSavedNote(false)
  }

  const meta = result ? SUGGESTED_HEALTH_META[result.suggestedHealthStatus] : null

  return (
    <Card>
      <Card.Header style={{ marginBottom: 'var(--space-3)', alignItems: 'center' }}>
        <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
          <Sparkles className="w-4 h-4 text-[var(--color-brand)]" aria-hidden="true" />
          <Card.Title style={{ fontSize: 'var(--text-sm)' }}>AI health check</Card.Title>
        </div>
        {result && (
          <button
            onClick={dismiss}
            className="tahi-focus-ring min-h-[2.75rem] md:min-h-[1.75rem] flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
            aria-label="Dismiss suggestion"
          >
            <X className="w-3.5 h-3.5" /> Dismiss
          </button>
        )}
      </Card.Header>

      {!result && (
        <>
          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            Generate a grounded read on this client from their recent requests, tasks, invoices, calls and messages. Suggestions only, nothing changes until you apply them.
          </p>
          <TahiButton variant="primary" size="sm" onClick={generate} disabled={loading} loading={loading}>
            {loading ? 'Analysing...' : (
              <>
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                Generate
              </>
            )}
          </TahiButton>
        </>
      )}

      {error && (
        <div
          className="mt-3 flex items-start gap-2 rounded-lg p-2.5 text-xs"
          style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}
        >
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {result && meta && (
        <div className="flex flex-col gap-3">
          {/* Suggested status pill */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-[var(--color-text-muted)]">Suggested status:</span>
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ background: meta.bg, color: meta.fg }}
            >
              <span aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', borderRadius: '9999px', background: meta.dot, display: 'inline-block' }} />
              {meta.label}
            </span>
            {result.currentHealthStatus && result.currentHealthStatus !== result.suggestedHealthStatus && (
              <span className="text-[10px] text-[var(--color-text-subtle)]">
                (currently {result.currentHealthStatus})
              </span>
            )}
          </div>

          {/* Narrative */}
          <p className="text-sm text-[var(--color-text)] leading-relaxed">{result.healthNarrative}</p>

          {/* Risk flags */}
          {result.riskFlags.length > 0 && (
            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">Risk flags</p>
              <ul className="flex flex-col gap-1">
                {result.riskFlags.map((flag, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--color-text)]">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: 'var(--color-warning)' }} aria-hidden="true" />
                    <span>{flag}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggested actions */}
          {result.suggestedActions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-[var(--color-text-muted)] mb-1.5">Suggested actions</p>
              <ul className="flex flex-col gap-1">
                {result.suggestedActions.map((action, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--color-text)]">
                    <ChevronRight className="w-3 h-3 flex-shrink-0 mt-0.5 text-[var(--color-brand)]" aria-hidden="true" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Explicit apply actions */}
          <div className="flex flex-wrap gap-2 pt-1 border-t border-[var(--color-border-subtle)] mt-1">
            <TahiButton
              variant="primary"
              size="sm"
              onClick={applyStatus}
              disabled={applying !== null || appliedStatus}
              loading={applying === 'status'}
            >
              {appliedStatus ? (
                <><Check className="w-3.5 h-3.5 mr-1.5" /> Status applied</>
              ) : (
                `Apply health status`
              )}
            </TahiButton>
            <TahiButton
              variant="secondary"
              size="sm"
              onClick={saveNote}
              disabled={applying !== null || savedNote}
              loading={applying === 'note'}
            >
              {savedNote ? (
                <><Check className="w-3.5 h-3.5 mr-1.5" /> Note saved</>
              ) : (
                'Save note'
              )}
            </TahiButton>
          </div>
          <p className="text-[10px] text-[var(--color-text-subtle)]">
            AI generated from recent activity. Review before applying.
          </p>
        </div>
      )}
    </Card>
  )
}
