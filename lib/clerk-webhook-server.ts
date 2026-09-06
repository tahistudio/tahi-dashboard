/**
 * lib/clerk-webhook-server.ts - D1 wiring for lib/clerk-webhook.ts.
 *
 * Kept apart from the decision core so that core stays importable from a plain
 * node test environment, the same split as lib/team-link.ts /
 * lib/team-link-server.ts.
 *
 * THE REPLAY LEDGER IS THE AUDIT TABLE. `audit_log` already has an index on
 * (entity_type, entity_id), so `entityType: 'clerk_webhook', entityId: <svix
 * id>` is an indexed existence check and a permanent operator trail in one row,
 * with no new table and no unbounded settings keys. Every mutation writes its
 * own row beside it, so "what did this delivery change" is answerable.
 *
 * NOTHING HERE SENDS EMAIL. Not a Resend call, not a Clerk invitation. A
 * contact row appearing because a client added a colleague to their own Clerk
 * organisation must stay silent (the founder's hard rule: no real person
 * receives mail from this system yet).
 */

import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { logAudit } from '@/lib/audit'
import {
  handleClerkWebhookEvent,
  type ClerkWebhookDeps,
  type ClerkWebhookEnvelope,
  type ClerkWebhookResult,
} from '@/lib/clerk-webhook'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** entity_type used for the svix-id ledger rows in audit_log. */
export const CLERK_WEBHOOK_ENTITY = 'clerk_webhook'
/** action written once per applied delivery. Doubles as the replay marker. */
export const CLERK_WEBHOOK_DELIVERY_ACTION = 'clerk_webhook.delivered'

/**
 * Resolve a Clerk organisation id to its D1 row, with the same back-compat
 * fallback getPortalAuth uses: an org provisioned before the `clerkOrgId`
 * column existed may carry the Clerk id AS its primary key.
 */
async function findOrg(drizzle: Drizzle, clerkOrgId: string): Promise<{ id: string } | null> {
  const [linked] = await drizzle
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.clerkOrgId, clerkOrgId))
    .limit(1)
  if (linked) return { id: linked.id }

  const [legacy] = await drizzle
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, clerkOrgId))
    .limit(1)
  return legacy ? { id: legacy.id } : null
}

