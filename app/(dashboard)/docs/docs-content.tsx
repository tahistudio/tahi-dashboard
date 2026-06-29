'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import useSWR from 'swr'
import { useSearchParams } from 'next/navigation'
import {
  BookOpen, Plus, Clock, Save,
  Trash2, History, RefreshCw, FileText, Edit3, ArrowLeft,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { EmptyState } from '@/components/tahi/empty-state'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input } from '@/components/tahi/input'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import dynamic from 'next/dynamic'
const TiptapDocEditor = dynamic(
  () => import('@/components/tahi/tiptap-doc-editor').then(m => ({ default: m.TiptapDocEditor })),
  { ssr: false },
)
import { apiPath } from '@/lib/api'
import { renderMarkdown, looksLikeHtml } from '@/lib/markdown'
import { formatDistanceToNow } from 'date-fns'

// -- Types --

interface DocPage {
  id: string
  parentId: string | null
  category: string  // comma-separated list of category values
  title: string
  slug: string
  contentTiptap: string | null
  contentText: string | null
  authorId: string | null
  createdAt: string
  updatedAt: string
}

interface DocVersion {
  id: string
  pageId: string
  contentTiptap: string | null
  savedById: string | null
  savedAt: string
}

interface DocCategory {
  value: string
  label: string
  tone: BadgeTone
}

const CATEGORIES: DocCategory[] = [
  { value: 'brand',      label: 'Brand',      tone: 'brand'    },
  { value: 'services',   label: 'Services',   tone: 'teal'     },
  { value: 'sales',      label: 'Sales',      tone: 'warning'  },
  { value: 'operations', label: 'Operations', tone: 'purple'   },
  { value: 'team',       label: 'Team',       tone: 'info'     },
  { value: 'product',    label: 'Product',    tone: 'rose'     },
]

const CATEGORY_BY_VALUE = new Map(CATEGORIES.map(c => [c.value, c]))

// Categories are stored in the existing single text column as a
// comma-separated list ("brand,sales"). Legacy single-value rows
// ("brand") stay valid — splitting still returns one item. Empty
// or whitespace-only strings yield an empty array.
function parseCats(s: string | null | undefined): string[] {
  if (!s) return []
  return s.split(',').map(t => t.trim()).filter(Boolean)
}
function joinCats(cats: string[]): string {
  return cats.join(',')
}

// renderMarkdown + looksLikeHtml now live in lib/markdown.ts (shared
// with the Sitemap spec view).

// -- Main Component --

