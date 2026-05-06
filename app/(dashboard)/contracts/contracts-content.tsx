'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FileSignature, Plus, Search, RefreshCw, Calendar, Building2, Trash2, ExternalLink,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
import { Input, Select } from '@/components/tahi/input'

interface ContractListItem {
  id: string
  orgId: string | null
  orgName: string | null
  dealId: string | null
  proposalId: string | null
  type: string
  name: string
  status: 'draft' | 'sent' | 'partially_signed' | 'signed' | 'expired' | 'cancelled'
  publicShareToken: string | null
  sentAt: string | null
  signedAt: string | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

interface OrgOption { id: string; name: string }
interface TemplateOption { id: string; name: string; type: string }

const TYPE_LABEL: Record<string, string> = {
  nda: 'NDA', sla: 'SLA', msa: 'MSA', sow: 'SOW', mou: 'MOU', other: 'Other',
}
const STATUS_STYLES: Record<ContractListItem['status'], { bg: string; color: string; label: string }> = {
  draft: { bg: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)', label: 'Draft' },
  sent: { bg: '#eff6ff', color: '#1e40af', label: 'Sent' },
  partially_signed: { bg: '#fff7ed', color: '#9a3412', label: 'Partially signed' },
  signed: { bg: '#f0fdf4', color: '#166534', label: 'Signed' },
  expired: { bg: 'var(--color-bg-secondary)', color: 'var(--color-text-subtle)', label: 'Expired' },
  cancelled: { bg: '#fef2f2', color: '#991b1b', label: 'Cancelled' },
}
const STATUS_TABS: { value: 'all' | ContractListItem['status']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'partially_signed', label: 'Partially signed' },
  { value: 'signed', label: 'Signed' },
  { value: 'cancelled', label: 'Cancelled' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export function ContractsContent() {
  const router = useRouter()
  const [items, setItems] = useState<ContractListItem[]>([])
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ContractListItem['status']>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ContractListItem | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [contractsRes, orgsRes, templatesRes] = await Promise.all([
        fetch(apiPath('/api/admin/contracts')),
        fetch(apiPath('/api/admin/clients')),
        fetch(apiPath('/api/admin/contracts/templates')),
      ])
      if (contractsRes.ok) {
        const data = await contractsRes.json() as { items: ContractListItem[] }
        setItems(data.items ?? [])
      } else {
        setItems([])
      }
      if (orgsRes.ok) {
        const data = await orgsRes.json() as { clients: OrgOption[] }
        setOrgs(data.clients ?? [])
      }
      if (templatesRes.ok) {
        const data = await templatesRes.json() as { items: TemplateOption[] }
        setTemplates(data.items ?? [])
      }
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const filtered = items.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    if (typeFilter !== 'all' && c.type !== typeFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!c.name.toLowerCase().includes(q) &&
          !(c.orgName ?? '').toLowerCase().includes(q) &&
          !c.type.toLowerCase().includes(q)) return false
    }
    return true
  })

  async function handleDelete() {
    if (!deleteTarget) return
    const res = await fetch(apiPath(`/api/admin/contracts/${deleteTarget.id}`), { method: 'DELETE' })
    if (res.ok) {
      setDeleteTarget(null)
      void fetchAll()
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts"
        subtitle="NDAs, SOWs, MSAs and other agreements with tamper-evident e-signatures."
      >
        <TahiButton variant="secondary" size="sm" onClick={fetchAll} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
        <Link href="/dashboard/contracts/templates">
          <TahiButton variant="secondary" size="sm">
            Templates
          </TahiButton>
        </Link>
        <TahiButton size="sm" onClick={() => setShowCreate(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
          New contract
        </TahiButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 max-w-sm">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search contracts..."
            leadingIcon={<Search size={14} aria-hidden="true" />}
            style={{ width: '100%' }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={{
                background: statusFilter === tab.value ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
                color: statusFilter === tab.value ? 'white' : 'var(--color-text-muted)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          aria-label="Type filter"
          highlightActive
          options={[
            { value: 'all', label: 'All types' },
            { value: 'nda', label: 'NDA' },
            { value: 'sla', label: 'SLA' },
            { value: 'msa', label: 'MSA' },
            { value: 'sow', label: 'SOW' },
            { value: 'mou', label: 'MOU' },
            { value: 'other', label: 'Other' },
          ]}
        />
      </div>

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : filtered.length === 0 ? (
        items.length === 0 ? (
          <EmptyState
            icon={<FileSignature className="w-8 h-8 text-white" />}
            title="No contracts yet"
            description="Create your first contract — start from a template or paste in custom terms."
            ctaLabel="New contract"
            onCtaClick={() => setShowCreate(true)}
          />
        ) : (
          <EmptyState
            variant="inline"
            icon={<FileSignature className="w-8 h-8" />}
            title="No contracts match your filters"
            description="Try clearing the search or changing the status tab."
          />
        )
      ) : (
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Name</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Type</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden md:table-cell">Org</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden lg:table-cell">Sent</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden lg:table-cell">Expiry</th>
                <th className="text-right px-4 py-3 font-medium text-[var(--color-text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const sty = STATUS_STYLES[c.status]
                return (
                  <tr
                    key={c.id}
                    className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
                    onClick={() => router.push(`/dashboard/contracts/${c.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-text)]">{c.name}</div>
                      {c.orgName && (
                        <div className="text-xs text-[var(--color-text-subtle)] mt-0.5 md:hidden">{c.orgName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
                      >
                        {TYPE_LABEL[c.type] ?? c.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden md:table-cell">
                      {c.orgName ? (
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                          {c.orgName}
                        </div>
                      ) : <span className="text-[var(--color-text-subtle)]">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ background: sty.bg, color: sty.color }}
                      >
                        {sty.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden lg:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                        {formatDate(c.sentAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden lg:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                        {formatDate(c.expiresAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={e => e.stopPropagation()}
                      >
                        {c.publicShareToken && (
                          <a
                            href={`/dashboard/p/contract/${c.publicShareToken}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
                            aria-label="Open public viewer"
                            title="Open public viewer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <button
                          onClick={() => setDeleteTarget(c)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-subtle)] hover:text-red-500 transition-colors"
                          aria-label="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateContractDialog
          orgs={orgs}
          templates={templates}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false)
            router.push(`/dashboard/contracts/${id}`)
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete contract"
        description={deleteTarget ? `Delete "${deleteTarget.name}"? This removes signers and signatures. Cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function CreateContractDialog({
  orgs, templates, onClose, onCreated,
}: {
  orgs: OrgOption[]
  templates: TemplateOption[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'nda' | 'sla' | 'msa' | 'sow' | 'mou' | 'other'>('sow')
  const [orgId, setOrgId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (!templateId && !bodyHtml.trim()) { setError('Pick a template or paste contract body'); return }
    setSaving(true)
    setError('')
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        type,
        orgId: orgId || null,
      }
      if (templateId) {
        body.templateId = templateId
      } else {
        body.bodyHtml = bodyHtml
      }
      const res = await fetch(apiPath('/api/admin/contracts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed to create')
      }
      const data = await res.json() as { id: string }
      onCreated(data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCn = 'w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
      >
        <div className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-bold text-[var(--color-text)]">New contract</h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Start from a template or paste contract body. You&apos;ll add signers on the next screen.</p>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 space-y-4">
          {error && (
            <div className="text-sm px-3 py-2 rounded-lg" role="alert" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
              {error}
            </div>
          )}
          <div>
            <label htmlFor="ctr-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Name <span style={{ color: 'var(--color-danger)' }}>*</span>
            </label>
            <input id="ctr-name" type="text" value={name} onChange={e => setName(e.target.value)} className={inputCn} placeholder="e.g. Giant Group — Statement of Work" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="ctr-type" className="block text-sm font-medium text-[var(--color-text)] mb-1">Type</label>
              <select id="ctr-type" value={type} onChange={e => setType(e.target.value as typeof type)} className={inputCn}>
                <option value="nda">NDA</option>
                <option value="sla">SLA</option>
                <option value="msa">MSA</option>
                <option value="sow">SOW</option>
                <option value="mou">MOU</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label htmlFor="ctr-org" className="block text-sm font-medium text-[var(--color-text)] mb-1">Organisation</label>
              <select id="ctr-org" value={orgId} onChange={e => setOrgId(e.target.value)} className={inputCn}>
                <option value="">— None —</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="ctr-template" className="block text-sm font-medium text-[var(--color-text)] mb-1">From template</label>
            <select id="ctr-template" value={templateId} onChange={e => setTemplateId(e.target.value)} className={inputCn}>
              <option value="">— Custom HTML —</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name} · {TYPE_LABEL[t.type] ?? t.type}</option>)}
            </select>
          </div>
          {!templateId && (
            <div>
              <label htmlFor="ctr-body" className="block text-sm font-medium text-[var(--color-text)] mb-1">Contract body (HTML)</label>
              <textarea id="ctr-body" rows={6} value={bodyHtml} onChange={e => setBodyHtml(e.target.value)} className={inputCn} placeholder="<h2>Statement of Work</h2><p>...</p>" />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <TahiButton variant="secondary" type="button" onClick={onClose}>Cancel</TahiButton>
            <TahiButton type="submit" loading={saving}>Create &amp; edit</TahiButton>
          </div>
        </form>
      </div>
    </div>
  )
}
