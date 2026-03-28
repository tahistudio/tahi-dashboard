'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  BookOpen, Plus, Search, ChevronRight, Clock, Save,
  Trash2, ArrowLeft, History, X, RefreshCw, FileText,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { TiptapDocEditor } from '@/components/tahi/tiptap-doc-editor'
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

  // Group pages by category
  const grouped = CATEGORIES.map(cat => ({
    ...cat,
    pages: pages.filter(p => p.category === cat.value),
  })).filter(g => g.pages.length > 0)

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
            className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors"
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
              className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors"
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
        </div>

        {/* Page tree */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <LoadingSkeleton rows={5} />
          ) : pages.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-xs text-[var(--color-text-muted)]">No docs found</p>
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.value} className="mb-3">
                <p className="text-xs font-semibold text-[var(--color-text-subtle)] uppercase tracking-wider px-2 mb-1">
                  {group.label}
                </p>
                {group.pages.map(page => (
                  <button
                    key={page.id}
                    onClick={() => loadPage(page.id)}
                    className="w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2"
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
            ))
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
                className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-tertiary)] transition-colors"
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
              className="p-1 rounded hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]"
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
