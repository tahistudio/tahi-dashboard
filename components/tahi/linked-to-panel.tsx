/**
 * <LinkedToPanel> — universal linkage editor for proposal / contract /
 * schedule resources.
 *
 * Shows the current org / deal / proposal links with inline change + remove
 * buttons. Patches the resource via the existing detail PATCH endpoint;
 * activity-log entries on the affected deals fire server-side.
 *
 * Surface only what the resource type actually supports:
 *   - Proposal:  org + deal
 *   - Schedule:  org + deal + proposal
 *   - Contract:  org + deal + proposal
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Building2, TrendingUp, FileText, Link2, X, ChevronDown } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'

interface OrgOption { id: string; name: string }
interface DealOption { id: string; title: string; orgId: string | null; orgName: string | null; stageName: string | null }
interface ProposalOption { id: string; title: string; orgId: string | null; orgName: string | null; status: string }

interface Props {
  /** Which resource to patch. Drives the PATCH endpoint and which fields show. */
  resourceType: 'proposal' | 'schedule' | 'contract'
  resourceId: string
  /** Current values from the loaded resource. */
  orgId: string | null
  dealId: string | null
  /** Only used for schedule + contract. Null/undefined for proposal (it doesn't link to other proposals). */
  proposalId?: string | null
  /** Display labels — provided by the parent so we don't re-fetch on mount. */
  orgName?: string | null
  dealTitle?: string | null
  proposalTitle?: string | null
  /** Called after a successful PATCH so the parent can refresh its state. */
  onChanged?: () => void
}

const resourceLabel = {
  proposal: 'proposal',
  schedule: 'schedule',
  contract: 'contract',
} as const

