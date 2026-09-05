'use client'

/**
 * <TaskQuickAdd>. One line at the top of the list: type a task, press Enter.
 *
 * The four chips under the input are the whole point. They show what the
 * parser heard as you type, so nobody has to learn the grammar from a help
 * page: you write "chase the invoice @Kowtow friday !high" and watch Client,
 * Due, Priority and Level light up. Parsing is lib/tasks-quick-add.ts, which
 * is where the rules are tested; this file only renders what it returns.
 */

import * as React from 'react'
import { Calendar, CornerDownLeft, Plus, Users, Zap } from 'lucide-react'
import { parseQuickAdd, type QuickAddClient, type QuickAddParse } from '@/lib/tasks-quick-add'
import { LEVEL_ICON } from '@/components/tahi/tasks/task-chips'
import { TASK_LEVEL_LABELS } from '@/lib/tasks-views'
import { formatDueDateLabel } from '@/components/tahi/due-date-chip'
import { taskPriorityLabel } from '@/lib/task-priorities'
import { useToast } from '@/components/tahi/toast'

export interface TaskQuickAddProps {
  clients: readonly QuickAddClient[]
  /** Resolves when the write lands. Rejecting leaves the text in the box so
   *  the user can retry rather than retyping. */
  onAdd: (parsed: QuickAddParse) => Promise<void>
  disabled?: boolean
  /** Injected in tests; defaults to the wall clock. */
  now?: Date
}

/** One live chip: an icon, the dimension it reads, and what the parser heard.
 *  `found` is what tints it, so a glance says which tokens actually landed. */
function Hint({
  icon,
  label,
  value,
  found,
}: {
  icon: React.ReactNode
  label: string
  value: string
  found: boolean
}) {
  return (
    <span
      className="inline-flex items-center"
      style={{
        gap: '0.3125rem',
        height: '1.375rem',
        padding: '0 0.5rem',
        border: found
          ? '1px solid color-mix(in srgb, var(--color-brand) 40%, transparent)'
          : '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-sm)',
        background: found
          ? 'color-mix(in srgb, var(--color-brand) 8%, var(--color-bg))'
          : 'var(--color-bg-secondary)',
        fontSize: '0.6875rem',
        fontWeight: 600,
        color: found ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      <span style={{ fontWeight: 500, color: found ? 'inherit' : 'var(--color-text-subtle)' }}>{label}</span>
      <b style={{ fontWeight: 700 }}>{value}</b>
    </span>
  )
}

/** One example token in the empty-state tip. */
function Token({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontSize: '0.6875rem',
        fontWeight: 600,
        fontFamily: 'inherit',
        color: 'var(--color-text-muted)',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-sm)',
        padding: '0 0.3125rem',
      }}
    >
      {children}
    </code>
  )
}

