import { getRequestAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { dispatchDomainEvent } from '@/lib/events'

type EventsDb = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export const dynamic = 'force-dynamic'

/**
 * POST /api/portal/provision
 *
 * Provision a self-serve client. A brand-new signup arrives with no Clerk
 * organization, so onboarding checkout (which scopes to the org) cannot run.
 * This ensures both halves exist:
 *   1. a Clerk organization the user is the admin of, and
 *   2. a linked D1 `organisations` row (clerk_org_id set) + primary contact +
 *      default kanban columns.
 *
 * Idempotent: if the user already has an org, or a D1 row already links to it,
 * the existing ids are returned with no duplicate created. Returns
 * { orgId (D1), clerkOrgId }. The client then calls Clerk `setActive` so the
 * session carries the org on the next request (checkout).
 *
 * Invited clients never hit this route: their org is pre-created by Tahi and
 * joined via an onboarding invite token.
 */
export async function POST(req: NextRequest) {
  const { userId, orgId: sessionOrgId } = await getRequestAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (sessionOrgId && tahiOrgId && sessionOrgId === tahiOrgId) {
    // Tahi staff never self-provision a client org.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string }
  const database = await db()
  const now = new Date().toISOString()
  const clerk = await clerkClient()

  // 1. Resolve the Clerk org: session -> existing membership -> create fresh.
  let clerkOrgId = sessionOrgId ?? null
  if (!clerkOrgId) {
    // Reuse an existing membership if the user already has an org (e.g. a retry
    // after setActive failed), so we never spawn a duplicate Clerk org.
    try {
      const memberships = await clerk.users.getOrganizationMembershipList({ userId })
      clerkOrgId = memberships.data?.[0]?.organization?.id ?? null
    } catch {
      // ignore: fall through to creation
    }
  }

  let orgName = (body.name ?? '').trim()
  if (!clerkOrgId) {
    if (!orgName) {
      try {
        const user = await clerk.users.getUser(userId)
        const first = (user.firstName ?? '').trim()
        orgName = first ? `${first}'s workspace` : 'My workspace'
      } catch {
        orgName = 'My workspace'
      }
    }
    const created = await clerk.organizations.createOrganization({ name: orgName, createdBy: userId })
    clerkOrgId = created.id
  }

  // 2. Find or create the linked D1 org row.
  const [existing] = await database
    .select({ id: schema.organisations.id })
    .from(schema.organisations)
    .where(eq(schema.organisations.clerkOrgId, clerkOrgId))
    .limit(1)

  if (existing) {
    return NextResponse.json({ orgId: existing.id, clerkOrgId })
  }

  if (!orgName) {
    // A Clerk org already existed but had no D1 link: name from the Clerk org.
    try {
      const org = await clerk.organizations.getOrganization({ organizationId: clerkOrgId })
      orgName = org.name
    } catch {
      orgName = 'My workspace'
    }
  }

  const id = crypto.randomUUID()
  await database.insert(schema.organisations).values({
    id,
    clerkOrgId,
    name: orgName,
    status: 'active',
    healthStatus: 'green',
    planType: 'none',
    preferredCurrency: 'USD',
    createdAt: now,
    updatedAt: now,
  })

  // Primary contact = the signed-in user.
  try {
    const user = await clerk.users.getUser(userId)
    const email = user.emailAddresses[0]?.emailAddress
    const name = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || (email ? email.split('@')[0] : 'Primary contact')
    if (email) {
      await database.insert(schema.contacts).values({
        id: crypto.randomUUID(),
        orgId: id,
        name,
        email: email.toLowerCase(),
        clerkUserId: userId,
        isPrimary: true,
        createdAt: now,
        updatedAt: now,
      })
    }
  } catch {
    // non-fatal: contact can be backfilled later
  }

  // Seed default kanban columns (mirrors admin client creation).
  const defaultColumns = [
    { label: 'Submitted', statusValue: 'submitted', position: 0 },
    { label: 'In Review', statusValue: 'in_review', position: 1 },
    { label: 'In Progress', statusValue: 'in_progress', position: 2 },
    { label: 'Client Review', statusValue: 'client_review', position: 3 },
    { label: 'Delivered', statusValue: 'delivered', position: 4 },
    { label: 'Archived', statusValue: 'archived', position: 5 },
  ]
  for (const col of defaultColumns) {
    await database.insert(schema.kanbanColumns).values({
      id: crypto.randomUUID(),
      orgId: id,
      label: col.label,
      statusValue: col.statusValue,
      position: col.position,
      isDefault: 1,
      createdAt: now,
      updatedAt: now,
    })
  }

  // Fire the domain event (automations + outgoing webhooks). Non-blocking.
  await dispatchDomainEvent(database as EventsDb, {
    type: 'client_onboarded',
    entityId: id,
    entityType: 'organisation',
    orgId: id,
    data: {
      name: orgName,
      planType: 'none',
      source: 'self_serve',
    },
  })

  return NextResponse.json({ orgId: id, clerkOrgId })
}
