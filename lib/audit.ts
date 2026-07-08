/**
 * lib/audit.ts
 * Audit logging helper. Writes entries to the audit_log table.
 */
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'

type AuditActorType = 'team_member' | 'contact' | 'system'

interface AuditEntry {
  action: string
  // All actor / entity fields are optional to match the nullable audit_log
  // schema. Omit userId (or pass null) for system-sourced events, and omit
  // entityType / entityId for events with no target (e.g. login / logout).
  userId?: string | null
  userType?: AuditActorType
  entityType?: string | null
  entityId?: string | null
  metadata?: Record<string, unknown>
  ipAddress?: string | null
}

export async function logAudit(database: DB, entry: AuditEntry): Promise<void> {
  try {
    await database.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorId: entry.userId ?? null,
      actorType: entry.userType ?? 'team_member',
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      ipAddress: entry.ipAddress ?? null,
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[audit] Failed to write audit log entry:', err)
  }
}

/**
 * Record a system-sourced audit entry (no human actor). Thin wrapper over
 * logAudit that stamps actorId: null, actorType: 'system' so cron jobs,
 * webhooks, and background emailers don't have to hand-roll the insert.
 */
export async function logSystemAudit(
  database: DB,
  entry: {
    action: string
    entityType?: string | null
    entityId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await logAudit(database, {
    action: entry.action,
    userId: null,
    userType: 'system',
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata,
  })
}
