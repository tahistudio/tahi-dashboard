'use client'

/**
 * <SearchPalette>. Global command-palette-style search across every
 * dynamic entity in the dashboard. Hits /api/admin/search?q=... with
 * a 150ms debounce, renders suggestions on top, then one section per
 * non-empty group (Requests, Tasks, Clients, Deals, ...).
 *
 * Skinned to the "Tahi App Shell" command-palette design (see
 * app/(dashboard)/app-shell.css: .cmd-overlay / .cmd / .cmd-input /
 * .cmd-results / .cmd-row / .cmd-glabel / .cmd-empty).
 *
 * Keyboard:
 *   ArrowDown / ArrowUp : move active row
 *   Enter               : open active row
 *   Esc                 : close palette
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Loader2, X, ArrowRight, Inbox, CheckSquare, Users,
  User as UserIcon, Briefcase, TrendingUp, FileText, FileSignature,
  Calendar, BookOpen, Phone, ShoppingBag, Megaphone, Zap, UserCog,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
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

// One short context string per row, mapped to .cr-crumb. Prefer the
// item's subtitle (org name / email) and fall back to a humanised badge
// (status / role) so every row carries some context where one exists.
function crumbFor(item: SearchResultItem): string | undefined {
  if (item.sub) return item.sub
  if (item.badge) return item.badge.replace(/_/g, ' ')
  return undefined
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
    fetch(apiPath(`/api/admin/search?q=${encodeURIComponent(debounced)}`), {
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
    <div className="cmd-overlay" onClick={onClose} role="presentation">
      <div
        className="cmd"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search the dashboard"
      >
        {/* Input row */}
        <div className="cmd-input">
          <span className="ci-ic" aria-hidden="true">
            {loading
              ? <Loader2 size={19} className="animate-spin" />
              : <Search size={19} />}
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search or jump to..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            aria-label="Search or jump to"
            aria-controls="search-palette-results"
            aria-activedescendant={flatItems[clampedActive] ? `search-result-${clampedActive}` : undefined}
          />
          <button
            type="button"
            className="cmd-close"
            onClick={onClose}
            aria-label="Close search (Escape)"
          >
            <span className="cmd-esc">esc</span>
            <span className="cmd-x" aria-hidden="true"><X size={18} /></span>
          </button>
        </div>

        {/* Results */}
        <div
          id="search-palette-results"
          ref={listRef}
          role="listbox"
          aria-label="Search results"
          className="cmd-results"
        >
          {debounced.length < 2 ? (
            <div className="cmd-empty">
              Search the dashboard
              <small>Find a request, client, deal, doc, or action.</small>
            </div>
          ) : !data ? (
            <div className="cmd-empty">
              Searching...
              <small>{`Looking for "${debounced}"`}</small>
            </div>
          ) : data.totalCount === 0 ? (
            <div className="cmd-empty">
              {`No matches for "${debounced}"`}
              <small>Try a shorter query or a different keyword.</small>
            </div>
          ) : (
            <>
              {data.suggestions.length > 0 && (
                <div>
                  <div className="cmd-glabel">Suggestions</div>
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
                </div>
              )}
              {data.groups.map(group => {
                const offset = data.suggestions.length + cumulativeOffset(data.groups, group.type)
                return (
                  <div key={group.type}>
                    <div className="cmd-glabel">{group.label}</div>
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
                  </div>
                )
              })}
            </>
          )}
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
  const crumb = crumbFor(item)
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
      className={active ? 'cmd-row sel' : 'cmd-row'}
    >
      <span className="cr-ic" aria-hidden="true">
        <Icon size={15} />
      </span>
      <span className="cr-t" data-private>{item.title}</span>
      {crumb && <span className="cr-crumb" data-private>{crumb}</span>}
      <span className="cr-go" aria-hidden="true">
        <ArrowRight size={15} />
      </span>
    </button>
  )
}
