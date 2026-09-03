'use client'

/**
 * <RequestsHeaderActions>. Two controls at every width: New request stays the
 * single primary action, and everything else (AI draft, Export CSV, Bulk
 * create) lives under one overflow menu. Keeps the page header the same shape
 * on a phone as on a desktop, which is what lets the header hold its width
 * across all four views.
 */

import * as React from 'react'
import { FileDown, Layers, MoreHorizontal, Plus, Sparkles } from 'lucide-react'
import { Menu } from '@/components/tahi/menu'
import { TahiButton } from '@/components/tahi/tahi-button'

export interface RequestsHeaderActionsProps {
  /** Tahi team. Gates Export CSV and Bulk create. */
  isAdmin: boolean
  /** Read-only lens (an impersonated viewer). Hides every write action. */
  readOnly?: boolean
  onNew: () => void
  onAiDraft: () => void
  onExportCsv: () => void
  onBulkCreate: () => void
}

export function RequestsHeaderActions({
  isAdmin,
  readOnly = false,
  onNew,
  onAiDraft,
  onExportCsv,
  onBulkCreate,
}: RequestsHeaderActionsProps) {
  // With no write actions and no export there is nothing to put in the menu.
  const showMenu = !readOnly || isAdmin

  return (
    <>
      {!readOnly && (
        <TahiButton
          variant="primary"
          size="sm"
          onClick={onNew}
          iconLeft={<Plus className="w-3.5 h-3.5" />}
        >
          <span className="hidden sm:inline">New request</span>
          <span className="sm:hidden">New</span>
        </TahiButton>
      )}

      {showMenu && (
        <Menu
          align="end"
          width="12rem"
          trigger={
            <button
              type="button"
              aria-label="More request actions"
              title="More request actions"
              // 2.75rem under md, back to the header's 2.25rem square above
              // it. On a phone this is the only route to AI draft, Export CSV
              // and Bulk create, so it cannot stay a 36px target. Sizing lives
              // in the classes, not the inline style, or the style would win.
              className="tahi-focus-ring inline-flex items-center justify-center w-11 h-11 md:w-9 md:h-9"
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-bg)',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'var(--color-brand)'
                e.currentTarget.style.color = 'var(--color-text)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--color-border)'
                e.currentTarget.style.color = 'var(--color-text-muted)'
              }}
            >
              <MoreHorizontal size={16} aria-hidden="true" />
            </button>
          }
        >
          {!readOnly && (
            <Menu.Item icon={<Sparkles size={15} />} onClick={onAiDraft}>
              AI draft
            </Menu.Item>
          )}
          {isAdmin && !readOnly && <Menu.Divider />}
          {isAdmin && (
            <Menu.Item icon={<FileDown size={15} />} onClick={onExportCsv}>
              Export CSV
            </Menu.Item>
          )}
          {isAdmin && !readOnly && (
            <Menu.Item icon={<Layers size={15} />} onClick={onBulkCreate}>
              Bulk create
            </Menu.Item>
          )}
        </Menu>
      )}
    </>
  )
}