export function DocsContent() {
  const { data: pagesData, isLoading: loading, mutate: mutatePages } = useSWR<{ pages: DocPage[] }>('/api/admin/docs')
  const pages = pagesData?.pages ?? []
  const [search, setSearch] = useState('')
  // FilterBar-style: active filters held as an array of ActiveFilter.
  // We seed it with the Categories chip already present so it can't be
  // removed (nonRemovable on the def) and the "+ Add filter" button
  // never appears — categories is the only filter we want here.
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([
    { id: 'categories', values: [] },
  ])
  // Read the selected categories out of the categories filter chip,
  // if it's active. Empty = no filter.
  const selectedCategories = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'categories')
    return new Set(f?.values ?? [])
  }, [activeFilters])
  // Historical version the user is viewing. Null = current.
  const [viewingVersion, setViewingVersion] = useState<DocVersion | null>(null)

  const [selectedPage, setSelectedPage] = useState<DocPage | null>(null)
  const [versions, setVersions] = useState<DocVersion[]>([])
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editCategories, setEditCategories] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<DocPage | null>(null)

  const loadPage = useCallback(async (id: string) => {
    try {
      const res = await fetch(apiPath(`/api/admin/docs/${id}`))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { page: DocPage; versions: DocVersion[] }
      setSelectedPage(data.page)
      setVersions(data.versions)
      setEditing(false)
      setShowVersions(false)
      setViewingVersion(null)
    } catch {
      // ignore
    }
  }, [])

  // Auto-open from ?doc=<id>
  const searchParams = useSearchParams()
  const docParam = searchParams?.get('doc') ?? null
  const lastDocParamRef = useRef<string | null>(null)
  useEffect(() => {
    if (!docParam) return
    if (lastDocParamRef.current === docParam) return
    lastDocParamRef.current = docParam
    void loadPage(docParam)
  }, [docParam, loadPage])

  const filteredPages = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pages.filter(p => {
      const cats = parseCats(p.category)
      if (selectedCategories.size > 0) {
        // Item must carry AT LEAST ONE of the active categories.
        if (!cats.some(c => selectedCategories.has(c))) return false
      }
      if (q) {
        const inTitle = p.title.toLowerCase().includes(q)
        const inBody = (p.contentText ?? '').toLowerCase().includes(q)
        if (!inTitle && !inBody) return false
      }
      return true
    })
  }, [pages, search, selectedCategories])

  // Filter definitions for FilterBar. Categories is multiselect so a
  // single chip can hold any subset. nonRemovable hides the X and
  // makes it the only chip on the bar — no "+ Add filter" button.
  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'categories',
      label: 'Categories',
      kind: 'multiselect',
      nonRemovable: true,
      options: CATEGORIES.map(c => ({ value: c.value, label: c.label, tone: c.tone })),
    },
  ]), [])

  const startEdit = (page: DocPage) => {
    setSelectedPage(page)
    setEditTitle(page.title)
    // contentTiptap is always null (the API stores HTML in contentText).
    // For legacy markdown docs, convert to HTML so Tiptap renders the
    // formatting rather than raw markdown source.
    const raw = page.contentText ?? page.contentTiptap ?? ''
    const html = !raw ? '' : looksLikeHtml(raw) ? raw : renderMarkdown(raw)
    setEditContent(html)
    setEditCategories(parseCats(page.category))
    setEditing(true)
    if (!selectedPage || selectedPage.id !== page.id) void loadPage(page.id)
  }

  const handleNew = () => {
    setSelectedPage(null)
    setEditTitle('')
    setEditContent('')
    setEditCategories([])
    setShowNewForm(true)
  }

  async function handleCreate() {
    if (!editTitle.trim()) return
    setSaving(true)
    try {
      const res = await fetch(apiPath('/api/admin/docs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          category: joinCats(editCategories) || 'operations',
          contentMd: editContent,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { id: string }
      setShowNewForm(false)
      setEditTitle('')
      setEditContent('')
      setEditCategories([])
      await mutatePages()
      await loadPage(data.id)
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (!selectedPage) return
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/docs/${selectedPage.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim() || undefined,
          contentMd: editContent,
          category: joinCats(editCategories) || 'operations',
        }),
      })
      await loadPage(selectedPage.id)
      await mutatePages()
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    try {
      await fetch(apiPath(`/api/admin/docs/${pendingDelete.id}`), { method: 'DELETE' })
      setSelectedPage(null)
      setPendingDelete(null)
      await mutatePages()
    } catch {
      // ignore
    }
  }

  // Column defs for the DataTable. Sortable headers do their own
  // sorting through DataTable's internal state.
  const columns: DataTableColumn<DocPage>[] = [
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      sortValue: r => r.title.toLowerCase(),
      minWidth: '20rem',
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <FileText size={14} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
          <span style={{
            fontWeight: 600,
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{r.title}</span>
        </div>
      ),
    },
    {
      key: 'categories',
      header: 'Categories',
      sortable: true,
      sortValue: r => parseCats(r.category).join(','),
      minWidth: '14rem',
      render: r => {
        const cats = parseCats(r.category)
        if (cats.length === 0) {
          return <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}>—</span>
        }
        // Cap visible chips at 2 to keep row height stable. Anything
        // extra collapses to "+N" so the column never expands.
        const visible = cats.slice(0, 2)
        const overflow = cats.length - visible.length
        return (
          <div style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center', whiteSpace: 'nowrap' }}>
            {visible.map(c => {
              const def = CATEGORY_BY_VALUE.get(c)
              return (
                <Badge
                  key={c}
                  tone={def?.tone ?? 'neutral'}
                  variant="soft"
                  size="sm"
                  dot={false}
                >
                  {def?.label ?? c}
                </Badge>
              )
            })}
            {overflow > 0 && (
              <span style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: 'var(--color-text-muted)',
              }}>+{overflow}</span>
            )}
          </div>
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
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3125rem',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
        }}>
          <Clock size={11} aria-hidden="true" />
          {formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true })}
        </span>
      ),
    },
  ]

  return (
    <div style={{ padding: '1.25rem 0', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          <h1 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 700,
            color: 'var(--color-text)',
            letterSpacing: '-0.015em',
          }}>Docs hub</h1>
          <p style={{
            margin: '0.25rem 0 0',
            fontSize: '0.875rem',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
          }}>
            Every operating doc, brand note and process in one searchable place.
          </p>
        </div>
        <TahiButton
          size="sm"
          onClick={handleNew}
          iconLeft={<Plus className="w-3.5 h-3.5" />}
        >
          New page
        </TahiButton>
      </div>

      {/* Filter row — same FilterBar primitive as the DataTable
          showcase. Categories is a multiselect chip so a single chip
          can hold any subset of categories. */}
      <FilterBar
        filters={filterDefs}
        active={activeFilters}
        onChange={setActiveFilters}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search title or content',
        }}
        size="sm"
      />

      {/* Table — wrapped in a Card so rows sit on a real white surface
          with rounded corners, matching the DataTable showcase. */}
      <Card padding="none">
        <DataTable<DocPage>
          ariaLabel="Docs"
          columns={columns}
          rows={filteredPages}
          getRowId={r => r.id}
          defaultSort={{ key: 'updatedAt', dir: 'desc' }}
          loading={loading}
          empty={
            <EmptyState
              icon={<BookOpen className="w-6 h-6" />}
              title={pages.length === 0 ? 'No docs yet' : 'No matches'}
              description={pages.length === 0
                ? 'Create your first page to start building the team knowledge base.'
                : 'Try clearing a filter or adjusting your search.'}
              action={
                pages.length === 0 ? (
                  <TahiButton size="sm" onClick={handleNew} iconLeft={<Plus className="w-3.5 h-3.5" />}>
                    New page
                  </TahiButton>
                ) : undefined
              }
            />
          }
          onRowPreview={(r) => loadPage(r.id)}
          rowActions={(r) => [
            { label: 'Edit', icon: <Edit3 size={14} />, onClick: () => startEdit(r) },
            { label: 'Delete', icon: <Trash2 size={14} />, tone: 'danger', onClick: () => setPendingDelete(r) },
          ]}
        />
      </Card>

      {/* View / inline-edit slide-over. Wider (56rem) so the doc is
          easier to read, especially with markdown content + tables. */}
      <SlideOver
        open={!!selectedPage && !showNewForm}
        onClose={() => { setSelectedPage(null); setEditing(false); setViewingVersion(null) }}
        icon={<FileText size={15} />}
        title={editing ? (editTitle || 'Untitled') : (selectedPage?.title ?? '')}
        subtitle={selectedPage && !editing
          ? `Updated ${formatDistanceToNow(new Date(selectedPage.updatedAt), { addSuffix: true })}`
          : undefined}
        maxWidth="56rem"
      >
        {selectedPage && (
          <>
            <SlideOver.Body>
              {editing ? (
                <EditForm
                  title={editTitle}
                  onTitleChange={setEditTitle}
                  categories={editCategories}
                  onCategoriesChange={setEditCategories}
                  content={editContent}
                  onContentChange={setEditContent}
                />
              ) : viewingVersion ? (
                <VersionView
                  version={viewingVersion}
                  onBack={() => setViewingVersion(null)}
                />
              ) : showVersions ? (
                <VersionList
                  versions={versions}
                  onView={(v) => setViewingVersion(v)}
                />
              ) : (
                <>
                  {parseCats(selectedPage.category).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginBottom: '0.75rem' }}>
                      {parseCats(selectedPage.category).map(c => {
                        const def = CATEGORY_BY_VALUE.get(c)
                        return (
                          <Badge key={c} tone={def?.tone ?? 'neutral'} variant="soft" size="sm" dot={false}>
                            {def?.label ?? c}
                          </Badge>
                        )
                      })}
                    </div>
                  )}
                  <DocBody page={selectedPage} />
                </>
              )}
            </SlideOver.Body>
            <SlideOver.Footer>
              {editing ? (
                <>
                  <TahiButton variant="secondary" size="sm" onClick={() => setEditing(false)}>
                    Cancel
                  </TahiButton>
                  <TahiButton
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                    iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </TahiButton>
                </>
              ) : (
                <>
                  <TahiButton
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowVersions(v => !v)}
                    iconLeft={<History className="w-3.5 h-3.5" />}
                  >
                    {showVersions ? 'Hide history' : 'History'}
                  </TahiButton>
                  <div style={{ flex: 1 }} />
                  <TahiButton
                    variant="secondary"
                    size="sm"
                    onClick={() => setPendingDelete(selectedPage)}
                    iconLeft={<Trash2 className="w-3.5 h-3.5" />}
                  >
                    Delete
                  </TahiButton>
                  <TahiButton
                    size="sm"
                    onClick={() => startEdit(selectedPage)}
                    iconLeft={<Edit3 className="w-3.5 h-3.5" />}
                  >
                    Edit
                  </TahiButton>
                </>
              )}
            </SlideOver.Footer>
          </>
        )}
      </SlideOver>

      {/* New-page slide-over */}
      <SlideOver
        open={showNewForm}
        onClose={() => setShowNewForm(false)}
        icon={<Plus size={15} />}
        title="New page"
        subtitle="Add a doc to the team knowledge base."
        maxWidth="56rem"
      >
        <SlideOver.Body>
          <EditForm
            title={editTitle}
            onTitleChange={setEditTitle}
            categories={editCategories}
            onCategoriesChange={setEditCategories}
            content={editContent}
            onContentChange={setEditContent}
          />
        </SlideOver.Body>
        <SlideOver.Footer>
          <TahiButton variant="secondary" size="sm" onClick={() => setShowNewForm(false)}>
            Cancel
          </TahiButton>
          <TahiButton
            size="sm"
            onClick={handleCreate}
            disabled={saving || !editTitle.trim()}
            iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          >
            {saving ? 'Saving...' : 'Create page'}
          </TahiButton>
        </SlideOver.Footer>
      </SlideOver>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!pendingDelete}
        title={`Delete "${pendingDelete?.title ?? ''}"?`}
        description="This removes the doc and its version history. You can't undo this."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

