'use client'

/**
 * AutomationsSection - the trigger -> action rules that run when something
 * happens in the workspace. Each rule has an on/off switch and a lifetime runs
 * count.
 *
 * Data is real: it reads /api/admin/automations (GET), and writes through POST
 * (create), PATCH /[id] (edit + toggle) and DELETE /[id]. The trigger maps to
 * automationRules.triggerEvent, the action to the first entry of the actions
 * JSON array, the switch to enabled, and the runs count to executionCount.
 *
 * Execution is live: lib/events.ts emitDomainEvent fires lib/automation-executor
 * from the request / invoice / client routes, which bumps executionCount per
 * run. Time-based triggers (request_overdue, client_inactive) are swept by
 * POST /api/admin/crons/sweep on a schedule or via Run now in Scheduled jobs.
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useState } from 'react'
import { Plus, Zap } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  Toggle,
  EditDialog,
  RowActions,
  EmptyRow,
} from '@/components/tahi/settings/primitives'

interface AutomationRule {
  id: string
  name: string
  enabled: boolean
  triggerEvent: string
  conditions: string | null
  actions: string
  executionCount: number | null
  lastExecutedAt: string | null
}

interface RulesResponse {
  items: AutomationRule[]
}

// Trigger enum <-> human label. Enum values match the API's validTriggers.
const TRIGGERS: [string, string][] = [
  ['request_created', 'Request created'],
  ['request_status_changed', 'Request status changed'],
  ['request_overdue', 'Request overdue'],
  ['invoice_overdue', 'Invoice overdue'],
  ['client_inactive', 'Client inactive'],
  ['client_onboarded', 'Client onboarded'],
]

// Action type <-> human label. Stored as [{ type }] in the actions JSON array.
const ACTIONS: [string, string][] = [
  ['assign_pm', 'Assign to on-call PM'],
  ['change_status', 'Change status'],
  ['send_notification', 'Send notification'],
  ['send_email', 'Send email'],
  ['post_to_slack', 'Post to Slack'],
  ['create_kickoff_task', 'Create kickoff task'],
]

const TRIGGER_LABELS = TRIGGERS.map(([, l]) => l)
const ACTION_LABELS = ACTIONS.map(([, l]) => l)

function triggerLabel(value: string): string {
  return TRIGGERS.find(([v]) => v === value)?.[1] ?? value
}
function triggerValue(label: string): string {
  return TRIGGERS.find(([, l]) => l === label)?.[0] ?? 'request_created'
}
function actionLabel(value: string): string {
  return ACTIONS.find(([v]) => v === value)?.[1] ?? value
}
function actionValue(label: string): string {
  return ACTIONS.find(([, l]) => l === label)?.[0] ?? 'send_notification'
}

// Parse the actions JSON defensively into an array of action objects.
function parseActions(actions: string): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(actions) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (a): a is Record<string, unknown> => !!a && typeof a === 'object' && !Array.isArray(a),
      )
    }
  } catch {
    // fall through to empty
  }
  return []
}

// Pull the first action's type out of the actions JSON, defensively.
function firstActionType(actions: string): string {
  const first = parseActions(actions)[0]
  const t = first?.type
  return typeof t === 'string' ? t : 'send_notification'
}

export function AutomationsSection(_props: { isAdmin?: boolean } = {}) {
  const [editId, setEditId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The last rule created this session, so its row gets the insert animation.
  const [justAddedId, setJustAddedId] = useState<string | null>(null)

  const { data, isLoading, mutate } = useResource<RulesResponse>('/api/admin/automations')
  const rows = data?.items ?? []

  async function createRule() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/admin/automations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Request created -> Send notification',
          triggerEvent: 'request_created',
          actions: [{ type: 'send_notification' }],
          enabled: true,
        }),
      })
      if (!res.ok) throw new Error('Failed to create rule')
      const json = (await res.json()) as { id: string }
      setJustAddedId(json.id)
      await mutate()
      setEditId(json.id)
    } catch {
      await mutate()
    } finally {
      setBusy(false)
    }
  }

  async function saveRule(id: string, values: Record<string, string>) {
    const trigger = triggerValue(values.trigger ?? '')
    const action = actionValue(values.action ?? '')
    // Preserve any richer action params created elsewhere: keep the first
    // action's config when its type is unchanged, and keep trailing actions.
    const existing = rows.find(r => r.id === id)
    const prevActions = existing ? parseActions(existing.actions) : []
    const first =
      prevActions[0] && prevActions[0].type === action ? prevActions[0] : { type: action }
    const actions = [first, ...prevActions.slice(1)]
    try {
      const res = await fetch(apiPath(`/api/admin/automations/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${triggerLabel(trigger)} -> ${actionLabel(action)}`,
          triggerEvent: trigger,
          actions,
        }),
      })
      if (!res.ok) throw new Error('Failed to save rule')
    } finally {
      setEditId(null)
      await mutate()
    }
  }

  async function toggleRule(rule: AutomationRule) {
    // Optimistically flip the switch, then confirm with a revalidate.
    await mutate(
      current =>
        current
          ? {
              items: current.items.map(r =>
                r.id === rule.id ? { ...r, enabled: !r.enabled } : r,
              ),
            }
          : current,
      false,
    )
    try {
      const res = await fetch(apiPath(`/api/admin/automations/${rule.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      if (!res.ok) throw new Error('Failed to toggle rule')
    } finally {
      await mutate()
    }
  }

  async function deleteRule(id: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/automations/${id}`), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete rule')
    } finally {
      await mutate()
    }
  }

  const editing = editId ? rows.find(r => r.id === editId) : null

  return (
    <SectionShell
      title="Automations"
      lede="Rules that run when something happens."
      action={
        <button type="button" className="btn1" onClick={createRule} disabled={busy}>
          <Plus size={15} />
          New rule
        </button>
      }
    >
      <div className="set-card lrow-wrap">
        {isLoading ? (
          [0, 1, 2].map(i => (
            <div
              key={i}
              className="lrow"
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
              aria-hidden="true"
            >
              <span className="lrow-ic leaf" style={{ opacity: 0.4 }}>
                <Zap size={16} />
              </span>
              <div className="lrow-t">
                <span
                  className="animate-pulse"
                  style={{ display: 'block', height: 12, width: 200, borderRadius: 6, background: 'var(--border-subtle)' }}
                />
                <span
                  className="animate-pulse"
                  style={{ display: 'block', height: 9, width: 60, borderRadius: 6, background: 'var(--border-subtle)', marginTop: 7 }}
                />
              </div>
              <div className="lrow-r">
                <span
                  className="animate-pulse"
                  style={{ display: 'block', height: 20, width: 34, borderRadius: 999, background: 'var(--border-subtle)' }}
                />
              </div>
            </div>
          ))
        ) : rows.length === 0 ? (
          <EmptyRow text="No rules yet." />
        ) : (
          rows.map((r, i) => {
            const action = firstActionType(r.actions)
            return (
              <div
                key={r.id}
                className={'lrow' + (r.id === justAddedId ? ' lrow-enter' : '')}
                style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
              >
                <span className="lrow-ic leaf">
                  <Zap size={16} />
                </span>
                <div className="lrow-t">
                  <b>
                    {triggerLabel(r.triggerEvent)}{' '}
                    <span style={{ color: 'var(--text-faint)' }}>&rarr;</span>{' '}
                    {actionLabel(action)}
                  </b>
                  <small>{r.executionCount ?? 0} runs</small>
                </div>
                <div className="lrow-r">
                  <Toggle
                    on={r.enabled}
                    onClick={() => toggleRule(r)}
                    ariaLabel={r.enabled ? 'Disable rule' : 'Enable rule'}
                  />
                  <RowActions onEdit={() => setEditId(r.id)} onDelete={() => deleteRule(r.id)} />
                </div>
              </div>
            )
          })
        )}
      </div>

      {editId && editing && (
        <EditDialog
          heading="Edit rule"
          row={{
            trigger: triggerLabel(editing.triggerEvent),
            action: actionLabel(firstActionType(editing.actions)),
          }}
          fields={[
            { key: 'trigger', label: 'When', type: 'select', opts: TRIGGER_LABELS },
            { key: 'action', label: 'Do', type: 'select', opts: ACTION_LABELS },
          ]}
          onSave={v => saveRule(editId, v)}
          onClose={() => setEditId(null)}
        />
      )}
    </SectionShell>
  )
}
