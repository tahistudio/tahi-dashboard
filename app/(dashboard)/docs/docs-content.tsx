'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  BookOpen, Plus, Search, Clock, Save,
  Trash2, History, RefreshCw, FileText, Edit3,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input } from '@/components/tahi/input'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import dynamic from 'next/dynamic'
const TiptapDocEditor = dynamic(
  () => import('@/components/tahi/tiptap-doc-editor').then(m => ({ default: m.TiptapDocEditor })),
  { ssr: false },
)
import { apiPath } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'

// -- Types --

interface DocPage {
  id: string
  parentId: string | null
  category: string
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
  color: string  // dot colour for the chip
}

const CATEGORIES: DocCategory[] = [
  { value: 'brand',      label: 'Brand',      color: '#5A824E' },
  { value: 'services',   label: 'Services',   color: '#06b6d4' },
  { value: 'sales',      label: 'Sales',      color: '#f59e0b' },
  { value: 'operations', label: 'Operations', color: '#7c3aed' },
  { value: 'team',       label: 'Team',       color: '#0f766e' },
  { value: 'product',    label: 'Product',    color: '#d97706' },
]

const CATEGORY_BY_VALUE = new Map(CATEGORIES.map(c => [c.value, c]))

// Lightweight markdown to HTML for legacy doc rendering. Same parser
// as before; just kept inline so the rest of the file stays focused.
function renderMarkdown(md: string): string {
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const lines = escaped.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length) {
      const next = lines[i + 1].trim()
      const isSeparator = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(next)
      if (isSeparator) {
        const headerCells = splitTableRow(trimmed)
        const bodyRows: string[][] = []
        let j = i + 2
        while (j < lines.length) {
          const t = lines[j].trim()
          if (!t.startsWith('|') || !t.endsWith('|')) break
          bodyRows.push(splitTableRow(t))
          j++
        }
        out.push(renderTable(headerCells, bodyRows))
        i = j
        continue
      }
    }
    if (!trimmed) { out.push(''); i++; continue }
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/)
    if (headingMatch) {
      const level = headingMatch[1].length
      out.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`)
      i++
      continue
    }
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inlineMarkdown(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`)
        i++
      }
      out.push(`<ol>${items.join('')}</ol>`)
      continue
    }
    if (/^---+$/.test(trimmed)) { out.push('<hr />'); i++; continue }
    out.push(`<p>${inlineMarkdown(trimmed)}</p>`)
    i++
  }
  return out.filter(Boolean).join('\n')
}
function splitTableRow(row: string): string[] {
  return row.replace(/^\||\|$/g, '').split('|').map(c => c.trim())
}
function renderTable(headers: string[], rows: string[][]): string {
  const thead = `<thead><tr>${headers.map(h => `<th>${inlineMarkdown(h)}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inlineMarkdown(c)}</td>`).join('')}</tr>`).join('')}</tbody>`
  return `<table>${thead}${tbody}</table>`
}
function inlineMarkdown(s: string): string {
  return s
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

// -- Main Component --

export function DocsContent() {
  const [pages, setPages] = useState<DocPage[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // Multi-select category filter. Empty set = all categories visible.
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set())

  // Slide-over state. selectedPage drives view mode; editing toggles
  // the inline editor inside the same slide-over.
  const [selectedPage, setSelectedPage] = useState<DocPage | null>(null)
  const [versions, setVersions] = useState<DocVersion[]>([])
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('operations')
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<DocPage | null>(null)

  const fetchPages = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/docs'))
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json() as { pages: DocPage[] }
      setPages(data.pages ?? [])
    } catch {
      setPages([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPages() }, [fetchPages])

  const loadPage = useCallback(async (id: string) => {
    try {
      const res = await fetch(apiPath(`/api/admin/docs/${id}`))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { page: DocPage; versions: DocVersion[] }
      setSelectedPage(data.page)
      setVersions(data.versions)
      setEditing(false)
      setShowVersions(false)
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

  const toggleCategory = (value: string) => {
    setActiveCategories(prev => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value); else next.add(value)
      return next
    })
  }
  const clearCategories = () => setActiveCategories(new Set())

  // Client-side filter so multi-cat + search both work without
  // round-tripping. Searches title AND content text.
  const filteredPages = useMemo(() => {
    const q = search.trim().toLowerCase()
    return pages.filter(p => {
      if (activeCategories.size > 0 && !activeCategories.has(p.category)) return false
      if (q) {
        const inTitle = p.title.toLowerCase().includes(q)
        const inBody = (p.contentText ?? '').toLowerCase().includes(q)
        if (!inTitle && !inBody) return false
      }
      return true
    })
  }, [pages, search, activeCategories])

  const startEdit = (page: DocPage) => {
    setSelectedPage(page)
    setEditTitle(page.title)
    // BUG FIX: contentTiptap is always null (the API stores everything
    // in contentText as HTML emitted by TiptapDocEditor). Previously
    // we only read contentTiptap, so clicking Edit blanked the doc.
    setEditContent(page.contentText ?? page.contentTiptap ?? '')
    setEditCategory(page.category)
    setEditing(true)
    if (!selectedPage || selectedPage.id !== page.id) void loadPage(page.id)
  }

  const handleNew = () => {
    setSelectedPage(null)
    setEditTitle('')
    setEditContent('')
    setEditCategory('operations')
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
          category: editCategory,
          contentMd: editContent,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { id: string }
      setShowNewForm(false)
      setEditTitle('')
      setEditContent('')
      await fetchPages()
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
          category: editCategory,
        }),
      })
      await loadPage(selectedPage.id)
      await fetchPages()
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
      await fetchPages()
    } catch {
      // ignore
    }
  }

  const filtersActive = activeCategories.size > 0 || search.trim().length > 0

  return (
    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
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

      {/* Filter row: search + category chips */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or content..."
            inputSize="sm"
            leadingIcon={<Search size={13} aria-hidden="true" />}
            style={{ flex: '0 1 22rem', minWidth: '14rem' }}
          />
          {filtersActive && (
            <button
              type="button"
              onClick={() => { clearCategories(); setSearch('') }}
              className="tahi-focus-ring"
              style={{
                background: 'transparent',
                border: 'none',
                padding: '0.25rem 0.5rem',
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
            >
              Clear filters
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3125rem', alignItems: 'center' }}>
          <span style={{
            fontSize: '0.625rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-text-subtle)',
            marginRight: '0.1875rem',
          }}>Categories</span>
          {CATEGORIES.map(cat => {
            const active = activeCategories.has(cat.value)
            return (
              <button
                key={cat.value}
                type="button"
                onClick={() => toggleCategory(cat.value)}
                aria-pressed={active}
                className="tahi-focus-ring"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3125rem',
                  padding: '0.1875rem 0.5rem',
                  background: active ? 'var(--color-brand-50)' : 'var(--color-bg)',
                  border: `1px solid ${active ? 'var(--color-brand)' : 'var(--color-border)'}`,
                  borderRadius: 999,
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  color: active ? 'var(--color-text-active)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  transition: 'background-color 120ms ease, border-color 120ms ease',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: '0.375rem',
                    height: '0.375rem',
                    borderRadius: 999,
                    background: cat.color,
                  }}
                />
                {cat.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <DocsTableSkeleton />
      ) : filteredPages.length === 0 ? (
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
      ) : (
        <DocsTable
          pages={filteredPages}
          onRowClick={(p) => loadPage(p.id)}
          onEdit={(p) => startEdit(p)}
          onDelete={(p) => setPendingDelete(p)}
        />
      )}

      {/* Slide-over: view + edit modes */}
      <SlideOver
        open={!!selectedPage && !showNewForm}
        onClose={() => { setSelectedPage(null); setEditing(false) }}
        icon={<FileText size={15} />}
        title={editing ? (editTitle || 'Untitled') : (selectedPage?.title ?? '')}
        subtitle={selectedPage && !editing
          ? `${CATEGORY_BY_VALUE.get(selectedPage.category)?.label ?? selectedPage.category} · Updated ${formatDistanceToNow(new Date(selectedPage.updatedAt), { addSuffix: true })}`
          : undefined}
        maxWidth="40rem"
      >
        {selectedPage && (
          <>
            <SlideOver.Body>
              {editing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Page title"
                    inputSize="md"
                  />
                  <CategoryPicker
                    value={editCategory}
                    onChange={setEditCategory}
                  />
                  <TiptapDocEditor
                    content={editContent}
                    onChange={setEditContent}
                    placeholder="Write your doc content..."
                  />
                </div>
              ) : showVersions ? (
                <VersionList versions={versions} />
              ) : (
                <DocBody page={selectedPage} />
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
        maxWidth="40rem"
      >
        <SlideOver.Body>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Page title"
              inputSize="md"
            />
            <CategoryPicker
              value={editCategory}
              onChange={setEditCategory}
            />
            <TiptapDocEditor
              content={editContent}
              onChange={setEditContent}
              placeholder="Write your doc content..."
            />
          </div>
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

// -- Table --

function DocsTable({
  pages,
  onRowClick,
  onEdit,
  onDelete,
}: {
  pages: DocPage[]
  onRowClick: (p: DocPage) => void
  onEdit: (p: DocPage) => void
  onDelete: (p: DocPage) => void
}) {
  return (
    <div
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        overflowX: 'auto',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(20rem, 2fr) 9rem 9rem 6.5rem',
          padding: '0.5rem 0.875rem',
          background: 'var(--color-bg-secondary)',
          borderBottom: '1px solid var(--color-border-subtle)',
          fontSize: '0.625rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
          minWidth: '48rem',
        }}
      >
        <span>Title</span>
        <span>Category</span>
        <span>Updated</span>
        <span style={{ textAlign: 'right' }}>Actions</span>
      </div>
      {pages.map((p, i) => {
        const cat = CATEGORY_BY_VALUE.get(p.category)
        return (
          <div
            key={p.id}
            className="tahi-focus-ring"
            role="button"
            tabIndex={0}
            aria-label={`Open ${p.title}`}
            onClick={() => onRowClick(p)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onRowClick(p)
              }
            }}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(20rem, 2fr) 9rem 9rem 6.5rem',
              alignItems: 'center',
              padding: '0.625rem 0.875rem',
              borderBottom: i < pages.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
              cursor: 'pointer',
              transition: 'background-color 120ms ease',
              minWidth: '48rem',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
              <FileText size={14} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
              <span style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                color: 'var(--color-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {p.title}
              </span>
            </div>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3125rem',
              padding: '0.0625rem 0.4375rem',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.6875rem',
              fontWeight: 600,
              color: 'var(--color-text)',
              width: 'fit-content',
            }}>
              <span
                aria-hidden="true"
                style={{
                  width: '0.3125rem',
                  height: '0.3125rem',
                  borderRadius: 999,
                  background: cat?.color ?? 'var(--color-text-muted)',
                }}
              />
              {cat?.label ?? p.category}
            </span>
            <span style={{
              fontSize: '0.75rem',
              color: 'var(--color-text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3125rem',
            }}>
              <Clock size={11} aria-hidden="true" />
              {formatDistanceToNow(new Date(p.updatedAt), { addSuffix: true })}
            </span>
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.1875rem' }}
            >
              <button
                type="button"
                onClick={() => onEdit(p)}
                aria-label={`Edit ${p.title}`}
                className="tahi-focus-ring"
                style={iconButtonStyle}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--color-bg-tertiary)'
                  e.currentTarget.style.color = 'var(--color-text)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--color-text-subtle)'
                }}
              >
                <Edit3 size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(p)}
                aria-label={`Delete ${p.title}`}
                className="tahi-focus-ring"
                style={iconButtonStyle}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'var(--color-danger-bg, rgba(220, 38, 38, 0.10))'
                  e.currentTarget.style.color = 'var(--color-danger)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--color-text-subtle)'
                }}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const iconButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.625rem',
  height: '1.625rem',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-subtle)',
  cursor: 'pointer',
  transition: 'background-color 120ms ease, color 120ms ease',
}

function DocsTableSkeleton() {
  return (
    <div style={{
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <LoadingSkeleton rows={5} height={42} />
    </div>
  )
}

// -- Slide-over body parts --

function DocBody({ page }: { page: DocPage }) {
  if (page.contentTiptap) {
    return (
      <div
        className="tahi-doc-prose"
        dangerouslySetInnerHTML={{ __html: page.contentTiptap }}
      />
    )
  }
  if (page.contentText) {
    // contentText might be HTML (new Tiptap-saved docs) or markdown
    // (legacy imports). Detect: if the first non-blank chars look
    // like a tag, render as HTML; otherwise parse as markdown.
    const looksLikeHtml = /^\s*<[a-z]/i.test(page.contentText)
    const html = looksLikeHtml ? page.contentText : renderMarkdown(page.contentText)
    return (
      <div
        className="tahi-doc-prose"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }
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

function VersionList({ versions }: { versions: DocVersion[] }) {
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
        <div
          key={v.id}
          style={{
            padding: '0.5rem 0.625rem',
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.75rem',
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
        </div>
      ))}
    </div>
  )
}

function CategoryPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
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
        Category
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
        {CATEGORIES.map(cat => {
          const active = value === cat.value
          return (
            <button
              key={cat.value}
              type="button"
              onClick={() => onChange(cat.value)}
              className="tahi-focus-ring"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.3125rem',
                padding: '0.25rem 0.5rem',
                background: active ? 'var(--color-brand-50)' : 'var(--color-bg)',
                border: `1px solid ${active ? 'var(--color-brand)' : 'var(--color-border)'}`,
                borderRadius: 999,
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: active ? 'var(--color-text-active)' : 'var(--color-text)',
                cursor: 'pointer',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: '0.375rem',
                  height: '0.375rem',
                  borderRadius: 999,
                  background: cat.color,
                }}
              />
              {cat.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