// -- Edit form (shared between create + edit modes) --

function EditForm({
  title,
  onTitleChange,
  categories,
  onCategoriesChange,
  content,
  onContentChange,
}: {
  title: string
  onTitleChange: (v: string) => void
  categories: string[]
  onCategoriesChange: (v: string[]) => void
  content: string
  onContentChange: (v: string) => void
}) {
  // Same dropdown-style multiselect chip as the main /docs filter
  // row. nonRemovable hides the X so the picker is a permanent
  // control, never an "added filter".
  const editFilterDefs: FilterDef[] = [
    {
      id: 'categories',
      label: 'Categories',
      kind: 'multiselect',
      nonRemovable: true,
      options: CATEGORIES.map(c => ({ value: c.value, label: c.label, tone: c.tone })),
    },
  ]
  const editActive: ActiveFilter[] = [{ id: 'categories', values: categories }]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <Input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Page title"
        inputSize="md"
      />
      <div>
        <label style={{
          display: 'block',
          fontSize: '0.625rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
          marginBottom: '0.3125rem',
        }}>
          Categories <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400, color: 'var(--color-text-subtle)' }}>· pick none, one or many</span>
        </label>
        <FilterBar
          filters={editFilterDefs}
          active={editActive}
          onChange={(next) => {
            const cats = next.find(a => a.id === 'categories')?.values ?? []
            onCategoriesChange(cats)
          }}
          size="sm"
        />
      </div>
      <TiptapDocEditor
        content={content}
        onChange={onContentChange}
        placeholder="Write your doc content..."
      />
    </div>
  )
}

