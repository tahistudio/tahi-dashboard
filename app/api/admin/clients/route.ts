import { createElement } from 'react'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, like, or, and, ne, inArray, sql } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { requireFeature } from '@/lib/require-feature'
import { dispatchDomainEvent } from '@/lib/events'
import { INTERNAL_ORG_STATUS } from '@/lib/internal-org'
import { createInvite, personaForPlanType } from '@/lib/onboarding-invites'
import { sendEmail } from '@/lib/email'
import { ClientInviteEmail } from '@/emails/client-invite'

// ── GET /api/admin/clients ──────────────────────────────────────────────────
// Query params: ?status=active&plan=maintain&search=acme&page=1
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? 'all'
  const plan   = url.searchParams.get('plan')   ?? 'all'
  const search = url.searchParams.get('search') ?? ''
  const page   = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit  = 50
  const offset = (page - 1) * limit

  const database = await db()

  // Apply team member access scoping
  const scopedOrgIds = await resolveAccessScoping(database, userId)

  // Build conditions
  const conditions = []

  // Exclude the admin org (Tahi Studio) from the clients list
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  if (tahiOrgId) {
    conditions.push(ne(schema.organisations.id, tahiOrgId))
  }

  // If scoping returned a specific set of org IDs, filter to those
  if (scopedOrgIds !== null) {
    if (scopedOrgIds.length === 0) {
      return NextResponse.json({ organisations: [], page, limit })
    }
    conditions.push(inArray(schema.organisations.id, scopedOrgIds))
  }
  if (status !== 'all') conditions.push(eq(schema.organisations.status, status))
  if (plan   !== 'all') conditions.push(eq(schema.organisations.planType, plan))
  if (search) {
    conditions.push(
      or(
        like(schema.organisations.name, `%${search}%`),
        like(schema.organisations.website, `%${search}%`)
      )!
    )
  }
  // Never return archived by default unless explicitly asked
  if (status !== 'archived') {
    conditions.push(ne(schema.organisations.status, 'archived'))
  }

  // Prospects belong to the pipeline / CRM surface, not the clients list.
  // Excluded by default; pass ?includeProspects=1 if you really need them
  // (e.g. for a Companies super-list view).
  const includeProspects = url.searchParams.get('includeProspects') === '1'
  if (!includeProspects && status !== 'prospect') {
    conditions.push(ne(schema.organisations.status, 'prospect'))
  }

  // The internal studio org exists only so general time has somewhere to
  // log. Never a client; excluded unless explicitly requested.
  if (status !== INTERNAL_ORG_STATUS) {
    conditions.push(ne(schema.organisations.status, INTERNAL_ORG_STATUS))
  }

  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const orgs = await drizzle
    .select()
    .from(schema.organisations)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.organisations.createdAt))
    .limit(limit)
    .offset(offset)

  // Count open requests per org (status not delivered/archived/cancelled)
  const orgIds = orgs.map(o => o.id)
  const requestCounts: Record<string, number> = {}
  if (orgIds.length > 0) {
    const counts = await drizzle
      .select({
        orgId: schema.requests.orgId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(schema.requests)
      .where(
        and(
          inArray(schema.requests.orgId, orgIds),
          sql`${schema.requests.status} NOT IN ('delivered', 'archived', 'cancelled')`
        )
      )
      .groupBy(schema.requests.orgId)

    for (const row of counts) {
      requestCounts[row.orgId] = row.count
    }
  }

  const orgsWithCounts = orgs.map(o => ({
    ...o,
    openRequestCount: requestCounts[o.id] ?? 0,
  }))

  return NextResponse.json({ organisations: orgsWithCounts, page, limit })
}

// ── POST /api/admin/clients ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  const { orgId, userId } = auth
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // This route creates a client and emails a live portal invite, so it carries
  // the same `clients` gate as the mint and welcome routes rather than trusting
  // "is in the Tahi org" alone (CLAUDE.md rule 11).
  const featureDenied = await requireFeature(auth, 'clients')
  if (featureDenied) return featureDenied

  const body = await req.json() as {
    name?: string; website?: string; industry?: string; planType?: string
    primaryContactEmail?: string; primaryContactName?: string
    /** Opt out of the invite email the dialog promises. Defaults to sending. */
    sendInvite?: boolean
  }
  const { name, website, industry, planType, primaryContactEmail, primaryContactName } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Client name is required' }, { status: 400 })
  }

  // Validate the address BEFORE anything is written, with the same shape the
  // mint route uses. A typo here used to create the client, the contact and an
  // invite token bound to a mailbox that cannot receive mail, and surface only
  // as a Resend failure on a toast.
  const contactEmail = primaryContactEmail?.trim() ?? ''
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return NextResponse.json(
      { error: 'That primary contact email does not look like a valid address' },
      { status: 400 },
    )
  }

  const database = await db()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
    .insert(schema.organisations)
    .values({
      id,
      name: name.trim(),
      website: website?.trim() || null,
      industry: industry?.trim() || null,
      planType: planType || null,
      status: 'active',
      healthStatus: 'green',
      createdAt: now,
      updatedAt: now,
    })

  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // If a primary contact email was provided, create the contact record and mint
  // the invite the dialog promises.
  //
  // portalRole 'admin': this is the first person at a brand new workspace, so
  // they are its owner. Leaving them on the 'member' default is what used to
  // refuse an owner on their own portal (organisation, brands and people all
  // require an admin contact) until someone hand-edited the column.
  const invite: { email: string; link: string; emailed: boolean; error?: string } | null =
    contactEmail
      ? { email: contactEmail.toLowerCase(), link: '', emailed: false }
      : null

  if (invite) {
    const contactName = primaryContactName?.trim() || contactEmail.split('@')[0]

    await drizzle.insert(schema.contacts).values({
      id: crypto.randomUUID(),
      orgId: id,
      name: contactName,
      email: invite.email,
      isPrimary: true,
      portalRole: 'admin',
      createdAt: now,
      updatedAt: now,
    })

    // The client row is the thing that must survive. An invite or a Resend
    // hiccup is reported on the response, never allowed to fail the create and
    // leave the operator thinking no client exists when one does.
    try {
      const minted = await createInvite(drizzle, {
        flow: 'client',
        orgId: id,
        // The commercial conversation already happened offline, so the invited
        // client is never shown a payment step on a workspace we set up.
        persona: personaForPlanType(planType),
        contactEmail: invite.email,
        contactName,
        createdById: userId ?? null,
      })
      invite.link = minted.link

      if (body.sendInvite !== false) {
        const outcome = await sendEmail(
          invite.email,
          `Your ${name.trim()} portal is ready`,
          createElement(ClientInviteEmail, {
            contactName,
            orgName: name.trim(),
            inviteUrl: minted.link,
            boundEmail: invite.email,
            expiresAt: minted.expiresAt,
          }),
          undefined,
          { template: 'client-invite', orgId: id },
        )
        invite.emailed = outcome.success
        if (!outcome.success) invite.error = outcome.error ?? 'Failed to send'
      }
    } catch (err) {
      console.error('[clients] invite for the new client failed:', err)
      invite.error = 'Could not create the invite'
    }
  }

  // If a retainer plan was selected, create a subscription + provision tracks
  if (planType === 'maintain' || planType === 'scale') {
    const subscriptionId = crypto.randomUUID()
    await drizzle.insert(schema.subscriptions).values({
      id: subscriptionId,
      orgId: id,
      planType,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    // Provision tracks: maintain = 1 small, scale = 1 small + 1 large
    const trackDefs: Array<{ type: 'small' | 'large' }> =
      planType === 'scale'
        ? [{ type: 'small' }, { type: 'large' }]
        : [{ type: 'small' }]

    for (const t of trackDefs) {
      await drizzle.insert(schema.tracks).values({
        id: crypto.randomUUID(),
        subscriptionId,
        type: t.type,
        isPriorityTrack: false,
        currentRequestId: null,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  // Seed default kanban columns for this client (T85)
  const defaultColumns = [
    { label: 'Submitted',     statusValue: 'submitted',     position: 0 },
    { label: 'In Review',     statusValue: 'in_review',     position: 1 },
    { label: 'In Progress',   statusValue: 'in_progress',   position: 2 },
    { label: 'Client Review', statusValue: 'client_review', position: 3 },
    { label: 'Delivered',     statusValue: 'delivered',      position: 4 },
    { label: 'Archived',      statusValue: 'archived',      position: 5 },
  ]

  for (const col of defaultColumns) {
    await drizzle.insert(schema.kanbanColumns).values({
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
  await dispatchDomainEvent(drizzle, {
    type: 'client_onboarded',
    entityId: id,
    entityType: 'organisation',
    orgId: id,
    data: {
      name: name.trim(),
      planType: planType || 'none',
      source: 'admin',
    },
  })

  return NextResponse.json({ id, invite }, { status: 201 })
}
