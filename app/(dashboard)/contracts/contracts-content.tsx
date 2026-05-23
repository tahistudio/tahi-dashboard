'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  FileSignature, Plus, RefreshCw, Calendar, Building2, Trash2, ExternalLink,
  Save,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { EmptyState } from '@/components/tahi/empty-state'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { SlideOver } from '@/components/tahi/slide-over'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import { Input, Select } from '@/components/tahi/input'
import { PageHeader } from '@/components/tahi/page-header'
import { TiptapDocEditor } from '@/components/tahi/tiptap-doc-editor'
import { apiPath } from '@/lib/api'

// -- Types --

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

type ContractStatus = ContractListItem['status']
type ContractType = 'nda' | 'sla' | 'msa' | 'sow' | 'mou' | 'other'

// -- Static tables --

const TYPE_OPTIONS: { value: ContractType; label: string; tone: BadgeTone }[] = [
  { value: 'nda',   label: 'NDA',   tone: 'info'    },
  { value: 'sla',   label: 'SLA',   tone: 'teal'    },
  { value: 'msa',   label: 'MSA',   tone: 'purple'  },
  { value: 'sow',   label: 'SOW',   tone: 'brand'   },
  { value: 'mou',   label: 'MOU',   tone: 'warning' },
  { value: 'other', label: 'Other', tone: 'neutral' },
]
const TYPE_BY_VALUE = new Map(TYPE_OPTIONS.map(t => [t.value, t]))

const STATUS_OPTIONS: { value: ContractStatus; label: string; tone: BadgeTone }[] = [
  { value: 'draft',            label: 'Draft',            tone: 'neutral'  },
  { value: 'sent',             label: 'Sent',             tone: 'info'     },
  { value: 'partially_signed', label: 'Partially signed', tone: 'warning'  },
  { value: 'signed',           label: 'Signed',           tone: 'positive' },
  { value: 'expired',          label: 'Expired',          tone: 'neutral'  },
  { value: 'cancelled',        label: 'Cancelled',        tone: 'danger'   },
]
const STATUS_BY_VALUE = new Map(STATUS_OPTIONS.map(s => [s.value, s]))

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

// -- Main component --

