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

/**
 * The insert, with failures left to the caller.
 *
 * Almost every audit row is a nice-to-have beside a write that already
 * happened, which is why `logAudit` below swallows. Act as client is the
 * exception: there the row IS the safety story, so an acting write that lands
 * without its record must fail loudly rather than quietly. See
 * lib/acting-as.ts.
 */
export async function logAuditStrict(database: DB, entry: AuditEntry): Promise<void> {
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
}

export async function logAudit(database: DB, entry: AuditEntry): Promise<void> {
  try {
    await logAuditStrict(database, entry)
  } catch (err) {
    console.error('[audit] Failed to write audit log entry:', err)
  }
}

/**
 * The character the `ESCAPE` clause names on every audit prefix filter.
 *
 * A backslash, because SQLite string literals do NOT process backslash escapes:
 * `ESCAPE '\'` in the emitted SQL means exactly one backslash and needs no
 * doubling at the database.
 */
export const AUDIT_LIKE_ESCAPE = '\\'

/**
 * Make an audit `action` prefix safe to drop into a LIKE pattern.
 *
 * ESCAPE, NEVER STRIP. The first version of this deleted `%` and `_` from the
 * input, which silently rewrote the caller's question: `acting_as_client.`
 * became `actingasclient.`, the query ran `LIKE 'actingasclient.%'`, and the
 * entire Act as client trail read as empty through the one reader built for
 * it. `permission.` worked only because it happens to carry no underscore.
 *
 * Escaping is also the only correct direction. `_` matches any single
 * character and `%` matches any run, so leaving either raw would BROADEN a
 * filter that exists to narrow. The escape character is escaped first, or a
 * trailing backslash in the input would swallow the `%` this pattern appends.
 */
export function escapeAuditLikePrefix(prefix: string): string {
  return prefix.replace(/[\\%_]/g, (m) => AUDIT_LIKE_ESCAPE + m)
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