export function LinkedToPanel({
  resourceType, resourceId, orgId, dealId, proposalId, orgName: orgNameProp, dealTitle: dealTitleProp, proposalTitle: proposalTitleProp, onChanged,
}: Props) {
  const { showToast } = useToast()
  const [editing, setEditing] = useState<null | 'org' | 'deal' | 'proposal'>(null)
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [deals, setDeals] = useState<DealOption[]>([])
  const [proposals, setProposals] = useState<ProposalOption[]>([])
  const [busy, setBusy] = useState(false)
  // Resolved labels — start with the props if provided, fall back to looking
  // up in the loaded option lists once they've been fetched.
  const [resolvedOrgName, setResolvedOrgName] = useState<string | null>(orgNameProp ?? null)
  const [resolvedDealTitle, setResolvedDealTitle] = useState<string | null>(dealTitleProp ?? null)
  const [resolvedProposalTitle, setResolvedProposalTitle] = useState<string | null>(proposalTitleProp ?? null)

  // Eagerly fetch enough to render the current labels when the parent
  // didn't supply them. Skip lookups when the link is null or already named.
  useEffect(() => {
    let cancelled = false
    async function resolveOrg() {
      if (!orgId || resolvedOrgName) return
      const r = await fetch(apiPath('/api/admin/clients')).catch(() => null)
      if (!r?.ok || cancelled) return
      const data = await r.json() as { clients?: OrgOption[] }
      setOrgs(data.clients ?? [])
      const hit = (data.clients ?? []).find(o => o.id === orgId)
      if (hit) setResolvedOrgName(hit.name)
    }
    async function resolveDeal() {
      if (!dealId || resolvedDealTitle) return
      const r = await fetch(apiPath('/api/admin/deals')).catch(() => null)
      if (!r?.ok || cancelled) return
      const data = await r.json() as { items?: DealOption[]; deals?: DealOption[] }
      const list = data.items ?? data.deals ?? []
      setDeals(list)
      const hit = list.find(d => d.id === dealId)
      if (hit) setResolvedDealTitle(hit.title)
    }
    async function resolveProposal() {
      if (!proposalId || resolvedProposalTitle) return
      const r = await fetch(apiPath('/api/admin/proposals')).catch(() => null)
      if (!r?.ok || cancelled) return
      const data = await r.json() as { items?: ProposalOption[] }
      const list = data.items ?? []
      setProposals(list)
      const hit = list.find(p => p.id === proposalId)
      if (hit) setResolvedProposalTitle(hit.title)
    }
    void resolveOrg(); void resolveDeal(); void resolveProposal()
    return () => { cancelled = true }
  }, [orgId, dealId, proposalId, resolvedOrgName, resolvedDealTitle, resolvedProposalTitle])

  const orgName = resolvedOrgName
  const dealTitle = resolvedDealTitle
  const proposalTitle = resolvedProposalTitle
  const showProposalRow = resourceType !== 'proposal'

  // Lazy-load options when an editor opens.
  useEffect(() => {
    if (!editing) return
    let cancelled = false
    async function load() {
      try {
        if (editing === 'org' && orgs.length === 0) {
          const r = await fetch(apiPath('/api/admin/clients'))
          if (r.ok && !cancelled) {
            const data = await r.json() as { clients?: OrgOption[] }
            setOrgs(data.clients ?? [])
          }
        }
        if (editing === 'deal' && deals.length === 0) {
          const r = await fetch(apiPath('/api/admin/deals'))
          if (r.ok && !cancelled) {
            const data = await r.json() as { items?: DealOption[]; deals?: DealOption[] }
            setDeals(data.items ?? data.deals ?? [])
          }
        }
        if (editing === 'proposal' && proposals.length === 0) {
          const r = await fetch(apiPath('/api/admin/proposals'))
          if (r.ok && !cancelled) {
            const data = await r.json() as { items?: ProposalOption[] }
            setProposals(data.items ?? [])
          }
        }
      } catch { /* silent */ }
    }
    void load()
    return () => { cancelled = true }
  }, [editing, orgs.length, deals.length, proposals.length])

  // Patch the resource via its detail endpoint.
  const patch = useCallback(async (changes: Record<string, string | null>) => {
    setBusy(true)
    try {
      const url = `/api/admin/${resourceType === 'proposal' ? 'proposals' : resourceType === 'schedule' ? 'schedules' : 'contracts'}/${resourceId}`
      const res = await fetch(apiPath(url), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      if (!res.ok) throw new Error('Failed')
      onChanged?.()
      setEditing(null)
    } catch {
      showToast(`Could not update ${resourceLabel[resourceType]} link.`, 'error')
    } finally {
      setBusy(false)
    }
  }, [resourceType, resourceId, onChanged, showToast])

  // Filter dropdown options to the relevant org where appropriate.
  const dealOptions = deals.filter(d => !orgId || d.orgId === orgId || !d.orgId)
  const proposalOptions = proposals.filter(p => !orgId || p.orgId === orgId || !p.orgId)

  return (
    <div
      className="rounded-xl"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        padding: 'var(--space-4) var(--space-5)',
      }}
    >
      <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <Link2 className="w-3.5 h-3.5" style={{ color: 'var(--color-text-muted)' }} />
        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Linked to
        </span>
      </div>

      <div className="grid" style={{ gap: 'var(--space-2)' }}>
        <LinkRow
          icon={<Building2 className="w-3.5 h-3.5" />}
          label="Client"
          valueLabel={orgName ?? null}
          valueHref={orgId ? `/clients/${orgId}` : null}
          onChange={() => setEditing('org')}
          onRemove={orgId ? () => patch({ orgId: null }) : null}
          editing={editing === 'org'}
          onClose={() => setEditing(null)}
        >
          {editing === 'org' && (
            <PickerRow
              busy={busy}
              currentId={orgId}
              options={orgs.map(o => ({ id: o.id, label: o.name }))}
              onPick={(id) => patch({ orgId: id })}
              onClose={() => setEditing(null)}
            />
          )}
        </LinkRow>

        <LinkRow
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          label="Deal"
          valueLabel={dealTitle ?? null}
          valueHref={dealId ? `/pipeline/${dealId}` : null}
          onChange={() => setEditing('deal')}
          onRemove={dealId ? () => patch({ dealId: null }) : null}
          editing={editing === 'deal'}
          onClose={() => setEditing(null)}
        >
          {editing === 'deal' && (
            <PickerRow
              busy={busy}
              currentId={dealId}
              options={dealOptions.map(d => ({ id: d.id, label: `${d.title}${d.orgName ? ` · ${d.orgName}` : ''}${d.stageName ? ` · ${d.stageName}` : ''}` }))}
              onPick={(id) => patch({ dealId: id })}
              onClose={() => setEditing(null)}
            />
          )}
        </LinkRow>

        {showProposalRow && (
          <LinkRow
            icon={<FileText className="w-3.5 h-3.5" />}
            label="Proposal"
            valueLabel={proposalTitle ?? null}
            valueHref={proposalId ? `/proposals/${proposalId}` : null}
            onChange={() => setEditing('proposal')}
            onRemove={proposalId ? () => patch({ proposalId: null }) : null}
            editing={editing === 'proposal'}
            onClose={() => setEditing(null)}
          >
            {editing === 'proposal' && (
              <PickerRow
                busy={busy}
                currentId={proposalId ?? null}
                options={proposalOptions.map(p => ({ id: p.id, label: `${p.title}${p.orgName ? ` · ${p.orgName}` : ''}` }))}
                onPick={(id) => patch({ proposalId: id })}
                onClose={() => setEditing(null)}
              />
            )}
          </LinkRow>
        )}
      </div>
    </div>
  )
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function LinkRow({
  icon, label, valueLabel, valueHref, onChange, onRemove, editing, onClose, children,
}: {
  icon: React.ReactNode
  label: string
  valueLabel: string | null
  valueHref: string | null
  onChange: () => void
  onRemove: (() => void) | null
  editing: boolean
  onClose: () => void
  children?: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div className="flex items-center" style={{ gap: 'var(--space-1-5)', minWidth: '4.5rem', color: 'var(--color-text-muted)' }}>
          {icon}
          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{label}</span>
        </div>
        <div className="flex items-center" style={{ gap: 'var(--space-2)', flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
          {valueLabel && valueHref ? (
            <Link
              href={valueHref}
              className="truncate"
              style={{ fontSize: '0.875rem', color: 'var(--color-text)', textDecoration: 'none', fontWeight: 500 }}
            >
              {valueLabel}
            </Link>
          ) : (
            <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>Not linked</span>
          )}
          <div className="flex items-center" style={{ gap: 'var(--space-1), marginLeft: auto' }}>
            <button
              onClick={editing ? onClose : onChange}
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
              {valueLabel ? 'Change' : 'Link'}
              <ChevronDown size={11} />
            </button>
            {onRemove && (
              <button
                onClick={onRemove}
                aria-label="Remove link"
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
      </div>
      {children}
    </div>
  )
}

function PickerRow({
  busy, currentId, options, onPick, onClose,
}: {
  busy: boolean
  currentId: string | null
  options: Array<{ id: string; label: string }>
  onPick: (id: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const filtered = options.filter(o => !search.trim() || o.label.toLowerCase().includes(search.toLowerCase()))
  return (
    <div
      style={{
        marginTop: 'var(--space-2)',
        padding: 'var(--space-3)',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        display: 'grid',
        gap: 'var(--space-2)',
      }}
    >
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
      <div
        style={{
          maxHeight: '12rem',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        }}
      >
        {filtered.length === 0 ? (
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', padding: '0.5rem' }}>
            {options.length === 0 ? 'Loading…' : 'No matches.'}
          </p>
        ) : (
          filtered.map(o => (
            <button
              key={o.id}
              onClick={() => { if (!busy) onPick(o.id) }}
              disabled={busy}
              style={{
                textAlign: 'left',
                padding: '0.4375rem 0.625rem',
                fontSize: '0.8125rem',
                background: o.id === currentId ? 'var(--color-brand-50)' : 'var(--color-bg)',
                color: 'var(--color-text)',
                border: o.id === currentId ? '1px solid var(--color-brand)' : '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {o.label}
            </button>
          ))
        )}
      </div>
      <button
        onClick={onClose}
        style={{
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'right',
        }}
      >
        Cancel
      </button>
    </div>
  )
}