export function ContractsContent() {
  const router = useRouter()
  const [items, setItems] = useState<ContractListItem[]>([])
  const [orgs, setOrgs] = useState<OrgOption[]>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // Two permanent FilterBar chips: status + type. nonRemovable so the
  // X never appears and the "+ Add filter" button is hidden.
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([
    { id: 'status', values: [] },
    { id: 'type',   values: [] },
  ])
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ContractListItem | null>(null)

  const selectedStatuses = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'status')
    return new Set(f?.values ?? [])
  }, [activeFilters])
  const selectedTypes = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'type')
    return new Set(f?.values ?? [])
  }, [activeFilters])

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(c => {
      if (selectedStatuses.size > 0 && !selectedStatuses.has(c.status)) return false
      if (selectedTypes.size > 0 && !selectedTypes.has(c.type)) return false
      if (q) {
        if (!c.name.toLowerCase().includes(q) &&
            !(c.orgName ?? '').toLowerCase().includes(q) &&
            !c.type.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [items, search, selectedStatuses, selectedTypes])

  // Two-chip FilterBar setup. Status + Type, both multiselect,
  // nonRemovable so the bar reads as the locked filter surface.
  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'status',
      label: 'Status',
      kind: 'multiselect',
      nonRemovable: true,
      options: STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label, tone: s.tone })),
    },
    {
      id: 'type',
      label: 'Type',
      kind: 'multiselect',
      nonRemovable: true,
      options: TYPE_OPTIONS.map(t => ({ value: t.value, label: t.label, tone: t.tone })),
    },
  ]), [])

  async function handleDelete() {
    if (!deleteTarget) return
    const res = await fetch(apiPath(`/api/admin/contracts/${deleteTarget.id}`), { method: 'DELETE' })
    if (res.ok) {
      setDeleteTarget(null)
      void fetchAll()
    }
  }

  // -- DataTable columns. Mirrors docs-content.tsx structure. --
  const columns: DataTableColumn<ContractListItem>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: r => r.name.toLowerCase(),
      minWidth: '18rem',
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <FileSignature size={14} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
          <span style={{
            fontWeight: 600,
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{r.name}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      sortValue: r => r.type,
      width: '7rem',
      render: r => {
        const def = TYPE_BY_VALUE.get(r.type as ContractType)
        return (
          <Badge tone={def?.tone ?? 'neutral'} variant="soft" size="sm">
            {def?.label ?? r.type.toUpperCase()}
          </Badge>
        )
      },
    },
    {
      key: 'org',
      header: 'Org',
      sortable: true,
      sortValue: r => (r.orgName ?? '').toLowerCase(),
      minWidth: '12rem',
      render: r => r.orgName ? (
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3125rem',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
          minWidth: 0,
        }}>
          <Building2 size={12} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.orgName}</span>
        </div>
      ) : <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.75rem' }}>—</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      width: '10rem',
      render: r => {
        const def = STATUS_BY_VALUE.get(r.status)
        return (
          <Badge tone={def?.tone ?? 'neutral'} variant="soft" size="sm" dot>
            {def?.label ?? r.status}
          </Badge>
        )
      },
    },
    {
      key: 'sentAt',
      header: 'Sent',
      sortable: true,
      sortValue: r => r.sentAt ?? '',
      width: '9rem',
      render: r => (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3125rem',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
        }}>
          <Calendar size={11} aria-hidden="true" />
          {formatDate(r.sentAt)}
        </span>
      ),
    },
    {
      key: 'expiresAt',
      header: 'Expiry',
      sortable: true,
      sortValue: r => r.expiresAt ?? '',
      width: '9rem',
      render: r => (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3125rem',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
        }}>
          <Calendar size={11} aria-hidden="true" />
          {formatDate(r.expiresAt)}
        </span>
      ),
    },
  ]

  return (
    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <PageHeader
        title="Contracts"
        subtitle="NDAs, SOWs, MSAs and other agreements with tamper-evident e-signatures."
      >
        <TahiButton variant="secondary" size="sm" onClick={fetchAll} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
        <Link href="/contracts/templates">
          <TahiButton variant="secondary" size="sm">
            Templates
          </TahiButton>
        </Link>
        <TahiButton size="sm" onClick={() => setShowCreate(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
          New contract
        </TahiButton>
      </PageHeader>

      {/* Filter row — status + type chips, both multiselect and pinned. */}
      <FilterBar
        filters={filterDefs}
        active={activeFilters}
        onChange={setActiveFilters}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search contracts by name, org or type',
        }}
        size="sm"
      />

      {/* Table — wrapped in a Card so rows clip cleanly to the rounded
          surface, matching the Docs hub. */}
      <Card padding="none">
        <DataTable<ContractListItem>
          ariaLabel="Contracts"
          columns={columns}
          rows={filtered}
          getRowId={r => r.id}
          defaultSort={{ key: 'sentAt', dir: 'desc' }}
          loading={loading}
          empty={
            <EmptyState
              icon={<FileSignature className="w-6 h-6" />}
              title={items.length === 0 ? 'No contracts yet' : 'No matches'}
              description={items.length === 0
                ? 'Create your first contract. Start from a template or paste in custom terms.'
                : 'Try clearing a filter or adjusting your search.'}
              action={
                items.length === 0 ? (
                  <TahiButton size="sm" onClick={() => setShowCreate(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
                    New contract
                  </TahiButton>
                ) : undefined
              }
            />
          }
          onRowClick={r => router.push(`/contracts/${r.id}`)}
          rowActions={r => {
            const actions = [
              {
                label: 'Open',
                icon: <FileSignature size={14} />,
                onClick: () => router.push(`/contracts/${r.id}`),
              },
            ]
            if (r.publicShareToken) {
              actions.push({
                label: 'Public viewer',
                icon: <ExternalLink size={14} />,
                onClick: () => window.open(`/dashboard/p/contract/${r.publicShareToken}`, '_blank', 'noreferrer'),
              })
            }
            actions.push({
              label: 'Delete',
              icon: <Trash2 size={14} />,
              onClick: () => setDeleteTarget(r),
            })
            return actions.map(a => a.label === 'Delete' ? { ...a, tone: 'danger' as const } : a)
          }}
        />
      </Card>

      {/* Create slide-over — 48rem matches the locked design-system width. */}
      <CreateContractSlideOver
        open={showCreate}
        orgs={orgs}
        templates={templates}
        onClose={() => setShowCreate(false)}
        onCreated={(id) => {
          setShowCreate(false)
          router.push(`/contracts/${id}`)
        }}
      />

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

// -- Create slide-over --

function CreateContractSlideOver({
  open, orgs, templates, onClose, onCreated,
}: {
  open: boolean
  orgs: OrgOption[]
  templates: TemplateOption[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ContractType>('sow')
  const [orgId, setOrgId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Reset form whenever the slide-over closes so a re-open is fresh.
  useEffect(() => {
    if (!open) {
      setName('')
      setType('sow')
      setOrgId('')
      setTemplateId('')
      setBodyHtml('')
      setError('')
    }
  }, [open])

  async function submit() {
    if (!name.trim()) { setError('Name is required'); return }
    if (!templateId && !bodyHtml.trim()) { setError('Pick a template or write the contract body'); return }
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

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      icon={<Plus size={15} />}
      title="New contract"
      subtitle="Start from a template or write the body inline. Add signers after creating."
      maxWidth="48rem"
    >
      <SlideOver.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {error && (
            <div
              role="alert"
              style={{
                fontSize: '0.8125rem',
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-danger-bg)',
                color: 'var(--color-danger)',
              }}
            >
              {error}
            </div>
          )}

          <FieldLabel label="Name" required>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Giant Group — Statement of Work"
              inputSize="md"
              style={{ width: '100%' }}
            />
          </FieldLabel>

          {/* Two-column row: type takes ~1.5fr, org takes ~1fr. Matches
              the proportions used in the Docs hub edit form. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)',
              gap: '0.75rem',
            }}
          >
            <FieldLabel label="Type">
              <Select
                value={type}
                onChange={e => setType(e.target.value as ContractType)}
                aria-label="Contract type"
                style={{ width: '100%' }}
                options={TYPE_OPTIONS.map(t => ({ value: t.value, label: t.label }))}
              />
            </FieldLabel>
            <FieldLabel label="Organisation">
              <Select
                value={orgId}
                onChange={e => setOrgId(e.target.value)}
                aria-label="Organisation"
                style={{ width: '100%' }}
                options={[
                  { value: '', label: '— None —' },
                  ...orgs.map(o => ({ value: o.id, label: o.name })),
                ]}
              />
            </FieldLabel>
          </div>

          <FieldLabel
            label="From template"
            helper="Pick a saved template, or leave as Custom and write the body below."
          >
            <Select
              value={templateId}
              onChange={e => setTemplateId(e.target.value)}
              aria-label="Template"
              style={{ width: '100%' }}
              options={[
                { value: '', label: '— Custom body —' },
                ...templates.map(t => ({
                  value: t.id,
                  label: `${t.name} · ${TYPE_BY_VALUE.get(t.type as ContractType)?.label ?? t.type.toUpperCase()}`,
                })),
              ]}
            />
          </FieldLabel>

          {!templateId && (
            <FieldLabel label="Contract body">
              <TiptapDocEditor
                content={bodyHtml}
                onChange={(html) => setBodyHtml(html)}
                placeholder="Write the contract body. You can refine and add signers after creating."
              />
            </FieldLabel>
          )}
        </div>
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </TahiButton>
        <div style={{ flex: 1 }} />
        <TahiButton
          size="sm"
          onClick={() => void submit()}
          disabled={saving || !name.trim()}
          iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        >
          {saving ? 'Creating...' : 'Create & edit'}
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}

// Small label shell used inside the new-contract form. Keeps the
// uppercase micro-label + helper line consistent with the Docs hub edit
// form's category field label.
function FieldLabel({
  label, helper, required = false, children,
}: {
  label: string
  helper?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        style={{
          display: 'block',
          fontSize: '0.625rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
          marginBottom: '0.3125rem',
        }}
      >
        {label}
        {required && <span style={{ color: 'var(--color-danger)', marginLeft: '0.25rem' }}>*</span>}
        {helper && (
          <span style={{
            textTransform: 'none',
            letterSpacing: 0,
            fontWeight: 400,
            color: 'var(--color-text-subtle)',
            marginLeft: '0.375rem',
          }}>
            · {helper}
          </span>
        )}
      </label>
      {children}
    </div>
  )
}