export function TaskQuickAdd({ clients, onAdd, disabled = false, now }: TaskQuickAddProps): React.ReactElement {
  const { showToast } = useToast()
  const [value, setValue] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const parsed = React.useMemo(
    () => parseQuickAdd(value, clients, now),
    [value, clients, now],
  )

  const hasText = value.trim().length > 0
  const client = parsed.orgId ? clients.find(c => c.id === parsed.orgId) ?? null : null
  const dueLabel = formatDueDateLabel(parsed.dueDate)
  const LevelIcon = LEVEL_ICON[parsed.level]
  const canSubmit = !disabled && !busy && parsed.title.length > 0

  const submit = React.useCallback(async () => {
    if (disabled || busy || !parsed.title) return
    setBusy(true)
    // The toast repeats what the chips promised, so a task that flew off the
    // line still says out loud which client, date and priority it took.
    const bits = [client?.name, dueLabel, parsed.priority ? taskPriorityLabel(parsed.priority) : null]
      .filter((bit): bit is string => !!bit)
    try {
      await onAdd(parsed)
      if (!mountedRef.current) return
      setValue('')
      showToast(bits.length > 0 ? `Added · ${bits.join(' · ')}` : 'Added', 'success')
    } catch {
      // The text stays in the box on purpose: retrying is one keypress, and
      // retyping a parsed line is not.
      if (mountedRef.current) showToast("Couldn't add the task", 'error')
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [disabled, busy, parsed, client, dueLabel, onAdd, showToast])

  return (
    <div
      // The class still earns its keep: it clears the inner input's own
      // outline. The ring itself is painted here rather than left to the
      // class, because this box has a resting shadow and an inline
      // box-shadow outranks any stylesheet rule that would replace it.
      className="tahi-focus-within flex flex-col"
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={e => {
        // Only drop the ring when focus leaves the box entirely, not when it
        // hops from the input to the Add button.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
      }}
      style={{
        marginTop: '1rem',
        border: `1px solid ${focused ? 'var(--focus-ring-color)' : 'var(--color-border)'}`,
        borderRadius: '0.875rem',
        background: 'var(--color-bg)',
        boxShadow: focused ? 'var(--focus-ring)' : 'var(--shadow-sm)',
        transition: 'border-color var(--motion-quick) var(--ease-out), box-shadow var(--motion-quick) var(--ease-out)',
      }}
    >
      <div
        className="flex items-center min-h-[3.25rem] md:min-h-[3rem]"
        style={{ gap: '0.625rem', padding: '0 0.75rem 0 1rem' }}
      >
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center"
          style={{
            width: '1.25rem',
            height: '1.25rem',
            flexShrink: 0,
            borderRadius: 'var(--radius-full)',
            border: `1.5px dashed ${focused ? 'var(--color-brand)' : 'var(--color-border)'}`,
            color: focused ? 'var(--color-brand)' : 'var(--color-text-subtle)',
            transition: 'border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
          }}
        >
          <Plus size={12} strokeWidth={2.6} aria-hidden="true" />
        </span>

        <input
          value={value}
          disabled={disabled}
          aria-label="Add a task"
          placeholder={disabled ? 'Read-only' : 'Add a task, press Enter'}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); void submit() }
            if (e.key === 'Escape') setValue('')
          }}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            background: 'transparent',
            outline: 'none',
            boxShadow: 'none',
            fontSize: '0.84375rem',
            fontWeight: 500,
            color: 'var(--color-text)',
          }}
        />

        {hasText && (
          <button
            type="button"
            className="tahi-focus-ring inline-flex items-center justify-center h-11 md:h-[1.875rem]"
            disabled={!canSubmit}
            aria-disabled={!canSubmit || undefined}
            onClick={() => { void submit() }}
            style={{
              gap: '0.375rem',
              padding: '0 0.75rem',
              flexShrink: 0,
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-brand)',
              color: 'var(--color-text-on-dark)',
              fontFamily: 'inherit',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: canSubmit ? 'pointer' : 'default',
              opacity: canSubmit ? 1 : 0.45,
              transition: 'background-color var(--motion-quick) var(--ease-out), opacity var(--motion-quick) var(--ease-out)',
            }}
            onMouseEnter={e => { if (canSubmit) e.currentTarget.style.background = 'var(--color-brand-dark)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'var(--color-brand)' }}
          >
            Add
            <CornerDownLeft size={11} aria-hidden="true" style={{ opacity: 0.7 }} />
          </button>
        )}
      </div>

      <div
        className="flex flex-wrap items-center pl-4 md:pl-[2.625rem]"
        style={{ gap: '0.375rem', paddingRight: '1rem', paddingBottom: '0.625rem' }}
      >
        {hasText ? (
          <>
            <Hint
              icon={<Users size={11} aria-hidden="true" />}
              label="Client"
              value={client ? client.name : 'None'}
              found={!!client}
            />
            <Hint
              icon={<Calendar size={11} aria-hidden="true" />}
              label="Due"
              value={dueLabel ?? 'No date'}
              found={!!parsed.dueDate}
            />
            <Hint
              icon={<Zap size={11} aria-hidden="true" />}
              label="Priority"
              value={parsed.priority ? taskPriorityLabel(parsed.priority) : 'Standard'}
              found={!!parsed.priority}
            />
            <Hint
              icon={<LevelIcon size={11} aria-hidden />}
              label="Level"
              value={TASK_LEVEL_LABELS[parsed.level] ?? parsed.level}
              found
            />
          </>
        ) : (
          <span style={{ fontSize: '0.71875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
            Try <Token>@{clients[0]?.name ?? 'Kowtow'}</Token>, <Token>tomorrow</Token>, <Token>friday</Token>,{' '}
            <Token>!high</Token>. The client, the date and the priority are read as you type.
          </span>
        )}
      </div>
    </div>
  )
}
