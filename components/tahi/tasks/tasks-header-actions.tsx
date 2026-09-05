'use client'

/**
 * <TasksHeaderActions>. Two controls at every width: New task stays the
 * single primary action, and everything else (AI: break work into tasks, New
 * from template, Export CSV) lives under one overflow menu. Keeps the page
 * header the same shape on a phone as on a desktop, which is what lets the
 * header hold its width across all three views.
 *
 * The prototype used a disclosure row that expanded a submenu in place. The
 * repo's Menu has Menu.Label, which does the same job with none of the
 * nested-focus problems, so the templates are a labelled section rather than
 * a submenu.
 */

import * as React from 'react'
import { FileDown, Layers, MoreHorizontal, Plus, Sparkles } from 'lucide-react'
import { Menu } from '@/components/tahi/menu'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { TaskTemplateOption } from '@/components/tahi/tasks/task-types'

export interface TasksHeaderActionsProps {
  readOnly?: boolean
  templates: readonly TaskTemplateOption[]
  onNew: () => void
  onAiWizard: () => void
  /** Opens the create dialog with the template pre-applied. */
  onNewFromTemplate: (templateId: string) => void
  onExportCsv: () => void
}

export function TasksHeaderActions({
  readOnly = false,
  templates,
  onNew,
  onAiWizard,
  onNewFromTemplate,
  onExportCsv,
}: TasksHeaderActionsProps) {
  return (
    <>
      {!readOnly && (
        <TahiButton
          variant="primary"
          size="sm"
          onClick={onNew}
          iconLeft={<Plus className="w-3.5 h-3.5" />}
        >
          <span className="hidden sm:inline">New task</span>
          <span className="sm:hidden">New</span>
        </TahiButton>
      )}

      <Menu
        align="end"
        width="15rem"
        trigger={
          <button
            type="button"
            aria-label="More task actions"
            title="More task actions"
            // 2.75rem under md, back to the header's 2.25rem square above it.
            // On a phone this is the only route to the wizard, the templates
            // and the export, so it cannot stay a 36px target. Sizing lives in
            // the classes, not the inline style, or the style would win.
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
          <Menu.Item icon={<Sparkles size={15} aria-hidden="true" />} onClick={onAiWizard}>
            AI: break work into tasks
          </Menu.Item>
        )}
        {!readOnly && templates.length > 0 && (
          <>
            <Menu.Label>New from template</Menu.Label>
            {templates.map(t => (
              <Menu.Item
                key={t.id}
                icon={<Layers size={15} aria-hidden="true" />}
                onClick={() => onNewFromTemplate(t.id)}
              >
                {t.name}
              </Menu.Item>
            ))}
          </>
        )}
        <Menu.Divider />
        <Menu.Item icon={<FileDown size={15} aria-hidden="true" />} onClick={onExportCsv}>
          Export CSV
        </Menu.Item>
      </Menu>
    </>
  )
}
