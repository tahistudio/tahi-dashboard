import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'
import { notifyAllAdmins, notifyOrgContacts } from '@/lib/notifications'
import type { NotificationEventType, NotificationEntityType } from '@/lib/notification-links'

// Types for automation rules
interface AutomationCondition {
  field: string
  operator: 'equals' | 'not_equals' | 'contains'
  value: string
}

interface AutomationAction {
  // Vocabulary used by the settings > automations UI, plus the legacy names
  // the first version of this executor shipped with. Both are handled.
  type:
    | 'assign_pm' | 'assign'
    | 'change_status' | 'update_status'
    | 'send_notification'
    | 'create_kickoff_task' | 'create_task'
    | 'send_email' | 'post_to_slack' | 'send_slack'
    | 'delete' | string
  config?: Record<string, string>
}

interface EventPayload {
  event: string
  entityId?: string
  entityType?: string
  orgId?: string | null
  data?: Record<string, unknown>
}

type Database = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// Actions that would complete an irreversible external action end-to-end (send
// an external email / chat message) or destroy data. Human-in-the-loop rule:
// automations never do these. They are logged as skipped_unsafe so the audit
// trail shows the rule matched but the side effect was withheld.
const UNSAFE_ACTIONS = new Set(['send_email', 'post_to_slack', 'send_slack', 'delete'])

// Map a domain event to the closest NotificationEventType (used for the bell's
// per-event mute preferences + icon). Deep-linking uses entityType/entityId, so
// an imperfect type here only affects filtering, never correctness.
const EVENT_TO_NOTIF_TYPE: Record<string, NotificationEventType> = {
  request_created: 'request_created',
  request_status_changed: 'request_status_changed',
  request_overdue: 'request_status_changed',
  invoice_created: 'invoice_created',
  invoice_paid: 'invoice_paid',
  invoice_overdue: 'invoice_overdue',
}

const KNOWN_ENTITY_TYPES = new Set<NotificationEntityType>([
  'request', 'task', 'message', 'invoice', 'organisation', 'contract',
  'proposal', 'call', 'deal', 'lead', 'schedule', 'announcement', 'subscription',
])

function asEntityType(value: string | undefined): NotificationEntityType | null {
  if (value && KNOWN_ENTITY_TYPES.has(value as NotificationEntityType)) {
    return value as NotificationEntityType
  }
  return null
}

/**
 * Fires all enabled automation rules matching the given event.
 * Called by lib/events.ts emitDomainEvent after relevant events (request
 * created, status changed, invoice paid, client onboarded, etc).
 *
 * Actions are human-safe: only assign, change status, create an in-app
 * notification, and create a task actually run. External sends (email / Slack)
 * and deletes are recorded as skipped_unsafe and withheld for a human.
 */
export async function fireAutomation(
  database: Database,
  payload: EventPayload
): Promise<{ fired: number; errors: number }> {
  let fired = 0
  let errors = 0

  // Get all enabled rules matching this trigger event
  const rules = await database
    .select()
    .from(schema.automationRules)
    .where(
      and(
        eq(schema.automationRules.enabled, true),
        eq(schema.automationRules.triggerEvent, payload.event)
      )
    )

  const now = new Date().toISOString()

  for (const rule of rules) {
    try {
      // Check conditions
      const conditions = JSON.parse(rule.conditions ?? '[]') as AutomationCondition[]
      const conditionsMet = conditions.every(cond => {
        const fieldValue = String(payload.data?.[cond.field] ?? '')
        switch (cond.operator) {
          case 'equals': return fieldValue === cond.value
          case 'not_equals': return fieldValue !== cond.value
          case 'contains': return fieldValue.includes(cond.value)
          default: return true
        }
      })

      if (!conditionsMet) continue

      // Execute actions (human-safe subset only)
      const actions = JSON.parse(rule.actions) as AutomationAction[]
      const executedActions: string[] = []

      for (const action of actions) {
        const config = action.config ?? {}

        if (UNSAFE_ACTIONS.has(action.type)) {
          // Human-in-the-loop: withhold external sends / deletes.
          executedActions.push(`skipped_unsafe: ${action.type} (requires human approval)`)
          continue
        }

        switch (action.type) {
          case 'change_status':
          case 'update_status': {
            const status = config.status
            if (payload.entityType === 'request' && payload.entityId && status) {
              await database
                .update(schema.requests)
                .set({ status, updatedAt: now })
                .where(eq(schema.requests.id, payload.entityId))
              executedActions.push(`change_status -> ${status}`)
            } else {
              executedActions.push('change_status skipped (no target status / not a request)')
            }
            break
          }

          case 'assign':
          case 'assign_pm': {
            const assigneeId = config.assigneeId ?? config.teamMemberId ?? config.pmId
            if (payload.entityType === 'request' && payload.entityId && assigneeId) {
              await database
                .update(schema.requests)
                .set({ assigneeId, updatedAt: now })
                .where(eq(schema.requests.id, payload.entityId))
              executedActions.push(`assign -> ${assigneeId}`)
            } else {
              executedActions.push('assign skipped (no assignee configured)')
            }
            break
          }

          case 'send_notification': {
            const notifType = EVENT_TO_NOTIF_TYPE[payload.event] ?? 'request_status_changed'
            const entityType = asEntityType(payload.entityType)
            const title = config.title ?? `Automation: ${rule.name}`
            const notifPayload = {
              type: notifType,
              title,
              body: config.body ?? null,
              entityType,
              entityId: entityType ? (payload.entityId ?? null) : null,
            }
            // Default audience is the internal team. A rule can opt into
            // notifying the client org's contacts (still an in-app bell row,
            // never an external send) when the event carries an orgId.
            if (config.audience === 'client' && payload.orgId) {
              await notifyOrgContacts(database, payload.orgId, notifPayload)
              executedActions.push('send_notification -> client contacts')
            } else {
              await notifyAllAdmins(database, notifPayload)
              executedActions.push('send_notification -> team')
            }
            break
          }

          case 'create_kickoff_task':
          case 'create_task': {
            const title = config.title ?? `Follow up: ${rule.name}`
            await database.insert(schema.tasks).values({
              id: crypto.randomUUID(),
              type: 'tahi_internal',
              title,
              status: 'todo',
              priority: 'standard',
              createdAt: now,
              updatedAt: now,
            })
            executedActions.push(`create_task: ${title}`)
            break
          }

          default:
            executedActions.push(`skipped_unknown: ${action.type}`)
        }
      }

      // Log execution
      await database.insert(schema.automationLog).values({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        triggerEvent: payload.event,
        entityId: payload.entityId ?? null,
        actionsExecuted: JSON.stringify(executedActions),
        status: 'success',
        executedAt: now,
      })

      // Update rule execution count
      await database
        .update(schema.automationRules)
        .set({
          executionCount: (rule.executionCount ?? 0) + 1,
          lastExecutedAt: now,
        })
        .where(eq(schema.automationRules.id, rule.id))

      fired++
    } catch (err) {
      errors++
      // Log error
      await database.insert(schema.automationLog).values({
        id: crypto.randomUUID(),
        ruleId: rule.id,
        triggerEvent: payload.event,
        entityId: payload.entityId ?? null,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
        executedAt: now,
      })
    }
  }

  return { fired, errors }
}
