'use client'

import { useRef, type KeyboardEvent, type RefObject } from 'react'
import { Check, ChevronLeft, ChevronRight, Circle, Plus, X } from 'lucide-react'
import { ProgressBar } from '@/components/tahi/progress-bar'
import { Badge } from '@/components/tahi/badge'
import { SlideOver } from '@/components/tahi/slide-over'
import { QA_VIEWPORTS, type QaBrowserKey, type QaPageStatus } from '@/lib/qa/types'
import { browserBreakdown, issueTotal, pageRowTitle, ticksFor, tickCount, type QaGroupSummary, type QaRoundPageRow } from './qa-types'

export type QaRailFilter = 'all' | 'untested' | 'failing' | 'issues'

export const QA_RAIL_FILTERS: { value: QaRailFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'untested', label: 'Untested' },
  { value: 'failing', label: 'Failing' },
  { value: 'issues', label: 'Has issues' },
]

/** Applies the rail filter. Order is preserved so j/k and arrows walk the visible list. */
export function filterPages(pages: QaRoundPageRow[], filter: QaRailFilter): QaRoundPageRow[] {
  switch (filter) {
    case 'untested':
      return pages.filter(p => p.status === 'untested')
    case 'failing':
      return pages.filter(p => p.status === 'fail')
    case 'issues':
      return pages.filter(p => issueTotal(p) > 0)
    default:
      return pages
  }
}

const STATUS_DOT: Record<QaPageStatus, { color: string; label: string }> = {
  untested: { color: 'var(--color-text-subtle)', label: 'Untested' },
  pass: { color: 'var(--color-success)', label: 'Passed' },
  fail: { color: 'var(--color-danger)', label: 'Failed' },
}

/** Shape per state so status never relies on colour alone: check, cross, open circle. */
function StatusIcon({ status, color }: { status: QaPageStatus; color: string }) {
  const style = { width: '0.875rem', height: '0.875rem', color }
  if (status === 'pass') return <Check aria-hidden="true" className="shrink-0" style={style} strokeWidth={3} />
  if (status === 'fail') return <X aria-hidden="true" className="shrink-0" style={style} strokeWidth={3} />
  return <Circle aria-hidden="true" className="shrink-0" style={style} strokeWidth={2} />
}

/** Stored keys already read '/blog/*' (lib/qa/grouping.ts); only normalise the slashes. */
function groupHeading(groupKey: string): string {
  const base = groupKey.replace(/^\/+/, '').replace(/\/\*$/, '')
  return `/${base}/*`
}

export interface PageRailProps {
  pages: QaRoundPageRow[]
  /** The browsers the round covers. Progress counts ticks across all of them. */
  browsers: QaBrowserKey[]
  /** The browser whose five viewport dots each row shows. */
  dotBrowser: QaBrowserKey
  groups: QaGroupSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  filter: QaRailFilter
  onFilterChange: (filter: QaRailFilter) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  /** Single-frame layout (decided by the workspace's measured width): the rail becomes a sheet. */
  singleFrame: boolean
  /** Mobile sheet state. Only used in the single-frame layout. */
  sheetOpen: boolean
  onSheetClose: () => void
  onAddSamples: (groupKey: string) => void
  readOnly: boolean
}

export function PageRail(props: PageRailProps) {
  const isMobile = props.singleFrame
  const listRef = useRef<HTMLDivElement | null>(null)
  const done = props.pages.reduce((n, p) => n + tickCount(p, props.browsers), 0)
  const total = props.pages.length * QA_VIEWPORTS.length * props.browsers.length

  if (isMobile) {
    return (
      <SlideOver open={props.sheetOpen} onClose={props.onSheetClose} title="Pages" variant="right" maxWidth="22rem">
        <RailBody {...props} listRef={listRef} done={done} total={total} collapsed={false} />
      </SlideOver>
    )
  }

  if (props.collapsed) {
    return (
      <aside
        aria-label="Pages"
        className="flex shrink-0 flex-col items-center rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]"
        style={{ width: '3rem', padding: '0.25rem' }}
      >
        <button
          type="button"
          onClick={props.onToggleCollapsed}
          aria-label="Expand page list"
          className="flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded-[var(--radius-leaf-sm)] text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </aside>
    )
  }

  return (
    <aside
      aria-label="Pages"
      className="flex w-[18rem] shrink-0 flex-col rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]"
      style={{ maxHeight: '100%' }}
    >
      <RailBody {...props} listRef={listRef} done={done} total={total} collapsed={false} />
    </aside>
  )
}

interface RailBodyProps extends PageRailProps {
  listRef: RefObject<HTMLDivElement | null>
  done: number
  total: number
  collapsed: boolean
}

