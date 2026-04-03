import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'


// Types for automation rules
interface AutomationCondition {
  field: string
  operator: 'equals' | 'not_equals' | 'contains'
  value: string
}

interface AutomationAction {
  type: 'send_email' | 'send_slack' | 'create_task' | 'update_status'
  config: Record<string, string>
}

interface EventPayload {
  event: string
  entityId?: string
  entityType?: string
  data?: Record<string, unknown>
}

type Database = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Fires all enabled automation rules matching the given event.
 * Call this from API routes after relevant events (request created, status changed, etc).
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

      // Execute actions
      const actions = JSON.parse(rule.actions) as AutomationAction[]
      const executedActions: string[] = []

      for (const action of actions) {
        switch (action.type) {
          case 'update_status':
            if (payload.entityType === 'request' && payload.entityId && action.config.status) {
              await database
                .update(schema.requests)
                .set({ status: action.config.status, updatedAt: now })
                .where(eq(schema.requests.id, payload.entityId))
              executedActions.push(`Updated status to ${action.config.status}`)
            }
            break

          case 'create_task':
            if (action.config.title) {
              await database.insert(schema.tasks).values({
                id: crypto.randomUUID(),
                type: 'tahi_internal',
                title: action.config.title,
                status: 'todo',
                priority: 'standard',
                createdAt: now,
                updatedAt: now,
              })
              executedActions.push(`Created task: ${action.config.title}`)
            }
            break

          case 'send_email':
            // Stub: would integrate with Resend
            executedActions.push('Email notification queued (stub)')
            break

          case 'send_slack':
            // Stub: would integrate with Slack API
            executedActions.push('Slack message queued (stub)')
            break
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
