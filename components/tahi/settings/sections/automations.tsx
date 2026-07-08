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
 * Backend gap: the execution engine that would actually fire these rules is not
 * wired yet, so executionCount stays at 0 until that lands. The management
 * surface here is complete regardless.
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

// Pull the first action's type out of the actions JSON, defensively.
function firstActionType(actions: string): string {
  try {
    const parsed = JSON.parse(actions) as unknown
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0]
      if (first && typeof first === 'object' && 'type' in first) {
        const t = (first as { type: unknown }).type
        if (typeof t === 'string') return t
      }
    }
  } catch {
    // fall through to default
  }
  return 'send_notification'
}

export function AutomationsSection(_props: { isAdmin?: boolean } = {}) {
  const [editId, setEditId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    try {
      const res = await fetch(apiPath(`/api/admin/automations/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${triggerLabel(trigger)} -> ${actionLabel(action)}`,
          triggerEvent: trigger,
          actions: [{ type: action }],
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
          <EmptyRow text="Loading rules..." />
        ) : rows.length === 0 ? (
          <EmptyRow text="No rules yet." />
        ) : (
          rows.map((r, i) => {
            const action = firstActionType(r.actions)
            return (
              <div
                key={r.id}
                className="lrow"
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
