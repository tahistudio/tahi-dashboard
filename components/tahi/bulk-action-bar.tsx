'use client'

/**
 * <BulkActionBar>. One selection toolbar for every multi-select list
 * (requests, tasks, and anything else that grows a "N selected" bar).
 * Replaces the hand-rolled bars that sat four side-by-side dropdowns in a
 * row.
 *
 * Shape the review asked for:
 *   - ONE primary action stays visible; everything else collapses into a
 *     single "Edit" Menu with Menu.Label sections (not a row of dropdowns).
 *   - The bar carries a full hairline border (all sides, house rule), not
 *     a single-side rule.
 *   - Destructive actions (Archive, Delete) pass `confirm` and route
 *     through the shared ConfirmDialog before running.
 *   - Every action fires a mandatory toast: success, partial-failure
 *     (warning), or error. Return { ok, failed } from `run` to get an
 *     exact count; return void for a generic success.
 *
 *   <BulkActionBar
 *     selectedCount={ids.size}
 *     itemNoun="request"
 *     primaryAction={{ id: 'deliver', label: 'Mark delivered', run: ... }}
 *     actions={[
 *       { id: 'status-submitted', section: 'Status', label: 'Submitted', run: ... },
 *       { id: 'archive', section: 'Danger', label: 'Archive', tone: 'danger',
 *         confirm: { title: 'Archive requests?', description: '...' }, run: ... },
 *     ]}
 *     onClear={clear}
 *     onResult={refresh}
 *   />
 */

import { useState } from 'react'
import { ChevronDown, Loader2, MoreHorizontal } from 'lucide-react'
import { Menu } from '@/components/tahi/menu'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { useToast } from '@/components/tahi/toast'

export interface BulkActionResult {
  /** How many items the action changed. */
  ok: number
  /** How many items failed. Presence of a positive value flips the toast
   *  to the partial-failure (warning) style. */
  failed?: number
}

export interface BulkAction {
  /** Stable key. Used for React keys and the in-flight lock. */
  id: string
  label: string
  icon?: React.ReactNode
  /** Menu.Label section this action groups under. Consecutive actions
   *  sharing a section render under a single label. Omit for ungrouped
   *  items at the top of the menu. Ignored for the primary action. */
  section?: string
  tone?: 'default' | 'danger'
  disabled?: boolean
  /** When set, the action routes through the shared ConfirmDialog first.
   *  Mandatory for destructive actions. */
  confirm?: {
    title: string
    description: string
    confirmLabel?: string
    variant?: 'danger' | 'warning' | 'primary'
  }
  /** Runs the mutation. Return { ok, failed } for a precise toast, void
   *  for a generic success. Throw to trigger the error toast. */
  run: () => Promise<BulkActionResult | void> | BulkActionResult | void
  /** Past-tense verb for the toast, e.g. 'archived'. Defaults to 'updated'. */
  verb?: string
  /** Full success message override. Wins over the counted default. */
  successMessage?: string
  /** Error toast override. Defaults to "Couldn't <verb> ...". */
  errorMessage?: string
}

interface BulkActionBarProps {
  selectedCount: number
  /** Singular noun for count messages, e.g. 'request'. Pluralised with an
   *  's'. Defaults to 'item'. */
  itemNoun?: string
  /** The single always-visible action. */
  primaryAction?: BulkAction
  /** Everything else, collapsed into the Edit menu. */
  actions?: BulkAction[]
  /** Clears the current selection. */
  onClear: () => void
  /** Fires after any action settles (including partial failure) so the
   *  page can refetch / clear selection. */
  onResult?: (result: BulkActionResult) => void
  /** Label for the collapsed menu trigger. Defaults to 'Edit'. */
  menuLabel?: string
}

function pluralise(noun: string, n: number): string {
  return `${noun}${n === 1 ? '' : 's'}`
}

/**
 * Pure toast-message decision for a settled action. Exported so it can be
 * unit-tested without rendering. Errors (thrown runs) are handled by the
 * component, not here.
 */
export function bulkResultToast(
  result: BulkActionResult,
  opts: { verb?: string; itemNoun?: string; successMessage?: string },
): { message: string; type: 'success' | 'warning' } {
  const verb = opts.verb ?? 'updated'
  const noun = opts.itemNoun ?? 'item'
  const failed = result.failed ?? 0
  if (failed > 0) {
    return {
      message: `${result.ok} ${pluralise(noun, result.ok)} ${verb}, ${failed} failed`,
      type: 'warning',
    }
  }
  return {
    message: opts.successMessage ?? `${result.ok} ${pluralise(noun, result.ok)} ${verb}`,
    type: 'success',
  }
}

const CONTROL_MIN_HEIGHT = '2.75rem'