export function buildClerkWebhookDeps(drizzle: Drizzle): ClerkWebhookDeps {
  const database = drizzle as unknown as DB

  return {
    wasDelivered: async (svixId) => {
      const [row] = await drizzle
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(and(
          eq(schema.auditLog.entityType, CLERK_WEBHOOK_ENTITY),
          eq(schema.auditLog.entityId, svixId),
        ))
        .limit(1)
      return !!row
    },

    recordDelivery: async (svixId, eventType, actions) => {
      await logAudit(database, {
        action: CLERK_WEBHOOK_DELIVERY_ACTION,
        userId: null,
        userType: 'system',
        entityType: CLERK_WEBHOOK_ENTITY,
        entityId: svixId,
        // The action list, not just a count: this row is what an operator reads
        // when asked "did that teammate get linked, and to which row".
        metadata: { eventType, actions },
      })
    },

    findContactByClerkUser: async (clerkUserId) => {
      const [row] = await drizzle
        .select({
          id: schema.contacts.id,
          orgId: schema.contacts.orgId,
          email: schema.contacts.email,
          clerkUserId: schema.contacts.clerkUserId,
        })
        .from(schema.contacts)
        .where(eq(schema.contacts.clerkUserId, clerkUserId))
        .limit(1)
      return row ?? null
    },

    // lower() on both sides: contact emails are hand-entered by the studio and
    // by clients inviting colleagues, so casing will not always agree.
    findContactsByEmail: async (emailLower) => {
      return drizzle
        .select({
          id: schema.contacts.id,
          orgId: schema.contacts.orgId,
          email: schema.contacts.email,
          clerkUserId: schema.contacts.clerkUserId,
        })
        .from(schema.contacts)
        .where(sql`lower(${schema.contacts.email}) = ${emailLower}`)
    },

    findContactsByOrgAndEmail: async (orgId, emailLower) => {
      return drizzle
        .select({
          id: schema.contacts.id,
          orgId: schema.contacts.orgId,
          email: schema.contacts.email,
          clerkUserId: schema.contacts.clerkUserId,
        })
        .from(schema.contacts)
        .where(and(
          eq(schema.contacts.orgId, orgId),
          sql`lower(${schema.contacts.email}) = ${emailLower}`,
        ))
    },

    // Compare-and-set on NULL: two deliveries racing cannot both win, and an
    // existing link can never be overwritten whatever the caller decided.
    linkContact: async (contactId, clerkUserId) => {
      const claimed = await drizzle
        .update(schema.contacts)
        .set({ clerkUserId, updatedAt: new Date().toISOString() })
        .where(and(
          eq(schema.contacts.id, contactId),
          isNull(schema.contacts.clerkUserId),
        ))
        .returning({ id: schema.contacts.id })
      return claimed.length > 0
    },

    // Compare-and-set on the CURRENT id, so a concurrent re-link is not clobbered.
    unlinkContact: async (contactId, clerkUserId) => {
      const cleared = await drizzle
        .update(schema.contacts)
        .set({ clerkUserId: null, updatedAt: new Date().toISOString() })
        .where(and(
          eq(schema.contacts.id, contactId),
          eq(schema.contacts.clerkUserId, clerkUserId),
        ))
        .returning({ id: schema.contacts.id })
      return cleared.length > 0
    },

    createContact: async (input) => {
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      await drizzle.insert(schema.contacts).values({
        id,
        orgId: input.orgId,
        name: input.name,
        email: input.email,
        clerkUserId: input.clerkUserId,
        isPrimary: false,
        // Deny by default: a colleague is a member until someone promotes them.
        // Same shape POST /api/portal/invites writes.
        portalRole: 'member',
        createdAt: now,
        updatedAt: now,
      })
      return id
    },

    findTeamMemberByClerkUser: async (clerkUserId) => {
      const [row] = await drizzle
        .select({
          id: schema.teamMembers.id,
          email: schema.teamMembers.email,
          clerkUserId: schema.teamMembers.clerkUserId,
        })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.clerkUserId, clerkUserId))
        .limit(1)
      return row ?? null
    },

    findTeamMembersByEmail: async (emailLower) => {
      return drizzle
        .select({
          id: schema.teamMembers.id,
          email: schema.teamMembers.email,
          clerkUserId: schema.teamMembers.clerkUserId,
        })
        .from(schema.teamMembers)
        .where(sql`lower(${schema.teamMembers.email}) = ${emailLower}`)
    },

    linkTeamMember: async (teamMemberId, clerkUserId) => {
      const claimed = await drizzle
        .update(schema.teamMembers)
        .set({ clerkUserId, updatedAt: new Date().toISOString() })
        .where(and(
          eq(schema.teamMembers.id, teamMemberId),
          isNull(schema.teamMembers.clerkUserId),
        ))
        .returning({ id: schema.teamMembers.id })
      return claimed.length > 0
    },

    findOrgByClerkOrgId: (clerkOrgId) => findOrg(drizzle, clerkOrgId),

    audit: async (entry) => {
      await logAudit(database, {
        action: entry.action,
        userId: null,
        userType: 'system',
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
      })
    },

    tahiClerkOrgId: process.env.NEXT_PUBLIC_TAHI_ORG_ID,
  }
}

/** Apply one already-verified delivery against D1. */
export async function processClerkWebhook(
  svixId: string,
  envelope: ClerkWebhookEnvelope,
): Promise<ClerkWebhookResult> {
  const drizzle = (await db()) as unknown as Drizzle
  return handleClerkWebhookEvent(buildClerkWebhookDeps(drizzle), { svixId, envelope })
}