function RailBody({
  pages,
  browsers,
  dotBrowser,
  groups,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
  onToggleCollapsed,
  collapsed,
  onAddSamples,
  readOnly,
  done,
  total,
  listRef,
}: RailBodyProps) {
  const visible = filterPages(pages, filter)
  const ungrouped = visible.filter(p => !p.groupKey)
  const groupKeys = [...new Set(visible.filter(p => p.groupKey).map(p => p.groupKey as string))]

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    if (visible.length === 0) return
    const idx = visible.findIndex(p => p.id === selectedId)
    const next = e.key === 'ArrowDown'
      ? Math.min(visible.length - 1, idx + 1)
      : Math.max(0, idx - 1)
    const target = visible[next] ?? visible[0]
    onSelect(target.id)
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-page-id="${target.id}"]`)
    el?.focus()
  }

  function renderRow(p: QaRoundPageRow) {
    const selected = p.id === selectedId
    const status = STATUS_DOT[p.status]
    const ticks = ticksFor(p, dotBrowser)
    const issues = issueTotal(p)
    const rowDone = tickCount(p, browsers)
    const rowTotal = QA_VIEWPORTS.length * browsers.length
    return (
      <button
        key={p.id}
        type="button"
        data-page-id={p.id}
        onClick={() => onSelect(p.id)}
        aria-current={selected ? 'true' : undefined}
        title={pageRowTitle(p, browsers)}
        className={[
          'flex w-full min-h-[2.75rem] items-center rounded-[var(--radius-leaf-sm)] px-2 text-left transition-colors',
          'hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-brand)]',
        ].join(' ')}
        style={{
          gap: '0.5rem',
          fontSize: '0.8125rem',
          background: selected ? 'var(--color-brand-50)' : undefined,
          color: 'var(--color-text)',
        }}
      >
        <StatusIcon status={p.status} color={status.color} />
        <span className="sr-only">{status.label}</span>
        <span className="min-w-0 flex-1 truncate" style={{ fontWeight: selected ? 600 : 500 }}>
          {p.path}
        </span>
        <span className="flex shrink-0 items-center" style={{ gap: '0.1875rem' }}>
          {QA_VIEWPORTS.map(v => {
            const on = ticks[v.key]
            return (
              <span key={v.key}>
                <span
                  aria-hidden="true"
                  className="inline-block rounded-full border"
                  style={{
                    width: '0.375rem',
                    height: '0.375rem',
                    background: on ? 'var(--color-brand)' : 'transparent',
                    borderColor: on ? 'var(--color-brand)' : 'var(--color-border)',
                  }}
                />
                <span className="sr-only">{on ? `${v.label} ticked` : `${v.label} not ticked`}</span>
              </span>
            )
          })}
        </span>
        {browsers.length > 1 ? (
          <span className="shrink-0 text-[var(--color-text-muted)]" style={{ fontSize: '0.6875rem', fontVariantNumeric: 'tabular-nums' }}>
            <span aria-hidden="true">{rowDone}/{rowTotal}</span>
            <span className="sr-only">{browserBreakdown(p, browsers).map(b => `${b.label} ${b.done} of ${b.total}`).join(', ')}</span>
          </span>
        ) : null}
        {issues > 0 ? (
          <Badge tone="danger" variant="count" size="sm">
            {issues}
          </Badge>
        ) : null}
      </button>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ gap: '0.75rem', padding: '0.75rem' }}>
      <div className="flex items-center justify-between" style={{ gap: '0.5rem' }}>
        <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
          Progress
        </span>
        {!collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse page list"
            className="flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded-[var(--radius-leaf-sm)] text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <ProgressBar value={done} max={Math.max(total, 1)} ariaLabel="Round progress" trailing={`${done} / ${total}`} />
      <div className="flex flex-wrap" style={{ gap: '0.375rem' }} role="group" aria-label="Filter pages">
        {QA_RAIL_FILTERS.map(f => {
          const on = filter === f.value
          return (
            <button
              key={f.value}
              type="button"
              aria-pressed={on}
              onClick={() => onFilterChange(f.value)}
              className="min-h-[2.75rem] rounded-full border px-3 transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                borderColor: on ? 'var(--color-brand)' : 'var(--color-border)',
                background: on ? 'var(--color-brand-50)' : 'var(--color-bg)',
                color: on ? 'var(--color-brand-on-tint)' : 'var(--color-text-muted)',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>
      <div
        ref={listRef}
        onKeyDown={onListKey}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
        style={{ gap: '0.125rem' }}
        role="group"
        aria-label="Page list"
      >
        {visible.length === 0 ? (
          <p className="px-2 py-3 text-[var(--color-text-muted)]" style={{ fontSize: '0.8125rem' }}>
            No pages match this filter.
          </p>
        ) : null}
        {ungrouped.map(renderRow)}
        {groupKeys.map(key => {
          const summary = groups.find(g => g.groupKey === key)
          const rows = visible.filter(p => p.groupKey === key)
          const sampled = summary?.sampled ?? rows.length
          const totalPages = summary?.totalPages ?? rows.length
          return (
            <div key={key} className="flex flex-col" style={{ gap: '0.125rem', marginTop: '0.5rem' }}>
              <div className="flex items-center justify-between px-2" style={{ gap: '0.5rem' }}>
                <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                  {groupHeading(key)} · {sampled} of {totalPages} sampled
                </span>
                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => onAddSamples(key)}
                    className="flex min-h-[2.75rem] items-center rounded-[var(--radius-leaf-sm)] px-2 text-[var(--color-brand-dark)] transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                    style={{ gap: '0.25rem', fontSize: '0.75rem', fontWeight: 600 }}
                  >
                    <Plus className="size-3.5" aria-hidden="true" />
                    Add 3 more
                  </button>
                ) : null}
              </div>
              {rows.map(renderRow)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
