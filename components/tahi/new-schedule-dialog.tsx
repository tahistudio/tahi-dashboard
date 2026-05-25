'use client'

/**
 * <NewScheduleDialog> — creation form for the /schedules page.
 *
 * Liam's workflow is lead → discovery → proposal+schedule → review →
 * send. Letting him pick a Client, Deal, or Lead at creation time means
 * the schedule is wired into the pipeline from the first save (instead
 * of going to the detail page and using the LinkedToPanel).
 *
 * The dialog also surfaces template selection so users still get the
 * quick "Blank or from template" choice — just inside one consistent
 * UI rather than a dropdown menu that doesn't support attachment.
 */

import { useEffect, useRef, useState } from 'react'
import { Building2, TrendingUp, UserPlus, Sparkles, X, ChevronDown, FilePlus2 } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Popover } from '@/components/tahi/popover'

export interface ScheduleTemplateOption {
  id: string
  name: string
  description?: string | null
}

interface OrgOption { id: string; name: string }
interface DealOption { id: string; title: string; orgId: string | null; orgName: string | null; stageName: string | null }
interface LeadOption { id: string; name: string; company: string | null; status: string }

interface Props {
  open: boolean
  onClose: () => void
  /** Templates available — usually pre-fetched by the parent list page. */
  templates: ScheduleTemplateOption[]
  /** Called with the new schedule id once it's created so the parent can route. */
  onCreated: (id: string) => void
  /** Optional pre-seeded attachment when launched from a detail page. */
  defaults?: {
    title?: string
    orgId?: string | null
    dealId?: string | null
    leadId?: string | null
  }
}