// -- Slide-over body parts --

function DocBody({ page }: { page: DocPage }) {
  const html = useMemo(() => {
    if (page.contentTiptap) return page.contentTiptap
    if (page.contentText) {
      return looksLikeHtml(page.contentText) ? page.contentText : renderMarkdown(page.contentText)
    }
    return ''
  }, [page.contentTiptap, page.contentText])

  if (!html) {
    return (
      <p style={{
        fontSize: '0.875rem',
        color: 'var(--color-text-subtle)',
        fontStyle: 'italic',
        margin: 0,
      }}>
        No content yet. Click Edit to add content.
      </p>
    )
  }
  return (
    <div
      className="tahi-doc-prose"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function VersionList({
  versions,
  onView,
}: {
  versions: DocVersion[]
  onView: (v: DocVersion) => void
}) {
  if (versions.length === 0) {
    return (
      <p style={{
        fontSize: '0.875rem',
        color: 'var(--color-text-muted)',
        margin: 0,
      }}>
        No saved versions yet.
      </p>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {versions.map((v, i) => (
        <button
          key={v.id}
          type="button"
          onClick={() => onView(v)}
          className="tahi-focus-ring"
          style={{
            padding: '0.5rem 0.625rem',
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.75rem',
            cursor: 'pointer',
            textAlign: 'left',
            width: '100%',
            transition: 'background-color 120ms ease, border-color 120ms ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--color-bg)'
            e.currentTarget.style.borderColor = 'var(--color-border)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'var(--color-bg-secondary)'
            e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
          }}
        >
          <Clock size={11} aria-hidden="true" style={{ color: 'var(--color-text-subtle)' }} />
          <span style={{ color: 'var(--color-text)' }}>
            {formatDistanceToNow(new Date(v.savedAt), { addSuffix: true })}
          </span>
          {i === 0 && (
            <span style={{
              fontSize: '0.625rem',
              padding: '0.0625rem 0.3125rem',
              background: 'var(--color-brand-50)',
              color: 'var(--color-text-active)',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 600,
            }}>Current</span>
          )}
          <span style={{ flex: 1 }} />
          <span style={{
            fontSize: '0.625rem',
            color: 'var(--color-text-muted)',
            fontWeight: 600,
          }}>View →</span>
        </button>
      ))}
    </div>
  )
}

function VersionView({
  version,
  onBack,
}: {
  version: DocVersion
  onBack: () => void
}) {
  const html = useMemo(() => {
    const raw = version.contentTiptap ?? ''
    if (!raw) return ''
    return looksLikeHtml(raw) ? raw : renderMarkdown(raw)
  }, [version.contentTiptap])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      <button
        type="button"
        onClick={onBack}
        className="tahi-focus-ring"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3125rem',
          padding: '0.25rem 0.5rem',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.6875rem',
          fontWeight: 600,
          color: 'var(--color-text)',
          cursor: 'pointer',
          width: 'fit-content',
          transition: 'background-color 120ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
      >
        <ArrowLeft size={11} aria-hidden="true" />
        Back to current
      </button>
      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
        Viewing version from {formatDistanceToNow(new Date(version.savedAt), { addSuffix: true })}
      </span>
      {html ? (
        <div
          className="tahi-doc-prose"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>
          This version was empty.
        </p>
      )}
    </div>
  )
}
