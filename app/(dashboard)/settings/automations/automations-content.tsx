'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Zap, Plus, Trash2, RefreshCw, ToggleLeft, ToggleRight,
  ArrowLeft, ChevronDown,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { apiPath } from '@/lib/api'
import Link from 'next/link'

// -- Types --

interface AutomationRule {
  id: string
  name: string
  enabled: boolean | number
  triggerEvent: string
  conditions: string
  actions: string
  executionCount: number
  lastExecutedAt: string | null
  createdAt: string
}

interface ActionDef {
  type: string
  config: Record<string, string>
}

const TRIGGER_OPTIONS = [
  { value: 'request_created', label: 'Request Created' },
  { value: 'request_status_changed', label: 'Request Status Changed' },
  { value: 'request_overdue', label: 'Request Overdue' },
  { value: 'invoice_overdue', label: 'Invoice Overdue' },
  { value: 'client_inactive', label: 'Client Inactive' },
  { value: 'client_onboarded', label: 'Client Onboarded' },
]

const ACTION_OPTIONS = [
  { value: 'assign_request', label: 'Assign Request' },
  { value: 'change_status', label: 'Change Status' },
  { value: 'send_notification', label: 'Send Notification' },
  { value: 'send_email', label: 'Send Email' },
  { value: 'post_slack', label: 'Post to Slack' },
  { value: 'create_task', label: 'Create Internal Task' },
]

// -- Main Component --

