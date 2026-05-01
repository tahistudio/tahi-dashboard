'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  BookOpen, Plus, Search, ChevronRight, Clock, Save,
  Trash2, ArrowLeft, History, X, RefreshCw, FileText,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import dynamic from 'next/dynamic'
const TiptapDocEditor = dynamic(() => import('@/components/tahi/tiptap-doc-editor').then(m => ({ default: m.TiptapDocEditor })), { ssr: false })
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

/**
 * Lightweight markdown to HTML for doc content display.
 *
 * Stateful line walker so we can group consecutive structures into
 * proper block elements (lists wrapped in <ul>/<ol>, GFM tables,
 * etc.). The previous version emitted orphan <li> tags with no <ul>
 * wrapper, which caused browsers to render them with their default
 * ::marker and the docs CSS to render a second bullet on top — the
 * "two sets of bullets" symptom. It also had no table support, so
 * GFM tables fell through to the paragraph case and rendered as
 * literal pipes.
 *
 * Supported syntax:
 *   - Headings #, ##, ###, ####
 *   - Horizontal rule ---
 *   - Unordered list (-, *) with consecutive items grouped in <ul>
 *   - Ordered list (1.) with consecutive items grouped in <ol>
 *   - GFM table: header row, |---|---|---| separator, body rows
 *   - Paragraphs, blank lines = paragraph breaks
 *   - Inline: bold, italic, bold+italic, code, links
 *
 * Not supported (out of scope for the docs surface today):
 *   - Code blocks (```), blockquotes (>), images, nested lists,
 *     task lists, footnotes, definition lists.
 */
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

    // GFM table: a `|...|` row followed by a `|---|---|` separator.
    // We detect the header + separator together; if the second row
    // isn't a separator it's not a table, just rows of pipes.
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

    // Unordered list block — collect all consecutive `-` or `*` items.
    if (/^[-*] /.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*] /.test(lines[i].trim())) {
        const content = lines[i].replace(/^\s*[-*] /, '')
        items.push(`<li>${inlineFormat(content)}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Ordered list block — collect all consecutive `1.`, `2.` items.
    if (/^\d+\.\s/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        const content = lines[i].replace(/^\s*\d+\.\s/, '')
        items.push(`<li>${inlineFormat(content)}</li>`)
        i++
      }
      out.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    if (line.startsWith('# '))    { out.push(`<h1>${inlineFormat(line.slice(2))}</h1>`);   i++; continue }
    if (line.startsWith('## '))   { out.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);   i++; continue }
    if (line.startsWith('### '))  { out.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);   i++; continue }
    if (line.startsWith('#### ')) { out.push(`<h4>${inlineFormat(line.slice(5))}</h4>`);   i++; continue }

    if (/^---+$/.test(trimmed)) { out.push('<hr />'); i++; continue }

    if (trimmed === '') { out.push(''); i++; continue }

    // Default: paragraph.
    out.push(`<p>${inlineFormat(line)}</p>`)
    i++
  }

  return out.join('\n')
}

/** Split a `| a | b | c |` row into its cells, trimming each. */
function splitTableRow(row: string): string[] {
  // Strip leading/trailing pipe, split on |, trim each cell.
  return row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}

/** Build a GFM table with headers + body rows. Inline-formats cells. */
function renderTable(header: string[], body: string[][]): string {
  const head = header.map(c => `<th>${inlineFormat(c)}</th>`).join('')
  const rows = body
    .map(row => `<tr>${row.map(c => `<td>${inlineFormat(c)}</td>`).join('')}</tr>`)
    .join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`
}

function inlineFormat(text: string): string {
  return text
    // Bold + italic
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`(.*?)`/g, '<code>$1</code>')
    // Links
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
}

const CATEGORIES = [
  { value: 'brand', label: 'Brand' },
  { value: 'services', label: 'Services' },
  { value: 'sales', label: 'Sales' },
  { value: 'operations', label: 'Operations' },
  { value: 'team', label: 'Team' },
  { value: 'product', label: 'Product' },
] as const

// -- Main Component --

