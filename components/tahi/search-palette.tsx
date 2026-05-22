'use client'

/**
 * <SearchPalette>. Global command-palette-style search across every
 * dynamic entity in the dashboard. Hits /api/admin/search?q=... with
 * a 150ms debounce, renders suggestions on top, then one section per
 * non-empty group (Requests, Tasks, Clients, Deals, ...).
 *
 * Keyboard:
 *   ArrowDown / ArrowUp : move active row
 *   Enter               : open active row
 *   Esc                 : close palette
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Loader2, Inbox, CheckSquare, Users, User as UserIcon,
  Briefcase, TrendingUp, FileText, FileSignature, Calendar, BookOpen,
  Phone, ShoppingBag, Megaphone, Zap, UserCog,
} from 'lucide-react'
import type { SearchGroupType, SearchResultItem, SearchResponse } from '@/app/api/admin/search/route'

interface SearchPaletteProps {
  open: boolean
  onClose: () => void
}

const TYPE_ICON: Record<SearchGroupType, React.ComponentType<{ size?: number; className?: string }>> = {
  request: Inbox,
  task: CheckSquare,
  client: Users,
  brand: Briefcase,
  contact: UserIcon,
  deal: TrendingUp,
  invoice: FileText,
  contract: FileSignature,
  proposal: FileText,
  schedule: Calendar,
  doc: BookOpen,
  call: Phone,
  service: ShoppingBag,
  announcement: Megaphone,
  automation: Zap,
  team: UserCog,
}

export function SearchPalette({ open, onClose }: SearchPaletteProps) {
  const router = useRouter()
  const [query, setQuery] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  const [data, setData] = React.useState<SearchResponse | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const listRef = React.useRef<HTMLDivElement | null>(null)

  // Reset everything when the palette closes so the next open starts
  // clean. Focus the input when it opens.
  React.useEffect(() => {
    if (!open) {
      setQuery('')
      setDebounced('')
      setData(null)
      setActive(0)
      return
    }
    const id = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(id)
  }, [open])

  // Debounce the query so we don't fire a request on every keystroke.
  React.useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query.trim()), 150)
    return () => window.clearTimeout(id)
  }, [query])

  // Fetch when the debounced query changes.
  React.useEffect(() => {
    if (!open) return
    if (debounced.length < 2) {
      setData(null)
      setLoading(false)
      return
    }
    let abort = false
    const controller = new AbortController()
    setLoading(true)
    fetch(`/api/admin/search?q=${encodeURIComponent(debounced)}`, {
      signal: controller.signal,
    })
      .then(res => res.ok ? res.json() as Promise<SearchResponse> : null)
      .then(json => {
        if (abort) return
        setData(json)
        setActive(0)
      })
      .catch(() => { if (!abort) setData(null) })
      .finally(() => { if (!abort) setLoading(false) })
    return () => {
      abort = true
      controller.abort()
    }
  }, [debounced, open])

  // Build the flat list of selectable items in render order. The
  // suggestions row sits first, then each group's items.
  const flatItems = React.useMemo<SearchResultItem[]>(() => {
    if (!data) return []
    const out: SearchResultItem[] = []
    for (const s of data.suggestions) out.push(s)
    for (const g of data.groups) for (const it of g.items) out.push(it)
    return out
  }, [data])

  const clampedActive = flatItems.length === 0
    ? 0
    : Math.max(0, Math.min(active, flatItems.length - 1))

  const navigateTo = React.useCallback((item: SearchResultItem) => {
    onClose()
    router.push(item.href)
  }, [onClose, router])

  const handleKey = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(a => Math.min(a + 1, Math.max(0, flatItems.length - 1)))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(a => Math.max(a - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = flatItems[clampedActive]
      if (item) navigateTo(item)
      return
    }
  }, [flatItems, clampedActive, onClose, navigateTo])

  // Scroll the active row into view.
  React.useEffect(() => {
    if (!listRef.current) return
    const node = listRef.current.querySelector<HTMLElement>(`[data-search-index="${clampedActive}"]`)
    if (node) node.scrollIntoView({ block: 'nearest' })
  }, [clampedActive])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      style={{
        background: 'rgba(15, 20, 16, 0.55)',
        backdropFilter: 'blur(4px) saturate(140%)',
        WebkitBackdropFilter: 'blur(4px) saturate(140%)',
        padding: 'var(--space-4)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search the dashboard"
        style={{
          width: '100%',
          maxWidth: '42rem',
          maxHeight: '70vh',
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 24px 60px rgba(15, 20, 16, 0.32), 0 4px 16px rgba(15, 20, 16, 0.10)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Input row. Bigger height (3rem), borderless interior so the
            search bar reads as a header rather than a form field. The
            row gets its own focus state via the surrounding container
            background tint. */}
        <div
          className="flex items-center"
          style={{
            padding: '0 var(--space-5)',
            height: '3.5rem',
            borderBottom: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg)',
            gap: 'var(--space-3)',
          }}
        >
          <span style={{ display: 'inline-flex', flexShrink: 0 }}>
            {loading
              ? <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-brand)' }} aria-hidden="true" />
              : <Search size={18} style={{ color: 'var(--color-brand)' }} aria-hidden="true" />}
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search requests, tasks, clients, deals, docs..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            aria-label="Search the dashboard"
            aria-controls="search-palette-results"
            aria-activedescendant={flatItems[clampedActive] ? `search-result-${clampedActive}` : undefined}
            className="search-palette-input"
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 'var(--text-base)',
              color: 'var(--color-text)',
              fontWeight: 500,
              padding: '0.5rem 0',
            }}
          />
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center"
            style={{
              flexShrink: 0,
              padding: '0.125rem 0.4375rem',
              height: '1.5rem',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-muted)',
              fontSize: '0.625rem',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background-color 150ms ease, color 150ms ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--color-bg-tertiary)'
              e.currentTarget.style.color = 'var(--color-text)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--color-bg-secondary)'
              e.currentTarget.style.color = 'var(--color-text-muted)'
            }}
            aria-label="Close search (Escape)"
          >
            Esc
          </button>
        </div>

        {/* Results */}
        <div
          id="search-palette-results"
          ref={listRef}
          role="listbox"
          aria-label="Search results"
          style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2) 0' }}
        >
          {debounced.length < 2 ? (
            <EmptyHint
              icon={<Search size={28} style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />}
              title="Search everywhere"
              description="Find a request, task, client, deal, doc, invoice, anything you've created in the dashboard. Start typing to see results across the app."
            />
          ) : !data ? (
            <EmptyHint
              icon={<Loader2 size={20} className="animate-spin" style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />}
              title="Searching"
              description={`Looking for "${debounced}"`}
            />
          ) : data.totalCount === 0 ? (
            <EmptyHint
              icon={<Search size={28} style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />}
              title={`No matches for "${debounced}"`}
              description="Try a shorter query or a different keyword."
            />
          ) : (
            <>
              {data.suggestions.length > 0 && (
                <ResultSection label="Suggestions">
                  {data.suggestions.map((item, i) => (
                    <ResultRow
                      key={`s-${item.type}-${item.id}`}
                      item={item}
                      index={i}
                      active={clampedActive === i}
                      onHover={() => setActive(i)}
                      onSelect={() => navigateTo(item)}
                    />
                  ))}
                </ResultSection>
              )}
              {data.groups.map(group => {
                const offset = data.suggestions.length + cumulativeOffset(data.groups, group.type)
                return (
                  <ResultSection key={group.type} label={group.label} count={group.items.length}>
                    {group.items.map((item, i) => {
                      const idx = offset + i
                      return (
                        <ResultRow
                          key={`g-${item.type}-${item.id}`}
                          item={item}
                          index={idx}
                          active={clampedActive === idx}
                          onHover={() => setActive(idx)}
                          onSelect={() => navigateTo(item)}
                        />
                      )
                    })}
                  </ResultSection>
                )
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: '1px solid var(--color-border-subtle)',
            padding: '0.5rem var(--space-4)',
            background: 'var(--color-bg-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
          }}
        >
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', margin: 0 }}>
            {data ? `${data.totalCount} result${data.totalCount === 1 ? '' : 's'}` : 'Type at least 2 characters'}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }} className="hidden sm:flex">
            <KbdHint><Up /> <Down /></KbdHint>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>navigate</span>
            <KbdHint>Enter</KbdHint>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>open</span>
            <KbdHint>Esc</KbdHint>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>close</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Cumulative offset of a group within the rendered list, so each row
// knows its global index for keyboard nav.
function cumulativeOffset(
  groups: SearchResponse['groups'],
  upTo: SearchGroupType,
): number {
  let sum = 0
  for (const g of groups) {
    if (g.type === upTo) return sum
    sum += g.items.length
  }
  return sum
}

function ResultSection({
  label,
  count,
  children,
}: {
  label: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <section style={{ padding: '0 var(--space-2)', marginBottom: 'var(--space-2)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.375rem 0.625rem 0.25rem',
        }}
      >
        <span
          style={{
            fontSize: '0.6875rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--color-text-subtle)',
          }}
        >
          {label}
        </span>
        {typeof count === 'number' && count > 0 && (
          <span
            style={{
              fontSize: '0.625rem',
              fontWeight: 500,
              color: 'var(--color-text-subtle)',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              padding: '0.0625rem 0.375rem',
            }}
          >
            {count}
          </span>
        )}
      </div>
      <div role="group" aria-label={label}>
        {children}
      </div>
    </section>
  )
}

function ResultRow({
  item,
  index,
  active,
  onHover,
  onSelect,
}: {
  item: SearchResultItem
  index: number
  active: boolean
  onHover: () => void
  onSelect: () => void
}) {
  const Icon = TYPE_ICON[item.type]
  return (
    <button
      type="button"
      id={`search-result-${index}`}
      role="option"
      aria-selected={active}
      data-search-index={index}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onSelect}
      className="w-full flex items-center text-left"
      style={{
        gap: 'var(--space-3)',
        padding: '0.5rem 0.625rem',
        background: active ? 'var(--color-bg-secondary)' : 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text)',
        cursor: 'pointer',
        transition: 'background-color 150ms ease',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '1.75rem',
          height: '1.75rem',
          flexShrink: 0,
          background: active ? 'var(--color-brand-100)' : 'var(--color-bg-tertiary)',
          color: active ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
          borderRadius: 'var(--radius-sm)',
          transition: 'background-color 150ms ease, color 150ms ease',
        }}
      >
        <Icon size={14} aria-hidden="true" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            fontWeight: 500,
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.title}
        </div>
        {item.sub && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-subtle)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: '0.0625rem',
            }}
          >
            {item.sub}
          </div>
        )}
      </div>
      {item.badge && (
        <span
          style={{
            flexShrink: 0,
            fontSize: '0.625rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            color: 'var(--color-text-subtle)',
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-sm)',
            padding: '0.0625rem 0.4375rem',
          }}
        >
          {item.badge}
        </span>
      )}
    </button>
  )
}

function EmptyHint({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div
      style={{
        padding: '2rem var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0.5rem',
        textAlign: 'center',
      }}
    >
      <div style={{ marginBottom: '0.25rem' }}>{icon}</div>
      <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>
        {title}
      </p>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', margin: 0, maxWidth: '24rem' }}>
        {description}
      </p>
    </div>
  )
}

function KbdHint({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.125rem',
        padding: '0.0625rem var(--space-1-5)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-sm)',
        fontSize: '0.625rem',
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        color: 'var(--color-text-muted)',
        fontWeight: 500,
        lineHeight: 1.4,
      }}
    >
      {children}
    </kbd>
  )
}

const Up = () => <span aria-hidden="true">{'↑'}</span>
const Down = () => <span aria-hidden="true">{'↓'}</span>