export function AutomationsContent() {
  const [rules, setRules] = useState<AutomationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  const fetchRules = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/automations'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { items: AutomationRule[] }
      setRules(data.items ?? [])
    } catch {
      setRules([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRules() }, [fetchRules])

  async function toggleRule(id: string, enabled: boolean) {
    try {
      await fetch(apiPath(`/api/admin/automations/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      setRules(prev => prev.map(r => r.id === id ? { ...r, enabled } : r))
    } catch {
      // Failed
    }
  }

  async function deleteRule(id: string) {
    try {
      await fetch(apiPath(`/api/admin/automations/${id}`), { method: 'DELETE' })
      setRules(prev => prev.filter(r => r.id !== id))
    } catch {
      // Failed
    }
  }

  function getTriggerLabel(value: string): string {
    return TRIGGER_OPTIONS.find(t => t.value === value)?.label ?? value
  }

  function parseActions(actionsJson: string): ActionDef[] {
    try {
      const parsed = JSON.parse(actionsJson) as ActionDef[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  function getActionLabel(type: string): string {
    return ACTION_OPTIONS.find(a => a.value === type)?.label ?? type
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/settings"
            className="p-2 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors"
            aria-label="Back to settings"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">Automations</h1>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Create rules to automate actions based on events.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <TahiButton variant="secondary" size="sm" onClick={fetchRules} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
            Refresh
          </TahiButton>
          <TahiButton size="sm" onClick={() => setShowCreate(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
            Create Rule
          </TahiButton>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <CreateRuleForm
          onCreated={() => {
            setShowCreate(false)
            fetchRules()
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Rules list */}
      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Zap className="w-8 h-8 text-white" />}
          title="No automation rules"
          description="Create rules to automatically respond to events like new requests, status changes, and overdue invoices."
          action={
            <TahiButton size="sm" onClick={() => setShowCreate(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
              Create Rule
            </TahiButton>
          }
        />
      ) : (
        <div className="space-y-3">
          {rules.map(rule => {
            const isEnabled = rule.enabled === true || rule.enabled === 1
            const actions = parseActions(rule.actions)

            return (
              <div
                key={rule.id}
                className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-semibold text-[var(--color-text)]">{rule.name}</h3>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: isEnabled ? 'var(--color-success-bg)' : 'var(--color-bg-tertiary)',
                          color: isEnabled ? 'var(--color-brand)' : 'var(--color-text-muted)',
                        }}
                      >
                        {isEnabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-bg-secondary)]">
                        <Zap className="w-3 h-3" />
                        {getTriggerLabel(rule.triggerEvent)}
                      </span>
                      {actions.map((action, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-bg-tertiary)]">
                          {getActionLabel(action.type)}
                        </span>
                      ))}
                    </div>

                    {rule.executionCount > 0 && (
                      <p className="text-xs text-[var(--color-text-subtle)] mt-2">
                        Executed {rule.executionCount} time{rule.executionCount !== 1 ? 's' : ''}
                        {rule.lastExecutedAt && ` (last: ${new Date(rule.lastExecutedAt).toLocaleDateString()})`}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => toggleRule(rule.id, !isEnabled)}
                      className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                      aria-label={isEnabled ? 'Disable rule' : 'Enable rule'}
                    >
                      {isEnabled
                        ? <ToggleRight className="w-5 h-5 text-[var(--color-brand)]" />
                        : <ToggleLeft className="w-5 h-5" />
                      }
                    </button>
                    <button
                      onClick={() => deleteRule(rule.id)}
                      className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                      aria-label="Delete rule"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// -- Create Rule Form --

function CreateRuleForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [triggerEvent, setTriggerEvent] = useState('request_created')
  const [actions, setActions] = useState<ActionDef[]>([{ type: 'send_notification', config: {} }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function addAction() {
    setActions([...actions, { type: 'send_notification', config: {} }])
  }

  function updateAction(idx: number, type: string) {
    setActions(actions.map((a, i) => i === idx ? { ...a, type } : a))
  }

  function removeAction(idx: number) {
    if (actions.length <= 1) return
    setActions(actions.filter((_, i) => i !== idx))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('Name is required')
      return
    }

    if (actions.length === 0) {
      setError('At least one action is required')
      return
    }

    setSaving(true)
    try {
      const res = await fetch(apiPath('/api/admin/automations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          triggerEvent,
          actions,
          conditions: [],
          enabled: true,
        }),
      })

      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Failed to create rule')
        return
      }

      onCreated()
    } catch {
      setError('Failed to create rule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-6 space-y-4"
    >
      <h2 className="text-base font-semibold text-[var(--color-text)]">Create Automation Rule</h2>

      {error && (
        <div className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg)] rounded-lg px-4 py-2" role="alert">
          {error}
        </div>
      )}

      {/* Name */}
      <div>
        <label htmlFor="rule-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">
          Rule Name
        </label>
        <input
          id="rule-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Notify team on new request"
          className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
        />
      </div>

      {/* Trigger */}
      <div>
        <label htmlFor="rule-trigger" className="block text-sm font-medium text-[var(--color-text)] mb-1">
          Trigger Event
        </label>
        <div className="relative">
          <select
            id="rule-trigger"
            value={triggerEvent}
            onChange={e => setTriggerEvent(e.target.value)}
            className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 pr-8 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] appearance-none"
          >
            {TRIGGER_OPTIONS.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-subtle)] pointer-events-none" />
        </div>
      </div>

      {/* Actions */}
      <div>
        <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
          Actions
        </label>
        <div className="space-y-2">
          {actions.map((action, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <div className="relative flex-1">
                <select
                  value={action.type}
                  onChange={e => updateAction(idx, e.target.value)}
                  className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 pr-8 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] appearance-none"
                  aria-label={`Action ${idx + 1} type`}
                >
                  {ACTION_OPTIONS.map(a => (
                    <option key={a.value} value={a.value}>{a.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-subtle)] pointer-events-none" />
              </div>
              {actions.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeAction(idx)}
                  className="p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                  aria-label="Remove action"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addAction}
            className="flex items-center gap-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Action
          </button>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex justify-end gap-2 pt-2">
        <TahiButton type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </TahiButton>
        <TahiButton type="submit" size="sm" disabled={saving || !name.trim()}>
          {saving ? 'Creating...' : 'Create Rule'}
        </TahiButton>
      </div>
    </form>
  )
}