export function DocsContent() {
  const [pages, setPages] = useState<DocPage[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [selectedPage, setSelectedPage] = useState<DocPage | null>(null)
  const [versions, setVersions] = useState<DocVersion[]>([])
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('operations')
  const [saving, setSaving] = useState(false)
  const [showNewForm, setShowNewForm] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [viewingVersion, setViewingVersion] = useState<DocVersion | null>(null)
  const fetchPages = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (activeCategory) params.set('category', activeCategory)
      if (search.trim()) params.set('search', search.trim())
      const res = await fetch(apiPath(`/api/admin/docs?${params}`))
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json() as { pages: DocPage[] }
      setPages(data.pages ?? [])
    } catch {
      setPages([])
    } finally {
      setLoading(false)
    }
  }, [activeCategory, search])

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
      setViewingVersion(null)
    } catch {
      // Page load failed
    }
  }, [])

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
    } catch {
      // Create failed
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
    } catch {
      // Save failed
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(apiPath(`/api/admin/docs/${id}`), { method: 'DELETE' })
      setSelectedPage(null)
      await fetchPages()
    } catch {
      // Delete failed
    }
  }

  function startEdit() {
    if (!selectedPage) return
    setEditTitle(selectedPage.title)
    setEditContent(selectedPage.contentTiptap ?? '')
    setEditCategory(selectedPage.category)
    setEditing(true)
  }

  // Group pages: parent pages as folder headers with children nested underneath
  // Standalone pages (no parent) that aren't parents themselves appear as top-level items
  const parentPages = pages.filter(p => !p.parentId)
  const childPages = pages.filter(p => p.parentId)
  const parentIds = new Set(childPages.map(c => c.parentId).filter(Boolean))

  // Parents that have children = folders. Parents with no children = standalone pages.
  const folders = parentPages
    .filter(p => parentIds.has(p.id))
    .map(parent => ({
      ...parent,
      children: childPages.filter(c => c.parentId === parent.id),
    }))

  const standalonPages = parentPages.filter(p => !parentIds.has(p.id))

  return (
    <div className="flex gap-0 h-[calc(100vh-7rem)]">
      {/* Left sidebar - category tree */}
      <div
        className="w-72 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-bg)] overflow-y-auto flex flex-col"
      >
        {/* Search */}
        <div className="p-3 border-b border-[var(--color-border-subtle)]">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-subtle)]"
              style={{ width: '0.875rem', height: '0.875rem' }}
            />
            <input
              type="text"
              placeholder="Search docs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] pl-8 pr-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            />
          </div>
        </div>

        {/* Category filter tabs */}
        <div className="p-3 border-b border-[var(--color-border-subtle)] flex flex-wrap gap-1">
          <button
            onClick={() => setActiveCategory(null)}
            className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer"
            style={{
              background: !activeCategory ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
              color: !activeCategory ? 'white' : 'var(--color-text-muted)',
            }}
          >
            All
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(activeCategory === cat.value ? null : cat.value)}
              className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer"
              style={{
                background: activeCategory === cat.value ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
                color: activeCategory === cat.value ? 'white' : 'var(--color-text-muted)',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* New Page button */}
        <div className="p-3 border-b border-[var(--color-border-subtle)]">
          <TahiButton
            size="sm"
            onClick={() => {
              setShowNewForm(true)
              setSelectedPage(null)
              setEditTitle('')
              setEditContent('')
              setEditCategory('operations')
            }}
            iconLeft={<Plus className="w-3.5 h-3.5" />}
            className="w-full"
          >
            New Page
          </TahiButton>
          {pages.length === 0 && !loading && (
            <TahiButton
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  const payloadRes = await fetch(apiPath('/seed-docs.json'))
                  if (!payloadRes.ok) return
                  const payload = await payloadRes.json()
                  const res = await fetch(apiPath('/api/admin/docs/import'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                  })
                  if (res.ok) fetchPages()
                } catch { /* silently fail */ }
              }}
              className="w-full mt-2"
            >
              Import Tahi Docs
            </TahiButton>
          )}
        </div>

        {/* Page tree */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <LoadingSkeleton rows={5} />
          ) : pages.length === 0 ? (
            <div className="p-4 text-center">
              <div
                className="w-10 h-10 brand-gradient flex items-center justify-center mx-auto mb-2"
                style={{ borderRadius: 'var(--radius-leaf-sm)' }}
              >
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <p className="text-sm font-medium text-[var(--color-text)] mb-1">No docs yet</p>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">Create your first doc page to build your knowledge hub.</p>
              <TahiButton
                size="sm"
                onClick={() => {
                  setShowNewForm(true)
                  setSelectedPage(null)
                  setEditTitle('')
                  setEditContent('')
                  setEditCategory('operations')
                }}
                iconLeft={<Plus className="w-3 h-3" />}
                className="w-full"
              >
                Create first page
              </TahiButton>
            </div>
          ) : (
            <>
              {/* Folders (parent pages with children) */}
              {folders.map(folder => (
                <div key={folder.id} className="mb-3">
                  <p className="text-xs font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider px-2 mb-1">
                    {folder.title}
                  </p>
                  {folder.children.map(child => (
                    <button
                      key={child.id}
                      onClick={() => loadPage(child.id)}
                      className="w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2 cursor-pointer hover:bg-[var(--color-bg-tertiary)]"
                      style={{
                        background: selectedPage?.id === child.id ? 'var(--color-bg-tertiary)' : 'transparent',
                        color: selectedPage?.id === child.id ? 'var(--color-text)' : 'var(--color-text-muted)',
                      }}
                    >
                      <FileText style={{ width: '0.875rem', height: '0.875rem', flexShrink: 0 }} />
                      <span className="truncate">{child.title}</span>
                    </button>
                  ))}
                </div>
              ))}
              {/* Standalone pages (no children) */}
              {standalonPages.length > 0 && (
                <div className="mb-3">
                  {folders.length > 0 && (
                    <p className="text-xs font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider px-2 mb-1">
                      Other
                    </p>
                  )}
                  {standalonPages.map(page => (
                    <button
                      key={page.id}
                      onClick={() => loadPage(page.id)}
                      className="w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2 cursor-pointer hover:bg-[var(--color-bg-tertiary)]"
                      style={{
                        background: selectedPage?.id === page.id ? 'var(--color-bg-tertiary)' : 'transparent',
                        color: selectedPage?.id === page.id ? 'var(--color-text)' : 'var(--color-text-muted)',
                      }}
                    >
                      <FileText style={{ width: '0.875rem', height: '0.875rem', flexShrink: 0 }} />
                      <span className="truncate">{page.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto bg-[var(--color-bg-secondary)]">
        {showNewForm ? (
          <NewPageForm
            title={editTitle}
            content={editContent}
            category={editCategory}
            saving={saving}
            onTitleChange={setEditTitle}
            onContentChange={setEditContent}
            onCategoryChange={setEditCategory}
            onSave={handleCreate}
            onCancel={() => setShowNewForm(false)}
          />
        ) : selectedPage ? (
          <PageView
            page={selectedPage}
            versions={versions}
            editing={editing}
            editTitle={editTitle}
            editContent={editContent}
            editCategory={editCategory}
            saving={saving}
            showVersions={showVersions}
            viewingVersion={viewingVersion}
            onEdit={startEdit}
            onSave={handleSave}
            onCancelEdit={() => setEditing(false)}
            onDelete={() => handleDelete(selectedPage.id)}
            onTitleChange={setEditTitle}
            onContentChange={setEditContent}
            onCategoryChange={setEditCategory}
            onToggleVersions={() => setShowVersions(!showVersions)}
            onViewVersion={setViewingVersion}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              icon={<BookOpen className="w-8 h-8 text-white" />}
              title="Select a doc or create a new page"
              description="Choose a page from the sidebar or click New Page to get started."
            />
          </div>
        )}
      </div>
    </div>
  )
}

// -- New Page Form --

function NewPageForm({
  title, content, category, saving,
  onTitleChange, onContentChange, onCategoryChange, onSave, onCancel,
}: {
  title: string
  content: string
  category: string
  saving: boolean
  onTitleChange: (v: string) => void
  onContentChange: (v: string) => void
  onCategoryChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-[var(--color-text)]">New Page</h2>
        <div className="flex items-center gap-2">
          <TahiButton variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </TahiButton>
          <TahiButton
            size="sm"
            onClick={onSave}
            disabled={saving || !title.trim()}
            iconLeft={saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          >
            {saving ? 'Creating...' : 'Create'}
          </TahiButton>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="new-page-title" className="block text-sm font-medium text-[var(--color-text)] mb-1">
            Title
          </label>
          <input
            id="new-page-title"
            type="text"
            value={title}
            onChange={e => onTitleChange(e.target.value)}
            placeholder="Page title"
            className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          />
        </div>

        <div>
          <label htmlFor="new-page-category" className="block text-sm font-medium text-[var(--color-text)] mb-1">
            Category
          </label>
          <select
            id="new-page-category"
            value={category}
            onChange={e => onCategoryChange(e.target.value)}
            className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
          >
            {CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
            Content
          </label>
          <TiptapDocEditor
            content={content}
            onChange={onContentChange}
            placeholder="Write your doc content here..."
          />
        </div>
      </div>
    </div>
  )
}

// -- Page View --

function PageView({
  page, versions, editing, editTitle, editContent, editCategory, saving,
  showVersions, viewingVersion,
  onEdit, onSave, onCancelEdit, onDelete,
  onTitleChange, onContentChange, onCategoryChange,
  onToggleVersions, onViewVersion,
}: {
  page: DocPage
  versions: DocVersion[]
  editing: boolean
  editTitle: string
  editContent: string
  editCategory: string
  saving: boolean
  showVersions: boolean
  viewingVersion: DocVersion | null
  onEdit: () => void
  onSave: () => void
  onCancelEdit: () => void
  onDelete: () => void
  onTitleChange: (v: string) => void
  onContentChange: (v: string) => void
  onCategoryChange: (v: string) => void
  onToggleVersions: () => void
  onViewVersion: (v: DocVersion | null) => void
}) {
  return (
    <div className="max-w-3xl mx-auto p-6">
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-3">
              <input
                type="text"
                value={editTitle}
                onChange={e => onTitleChange(e.target.value)}
                className="w-full text-xl font-bold rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              />
              <select
                value={editCategory}
                onChange={e => onCategoryChange(e.target.value)}
                className="text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>
          ) : (
            <>
              <h1 className="text-xl font-bold text-[var(--color-text)] mb-1">{page.title}</h1>
              <div className="flex items-center gap-3 text-xs text-[var(--color-text-subtle)]">
                <span
                  className="px-2 py-0.5 rounded-md font-medium"
                  style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
                >
                  {page.category}
                </span>
                <span className="flex items-center gap-1">
                  <Clock style={{ width: '0.75rem', height: '0.75rem' }} />
                  Updated {formatDistanceToNow(new Date(page.updatedAt), { addSuffix: true })}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
          {editing ? (
            <>
              <TahiButton variant="secondary" size="sm" onClick={onCancelEdit}>
                Cancel
              </TahiButton>
              <TahiButton
                size="sm"
                onClick={onSave}
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
                onClick={onToggleVersions}
                iconLeft={<History className="w-3.5 h-3.5" />}
              >
                History
              </TahiButton>
              <TahiButton size="sm" onClick={onEdit}>
                Edit
              </TahiButton>
              <button
                onClick={onDelete}
                className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-tertiary)] transition-colors cursor-pointer"
                aria-label="Delete page"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Version history panel */}
      {showVersions && (
        <div className="mb-6 border border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Version History</h3>
            <button
              onClick={onToggleVersions}
              className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {versions.length === 0 ? (
            <p className="p-4 text-sm text-[var(--color-text-muted)]">No versions yet.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {versions.map((v, i) => (
                <button
                  key={v.id}
                  onClick={() => onViewVersion(viewingVersion?.id === v.id ? null : v)}
                  className="w-full text-left px-4 py-2.5 flex items-center justify-between text-sm transition-colors hover:bg-[var(--color-bg-secondary)]"
                  style={{
                    borderBottom: i < versions.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                    background: viewingVersion?.id === v.id ? 'var(--color-bg-tertiary)' : 'transparent',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Clock style={{ width: '0.75rem', height: '0.75rem', color: 'var(--color-text-subtle)' }} />
                    <span className="text-[var(--color-text)]">
                      {formatDistanceToNow(new Date(v.savedAt), { addSuffix: true })}
                    </span>
                    {i === 0 && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ background: 'var(--color-brand-50)', color: 'var(--color-brand)' }}
                      >
                        Current
                      </span>
                    )}
                  </div>
                  <ChevronRight
                    style={{
                      width: '0.75rem', height: '0.75rem',
                      color: 'var(--color-text-subtle)',
                      transform: viewingVersion?.id === v.id ? 'rotate(90deg)' : 'none',
                      transition: 'transform 150ms',
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Content area */}
      {editing ? (
        <TiptapDocEditor
          content={editContent}
          onChange={onContentChange}
          placeholder="Write your doc content..."
        />
      ) : viewingVersion ? (
        <div className="border border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] p-6">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => onViewVersion(null)}
              className="flex items-center gap-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
            >
              <ArrowLeft style={{ width: '0.75rem', height: '0.75rem' }} />
              Back to current
            </button>
            <span className="text-xs text-[var(--color-text-subtle)]">
              Viewing version from {formatDistanceToNow(new Date(viewingVersion.savedAt), { addSuffix: true })}
            </span>
          </div>
          <div className="text-sm text-[var(--color-text)] whitespace-pre-wrap leading-relaxed font-mono">
            {viewingVersion.contentTiptap || '(empty)'}
          </div>
        </div>
      ) : (
        <div className="border border-[var(--color-border)] rounded-xl bg-[var(--color-bg)] p-6">
          {page.contentTiptap ? (
            <div
              className="prose prose-sm max-w-none text-sm text-[var(--color-text)] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: page.contentTiptap }}
            />
          ) : page.contentText ? (
            <div
              className="tahi-doc-prose"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(page.contentText) }}
            />
          ) : (
            <div className="text-sm text-[var(--color-text)] whitespace-pre-wrap leading-relaxed">
              <span className="text-[var(--color-text-subtle)] italic">No content yet. Click Edit to add content.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
