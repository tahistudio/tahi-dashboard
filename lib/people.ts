/**
 * lib/people.ts — canonical person identity helpers.
 *
 * Any code path that creates a row tied to a human (lead, contact,
 * team member, affiliate, subscriber) should resolve the person
 * identity through `lookupOrCreatePerson` first. Email is the
 * matching key.
 *
 * One person, many roles. Same human across the whole CRM.
 */

import { schema } from '@/db/d1'
import { eq, sql } from 'drizzle-orm'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export interface PersonInput {
  fullName: string
  email?: string | null
  phone?: string | null
  avatarUrl?: string | null
  linkedinUrl?: string | null
}

/**
 * Return the canonical `people.id` for the given person info.
 *
 * - If `email` is set and matches an existing row, reuse it (and
 *   patch missing fields where the new input has them).
 * - Otherwise insert a new row.
 *
 * The matching is case-insensitive on email. People without an
 * email get a fresh row every time (we can't dedupe them safely).
 */
export async function lookupOrCreatePerson(
  database: DrizzleDB,
  input: PersonInput,
): Promise<string> {
  const cleanEmail = input.email?.trim().toLowerCase() || null

  if (cleanEmail) {
    const existing = await database
      .select({ id: schema.people.id, fullName: schema.people.fullName, phone: schema.people.phone })
      .from(schema.people)
      .where(sql`lower(${schema.people.email}) = ${cleanEmail}`)
      .limit(1)

    if (existing.length > 0) {
      const row = existing[0]
      // Backfill name/phone if the existing record is sparser than
      // what we now have. Don't overwrite truthy existing values.
      const patch: Record<string, string | null> = {}
      if (!row.fullName?.trim() && input.fullName) patch.fullName = input.fullName
      if (!row.phone && input.phone)               patch.phone = input.phone
      if (Object.keys(patch).length > 0) {
        await database
          .update(schema.people)
          .set({ ...patch, updatedAt: new Date().toISOString() })
          .where(eq(schema.people.id, row.id))
      }
      return row.id
    }
  }

  // Create a fresh person row.
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.people).values({
    id,
    fullName: input.fullName,
    email: cleanEmail,
    phone: input.phone ?? null,
    avatarUrl: input.avatarUrl ?? null,
    linkedinUrl: input.linkedinUrl ?? null,
    createdAt: now,
    updatedAt: now,
  })
  return id
}