export function BulkActionBar({
  selectedCount,
  itemNoun = 'item',
  primaryAction,
  actions = [],
  onClear,
  onResult,
  menuLabel = 'Edit',
}: BulkActionBarProps) {
  const { showToast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<BulkAction | null>(null)
  const busy = busyId !== null

  async function runAction(action: BulkAction) {
    setBusyId(action.id)
    try {
      const raw = await action.run()
      const result: BulkActionResult =
        raw && typeof raw === 'object' ? raw : { ok: selectedCount }
      const toast = bulkResultToast(result, {
        verb: action.verb,
        itemNoun,
        successMessage: action.successMessage,
      })
      showToast(toast.message, toast.type)
      onResult?.(result)
    } catch {
      showToast(
        action.errorMessage ?? `Couldn't ${action.verb ?? 'update'} ${pluralise(itemNoun, selectedCount)}`,
        'error',
      )
    } finally {
      setBusyId(null)
      setConfirmAction(null)
    }
  }

  function requestAction(action: BulkAction) {
    if (action.disabled || busy) return
    if (action.confirm) setConfirmAction(action)
    else void runAction(action)
  }

  // Build the menu body, emitting a Menu.Label whenever the section
  // changes so grouped actions read as sections.
  const menuChildren: React.ReactNode[] = []
  let lastSection: string | undefined
  actions.forEach((action, i) => {
    if (action.section && action.section !== lastSection) {
      if (i > 0) menuChildren.push(<Menu.Divider key={`div-${action.id}`} />)
      menuChildren.push(<Menu.Label key={`lbl-${action.id}`}>{action.section}</Menu.Label>)
      lastSection = action.section
    }
    menuChildren.push(
      <Menu.Item
        key={action.id}
        icon={action.icon}
        tone={action.tone}
        disabled={action.disabled || busy}
        onClick={() => requestAction(action)}
      >
        {action.label}
      </Menu.Item>,
    )
  })

  return (
    <>
      <div
        className="flex items-center gap-2 flex-wrap"
        role="toolbar"
        aria-label={`${selectedCount} selected`}
        style={{
          padding: '0.5rem 0.75rem',
          background: 'var(--color-brand-50)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--color-brand-dark)', paddingLeft: '0.25rem' }}
        >
          {selectedCount} selected
        </span>

        {primaryAction && (
          <button
            type="button"
            onClick={() => requestAction(primaryAction)}
            disabled={primaryAction.disabled || busy}
            className="tahi-focus-ring inline-flex items-center justify-center gap-1.5 text-sm font-medium"
            style={{
              minHeight: CONTROL_MIN_HEIGHT,
              padding: '0 0.875rem',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: 'var(--color-brand)',
              color: '#ffffff',
              cursor: primaryAction.disabled || busy ? 'not-allowed' : 'pointer',
              opacity: primaryAction.disabled || (busy && busyId !== primaryAction.id) ? 0.6 : 1,
              transition: 'background-color 150ms ease, opacity 150ms ease',
            }}
            onMouseEnter={(e) => {
              if (!primaryAction.disabled && !busy) e.currentTarget.style.background = 'var(--color-brand-dark)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--color-brand)'
            }}
          >
            {busyId === primaryAction.id ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              primaryAction.icon
            )}
            {primaryAction.label}
          </button>
        )}

        {menuChildren.length > 0 && (
          <Menu
            align="start"
            width="15rem"
            trigger={
              <button
                type="button"
                disabled={busy}
                className="tahi-focus-ring inline-flex items-center justify-center gap-1.5 text-sm font-medium"
                style={{
                  minHeight: CONTROL_MIN_HEIGHT,
                  padding: '0 0.75rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  transition: 'border-color 150ms ease, background-color 150ms ease',
                }}
                onMouseEnter={(e) => {
                  if (!busy) e.currentTarget.style.borderColor = 'var(--color-brand)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-border)'
                }}
              >
                {busy && !primaryAction ? (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                ) : (
                  <MoreHorizontal size={14} aria-hidden="true" />
                )}
                {menuLabel}
                <ChevronDown size={13} aria-hidden="true" style={{ color: 'var(--color-text-subtle)' }} />
              </button>
            }
          >
            {menuChildren}
          </Menu>
        )}

        <div className="flex-1" style={{ minWidth: '0.5rem' }} />

        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="tahi-focus-ring inline-flex items-center justify-center text-sm font-medium"
          style={{
            minHeight: CONTROL_MIN_HEIGHT,
            padding: '0 0.625rem',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: 'transparent',
            color: 'var(--color-text-muted)',
            cursor: busy ? 'not-allowed' : 'pointer',
            opacity: busy ? 0.6 : 1,
            transition: 'color 150ms ease',
          }}
          onMouseEnter={(e) => {
            if (!busy) e.currentTarget.style.color = 'var(--color-text)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--color-text-muted)'
          }}
        >
          Clear
        </button>
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        title={confirmAction?.confirm?.title ?? ''}
        description={confirmAction?.confirm?.description ?? ''}
        confirmLabel={confirmAction?.confirm?.confirmLabel ?? confirmAction?.label ?? 'Confirm'}
        variant={confirmAction?.confirm?.variant ?? 'danger'}
        onConfirm={() => (confirmAction ? runAction(confirmAction) : Promise.resolve())}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  )
}