export function NewScheduleDialog({ open, onClose, templates, onCreated, defaults }: Props) {
  const [title, setTitle] = useState(defaults?.title ?? 'New project schedule')
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [orgId, setOrgId] = useState<string | null>(defaults?.orgId ?? null)
  const [dealId, setDealId] = useState<string | null>(defaults?.dealId ?? null)
  const [leadId, setLeadId] = useState<string | null>(defaults?.leadId ?? null)
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [deals, setDeals] = useState<DealOption[]>([])
  const [leads, setLeads] = useState<LeadOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on open so we don't carry state from a previous session.
  useEffect(() => {
    if (!open) return
    setTitle(defaults?.title ?? 'New project schedule')
    setTemplateId(null)
    setOrgId(defaults?.orgId ?? null)
    setDealId(defaults?.dealId ?? null)
    setLeadId(defaults?.leadId ?? null)
    setError(null)
  }, [open, defaults?.title, defaults?.orgId, defaults?.dealId, defaults?.leadId])

  // Lazy-load option lists once when the dialog opens — saves the parent
  // having to pre-fetch the universe of clients/deals/leads on every list
  // page mount.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      const [oRes, dRes, lRes] = await Promise.all([
        fetch(apiPath('/api/admin/clients')).catch(() => null),
        fetch(apiPath('/api/admin/deals')).catch(() => null),
        fetch(apiPath('/api/admin/leads')).catch(() => null),
      ])
      if (cancelled) return
      if (oRes?.ok) {
        const data = await oRes.json() as { organisations?: OrgOption[]; clients?: OrgOption[] }
        setOrgs(data.organisations ?? data.clients ?? [])
      }
      if (dRes?.ok) {
        const data = await dRes.json() as { items?: DealOption[]; deals?: DealOption[] }
        setDeals(data.items ?? data.deals ?? [])
      }
      if (lRes?.ok) {
        const data = await lRes.json() as { leads?: LeadOption[]; items?: LeadOption[] }
        setLeads(data.leads ?? data.items ?? [])
      }
    }
    void load()
    return () => { cancelled = true }
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const orgName = orgs.find(o => o.id === orgId)?.name ?? null
  const dealTitle = deals.find(d => d.id === dealId)?.title ?? null
  const leadName = leads.find(l => l.id === leadId)?.name ?? null
  const selectedTemplate = templates.find(t => t.id === templateId) ?? null

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = templateId
        ? { templateId, title: title.trim() || undefined, orgId, dealId, leadId }
        : {
            title: title.trim() || 'New project schedule',
            subtitle: 'PROJECT SCHEDULE, GANTT',
            numberOfWeeks: 12,
            orgId, dealId, leadId,
          }
      const res = await fetch(apiPath('/api/admin/schedules'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json() as { id?: string; error?: string }
      if (!res.ok || !data.id) {
        setError(data.error ?? 'Could not create schedule.')
        return
      }
      onCreated(data.id)
    } catch {
      setError('Could not create schedule.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <div className="px-6 pt-6 pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-[var(--color-text)]">New schedule</h2>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Attach it to a lead, deal, or client so it stays inside the pipeline.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--color-text)] uppercase tracking-wide mb-2">
              Title
            </label>
            <input
              autoFocus
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              placeholder="New project schedule"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-text)] uppercase tracking-wide mb-2">
              Starting point
            </label>
            <TemplateRow
              templates={templates}
              selectedId={templateId}
              onPick={setTemplateId}
            />
            {selectedTemplate?.description && (
              <p className="text-xs text-[var(--color-text-muted)] mt-1.5">{selectedTemplate.description}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-[var(--color-text)] uppercase tracking-wide mb-2">
              Attach to <span className="text-[var(--color-text-subtle)] normal-case font-normal tracking-normal">(optional)</span>
            </label>
            <div className="grid" style={{ gap: '0.5rem' }}>
              <AttachmentPicker
                icon={<Building2 className="w-3.5 h-3.5" />}
                label="Client"
                value={orgName}
                onClear={() => setOrgId(null)}
                options={orgs.map(o => ({ id: o.id, label: o.name }))}
                currentId={orgId}
                onPick={setOrgId}
              />
              <AttachmentPicker
                icon={<TrendingUp className="w-3.5 h-3.5" />}
                label="Deal"
                value={dealTitle}
                onClear={() => setDealId(null)}
                options={deals
                  .filter(d => !orgId || d.orgId === orgId || !d.orgId)
                  .map(d => ({
                    id: d.id,
                    label: `${d.title}${d.orgName ? ` · ${d.orgName}` : ''}${d.stageName ? ` · ${d.stageName}` : ''}`,
                  }))}
                currentId={dealId}
                onPick={setDealId}
              />
              <AttachmentPicker
                icon={<UserPlus className="w-3.5 h-3.5" />}
                label="Lead"
                value={leadName}
                onClear={() => setLeadId(null)}
                options={leads.map(l => ({
                  id: l.id,
                  label: `${l.name}${l.company ? ` · ${l.company}` : ''}${l.status ? ` · ${l.status}` : ''}`,
                }))}
                currentId={leadId}
                onPick={setLeadId}
              />
            </div>
          </div>

          {error && (
            <div
              className="text-sm rounded-lg px-3 py-2"
              style={{
                background: 'var(--color-danger-bg)',
                border: '1px solid var(--color-danger)',
                color: 'var(--color-danger)',
              }}
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <TahiButton variant="secondary" onClick={onClose} disabled={busy}>Cancel</TahiButton>
            <TahiButton onClick={submit} loading={busy} iconLeft={<FilePlus2 className="w-3.5 h-3.5" />}>
              Create schedule
            </TahiButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Subcomponents ─────────────────────────────────────────────────────

function TemplateRow({
  templates, selectedId, onPick,
}: {
  templates: ScheduleTemplateOption[]
  selectedId: string | null
  onPick: (id: string | null) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const selected = templates.find(t => t.id === selectedId)
  return (
    <div>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-left"
        style={{
          background: 'var(--color-bg)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-text)',
        }}
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium min-w-0">
          {selected ? (
            <>
              <Sparkles className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-brand)]" />
              <span className="truncate">{selected.name}</span>
            </>
          ) : (
            <>
              <FilePlus2 className="w-3.5 h-3.5 flex-shrink-0 text-[var(--color-text-muted)]" />
              <span>Blank — empty 12-week gantt</span>
            </>
          )}
        </span>
        <ChevronDown size={14} className="text-[var(--color-text-muted)] flex-shrink-0" />
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width="22rem" align="start" mobileFullWidth>
        <div style={{ padding: 'var(--space-2)', display: 'grid', gap: '2px', maxHeight: '16rem', overflowY: 'auto' }}>
          <button
            type="button"
            onClick={() => { onPick(null); setOpen(false) }}
            className="flex items-start gap-2 text-left px-3 py-2 rounded-md hover:bg-[var(--color-bg-secondary)]"
            style={{ background: !selectedId ? 'var(--color-brand-50)' : 'transparent' }}
          >
            <FilePlus2 className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--color-text-muted)]" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-[var(--color-text)]">Blank schedule</div>
              <div className="text-xs text-[var(--color-text-muted)] mt-0.5">Empty 12-week gantt to start from scratch.</div>
            </div>
          </button>
          {templates.length > 0 && (
            <div style={{ height: 1, background: 'var(--color-border-subtle)', margin: '0.25rem 0.25rem' }} />
          )}
          {templates.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => { onPick(t.id); setOpen(false) }}
              className="flex items-start gap-2 text-left px-3 py-2 rounded-md hover:bg-[var(--color-bg-secondary)]"
              style={{ background: t.id === selectedId ? 'var(--color-brand-50)' : 'transparent' }}
            >
              <Sparkles className="w-4 h-4 mt-0.5 flex-shrink-0 text-[var(--color-brand)]" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--color-text)] truncate">{t.name}</div>
                {t.description && (
                  <div className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">{t.description}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  )
}

function AttachmentPicker({
  icon, label, value, onClear, options, currentId, onPick,
}: {
  icon: React.ReactNode
  label: string
  value: string | null
  onClear: () => void
  options: Array<{ id: string; label: string }>
  currentId: string | null
  onPick: (id: string) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const filtered = options.filter(o => !search.trim() || o.label.toLowerCase().includes(search.toLowerCase()))
  return (
    <div className="flex items-center gap-3" style={{ flexWrap: 'wrap' }}>
      <div className="flex items-center" style={{ gap: '0.375rem', minWidth: '4rem', color: 'var(--color-text-muted)' }}>
        {icon}
        <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{label}</span>
      </div>
      <div className="flex items-center" style={{ flex: 1, minWidth: 0, gap: '0.5rem' }}>
        {value ? (
          <span className="truncate" style={{ fontSize: '0.8125rem', color: 'var(--color-text)', fontWeight: 500 }}>
            {value}
          </span>
        ) : (
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>Not attached</span>
        )}
        <div className="flex items-center" style={{ gap: '0.25rem', marginLeft: 'auto' }}>
          <button
            ref={ref}
            type="button"
            onClick={() => setOpen(v => !v)}
            className="inline-flex items-center"
            style={{
              fontSize: '0.6875rem',
              fontWeight: 600,
              padding: '0.25rem 0.5rem',
              color: 'var(--color-text-muted)',
              background: 'transparent',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              cursor: 'pointer',
              gap: '0.25rem',
            }}
          >
            {value ? 'Change' : 'Link'}
            <ChevronDown size={11} />
          </button>
          {value && (
            <button
              type="button"
              onClick={onClear}
              aria-label="Remove attachment"
              style={{
                padding: '0.25rem',
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-subtle)',
                cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} width="18rem" align="end" mobileFullWidth>
        <div style={{ padding: 'var(--space-3)', display: 'grid', gap: 'var(--space-2)' }}>
          <input
            type="text"
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{
              width: '100%',
              padding: '0.4375rem 0.625rem',
              fontSize: '0.8125rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text)',
              outline: 'none',
            }}
          />
          <div style={{ maxHeight: '14rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {filtered.length === 0 ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', padding: '0.5rem' }}>
                {options.length === 0 ? 'Loading…' : 'No matches.'}
              </p>
            ) : (
              filtered.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onPick(o.id); setOpen(false) }}
                  style={{
                    textAlign: 'left',
                    padding: '0.4375rem 0.625rem',
                    fontSize: '0.8125rem',
                    background: o.id === currentId ? 'var(--color-brand-50)' : 'var(--color-bg)',
                    color: 'var(--color-text)',
                    border: o.id === currentId ? '1px solid var(--color-brand)' : '1px solid var(--color-border-subtle)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      </Popover>
    </div>
  )
}
