'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Save, FileSignature, Edit3, RefreshCw } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { EmptyState } from '@/components/tahi/empty-state'
import { SlideOver } from '@/components/tahi/slide-over'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import { Input, Select } from '@/components/tahi/input'
import { PageHeader } from '@/components/tahi/page-header'
import { TiptapDocEditor } from '@/components/tahi/tiptap-doc-editor'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'

// -- Types --

interface Template {
  id: string
  type: string
  name: string
  bodyHtml: string
  variableDefs: string | null
  isDefault: number
  description: string | null
  createdAt: string
  updatedAt: string
}

type TemplateType = 'nda' | 'sla' | 'msa' | 'sow' | 'mou' | 'other'

const TYPE_OPTIONS: { value: TemplateType; label: string; tone: BadgeTone }[] = [
  { value: 'nda',   label: 'NDA',   tone: 'info'    },
  { value: 'sla',   label: 'SLA',   tone: 'teal'    },
  { value: 'msa',   label: 'MSA',   tone: 'purple'  },
  { value: 'sow',   label: 'SOW',   tone: 'brand'   },
  { value: 'mou',   label: 'MOU',   tone: 'warning' },
  { value: 'other', label: 'Other', tone: 'neutral' },
]
const TYPE_BY_VALUE = new Map(TYPE_OPTIONS.map(t => [t.value, t]))

