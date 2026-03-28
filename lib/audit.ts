/**
 * lib/audit.ts
 * Audit logging helper. Writes entries to the audit_log table.
 */
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'

interface AuditEntry {
  action: string
  userId: string
  userType?: string
  entityType: string
  entityId: string
  metadata?: Record<string, unknown>
  ipAddress?: string
}

export async function logAudit(database: DB, entry: AuditEntry): Promise<void> {
  try {
    await database.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorId: entry.userId,
      actorType: entry.userType ?? 'team_member',
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
      ipAddress: entry.ipAddress ?? null,
      createdAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[audit] Failed to write audit log entry:', err)
  }
}
