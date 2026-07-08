/**
 * lib/events.ts - the domain event bus.
 *
 * A single entry point, emitDomainEvent, that every real event point in the app
 * calls after a primary action succeeds. It fans the event out to the two
 * previously-dead engines:
 *
 *   (a) automation rules  - via fireAutomation (writes automationLog, bumps
 *       automationRules.executionCount). Actions are human-safe (assign,
 *       change status, in-app notification, create task); external sends and
 *       deletes are withheld and logged as skipped_unsafe.
 *   (b) outgoing webhooks - via fireWebhook (POSTs to registered endpoints with
 *       an HMAC signature, and writes one webhook_deliveries row per attempt).
 *
 * Contract: emitDomainEvent is strictly fire-and-forget. It never throws and
 * never returns a rejected promise, so a caller can `void emitDomainEvent(...)`
 * (or await it) without any risk of failing or blocking the primary action.
 */

import { fireAutomation } from '@/lib/automation-executor'
import { fireWebhook } from '@/lib/webhooks'

type Database = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// The vocabulary. Request / invoice / client lifecycle. The first six values
// line up with the trigger enum in components/tahi/settings/sections/automations.tsx
// so a rule the admin builds there actually matches an emitted event.
export type DomainEventType =
  | 'request_created'
  | 'request_status_changed'
  | 'request_overdue'
  | 'invoice_created'
  | 'invoice_paid'
  | 'invoice_overdue'
  | 'client_onboarded'
  | 'client_inactive'

export interface DomainEvent {
  type: DomainEventType
  /** Primary entity id (request id, invoice id, org id, ...). */
  entityId?: string
  /** Entity kind, used for automation targeting + notification deep links. */
  entityType?: 'request' | 'invoice' | 'organisation'
  /** Owning client org, when known - lets rules notify client contacts. */
  orgId?: string | null
  /** Free-form fields matched by automation-rule conditions + sent to webhooks. */
  data?: Record<string, unknown>
}

/**
 * Emit a domain event. Best-effort, never throws.
 *
 * @param database a live Drizzle D1 handle from the calling route (`db()`).
 * @param event    the event to broadcast.
 */
export async function emitDomainEvent(
  database: Database,
  event: DomainEvent,
): Promise<void> {
  // (a) Automation rules. Isolated so a rule failure can't stop webhooks.
  try {
    await fireAutomation(database, {
      event: event.type,
      entityId: event.entityId,
      entityType: event.entityType,
      orgId: event.orgId ?? null,
      data: event.data ?? {},
    })
  } catch (err) {
    console.error(`[emitDomainEvent] automation dispatch failed for ${event.type}:`, err)
  }

  // (b) Outgoing webhooks. Per-delivery rows are written by fireWebhook.
  try {
    await fireWebhook(
      event.type,
      {
        entityId: event.entityId ?? null,
        entityType: event.entityType ?? null,
        orgId: event.orgId ?? null,
        ...(event.data ?? {}),
      },
      database,
    )
  } catch (err) {
    console.error(`[emitDomainEvent] webhook dispatch failed for ${event.type}:`, err)
  }
}

/**
 * Fire-and-forget wrapper around emitDomainEvent for use inside route handlers.
 *
 * Hands the fan-out to Cloudflare's `ctx.waitUntil` so the worker keeps the
 * event loop alive after the HTTP response is sent, without the caller ever
 * awaiting (and so without adding webhook-fetch latency to the primary action).
 * Falls back to a detached promise in local dev where no execution context
 * exists. Never throws.
 *
 * Usage at a call site (after the primary write succeeds):
 *   await dispatchDomainEvent(drizzle, { type: 'request_created', ... })
 */
export async function dispatchDomainEvent(
  database: Database,
  event: DomainEvent,
): Promise<void> {
  try {
    const work = emitDomainEvent(database, event)
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const cfCtx = await getCloudflareContext({ async: true })
    if (cfCtx?.ctx?.waitUntil) {
      cfCtx.ctx.waitUntil(work)
    } else {
      void work
    }
  } catch (err) {
    // Setup failure (e.g. no context) must never block the primary action.
    console.error(`[dispatchDomainEvent] setup failed for ${event.type}:`, err)
  }
}