export function TemplatesContent() {
  const { showToast } = useToast()
  const [items, setItems] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Template | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null)
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([
    { id: 'type', values: [] },
  ])
  const selectedTypes = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'type')
    return new Set(f?.values ?? [])
  }, [activeFilters])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/contracts/templates'))
      if (!res.ok) throw new Error('failed')
      const data = await res.json() as { items: Template[] }
      setItems(data.items ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(t => {
      if (selectedTypes.size > 0 && !selectedTypes.has(t.type)) return false
      if (q) {
        if (!t.name.toLowerCase().includes(q) &&
            !(t.description ?? '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [items, search, selectedTypes])

  const filterDefs: FilterDef[] = useMemo(() => ([
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
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/templates/${deleteTarget.id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      setDeleteTarget(null)
      void fetchAll()
    } catch {
      showToast('Could not delete.', 'error')
    }
  }

  const columns: DataTableColumn<Template>[] = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      sortValue: r => r.name.toLowerCase(),
      minWidth: '18rem',
      render: r => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', minWidth: 0 }}>
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
          {r.description && (
            <span style={{
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              paddingLeft: '1.375rem',
            }}>{r.description}</span>
          )}
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
        const def = TYPE_BY_VALUE.get(r.type as TemplateType)
        return (
          <Badge tone={def?.tone ?? 'neutral'} variant="soft" size="sm">
            {def?.label ?? r.type.toUpperCase()}
          </Badge>
        )
      },
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortable: true,
      sortValue: r => r.updatedAt,
      width: '11rem',
      render: r => (
        <span style={{
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
        }}>
          {new Date(r.updatedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
      ),
    },
  ]

  return (
    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      <div>
        <Link
          href="/contracts"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            fontSize: '0.8125rem',
            color: 'var(--color-text-muted)',
            textDecoration: 'none',
            transition: 'color 120ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
        >
          <ArrowLeft size={14} aria-hidden="true" /> Back to contracts
        </Link>
      </div>

      <PageHeader
        title="Contract templates"
        subtitle="Reusable contract bodies. Use {{variable}} for slots filled at create time."
      >
        <TahiButton size="sm" onClick={() => setShowCreate(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
          New template
        </TahiButton>
      </PageHeader>

      <FilterBar
        filters={filterDefs}
        active={activeFilters}
        onChange={setActiveFilters}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search templates by name or description',
        }}
        size="sm"
      />

      <Card padding="none">
        <DataTable<Template>
          ariaLabel="Contract templates"
          columns={columns}
          rows={filtered}
          getRowId={r => r.id}
          defaultSort={{ key: 'updatedAt', dir: 'desc' }}
          loading={loading}
          empty={
            <EmptyState
              icon={<FileSignature className="w-6 h-6" />}
              title={items.length === 0 ? 'No templates yet' : 'No matches'}
              description={items.length === 0
                ? 'Templates speed up contract creation. Author once, fill slots per client.'
                : 'Try clearing a filter or adjusting your search.'}
              action={
                items.length === 0 ? (
                  <TahiButton size="sm" onClick={() => setShowCreate(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
                    New template
                  </TahiButton>
                ) : undefined
              }
            />
          }
          onRowPreview={r => setEditing(r)}
          rowActions={r => [
            { label: 'Edit', icon: <Edit3 size={14} />, onClick: () => setEditing(r) },
            { label: 'Delete', icon: <Trash2 size={14} />, tone: 'danger', onClick: () => setDeleteTarget(r) },
          ]}
        />
      </Card>

      <TemplateSlideOver
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSaved={() => { setShowCreate(false); void fetchAll() }}
      />
      <TemplateSlideOver
        open={!!editing}
        template={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); void fetchAll() }}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete template"
        description={deleteTarget ? `Delete "${deleteTarget.name}"? Existing contracts using this template are not affected.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function TemplateSlideOver({
  open, template, onClose, onSaved,
}: {
  open: boolean
  template?: Template
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<TemplateType>('sow')
  const [description, setDescription] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Re-sync form when the source template changes (open, switch row).
  useEffect(() => {
    if (!open) return
    setName(template?.name ?? '')
    setType((template?.type as TemplateType) ?? 'sow')
    setDescription(template?.description ?? '')
    setBodyHtml(template?.bodyHtml ?? '')
    setError('')
  }, [open, template])

  async function submit() {
    if (!name.trim() || !bodyHtml.trim()) { setError('Name and body required'); return }
    setSaving(true)
    setError('')
    try {
      const url = template ? `/api/admin/contracts/templates/${template.id}` : '/api/admin/contracts/templates'
      const method = template ? 'PATCH' : 'POST'
      const res = await fetch(apiPath(url), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type,
          description: description.trim() || null,
          bodyHtml,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed')
      }
      onSaved()
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
      icon={template ? <Edit3 size={15} /> : <Plus size={15} />}
      title={template ? 'Edit template' : 'New template'}
      subtitle={template
        ? 'Update the body. Existing contracts using this template are unaffected.'
        : 'Reusable contract body. Use {{variable}} placeholders for slots.'}
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

          {/* Name + type on one row. Same 1.5fr / 1fr proportions used in
              the create-contract slide-over. */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)',
              gap: '0.75rem',
            }}
          >
            <FieldLabel label="Name" required>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Standard SOW"
                inputSize="md"
                style={{ width: '100%' }}
              />
            </FieldLabel>
            <FieldLabel label="Type">
              <Select
                value={type}
                onChange={e => setType(e.target.value as TemplateType)}
                aria-label="Template type"
                style={{ width: '100%' }}
                options={TYPE_OPTIONS.map(t => ({ value: t.value, label: t.label }))}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Description" helper="Optional. Shown on the template list.">
            <Input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What this template is used for"
              inputSize="md"
              style={{ width: '100%' }}
            />
          </FieldLabel>

          <FieldLabel
            label="Body"
            helper="Use {{variable}} placeholders for slots filled at create time, e.g. {{client_name}}."
          >
            <TiptapDocEditor
              content={bodyHtml}
              onChange={(html) => setBodyHtml(html)}
              placeholder="Write the template body — every contract built from this starts here."
            />
          </FieldLabel>
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
          disabled={saving || !name.trim() || !bodyHtml.trim()}
          iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        >
          {saving ? 'Saving...' : (template ? 'Save' : 'Create')}
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}

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
