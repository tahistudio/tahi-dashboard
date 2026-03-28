import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

export const dynamic = 'force-dynamic'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── POST /api/admin/seed ────────────────────────────────────────────────────
// Creates sample data for testing. Admin only.
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as DrizzleDB
  const now = new Date().toISOString()

  // ── Team members ──────────────────────────────────────────────────────────
  const teamMember1Id = crypto.randomUUID()
  const teamMember2Id = crypto.randomUUID()

  await drizzle.insert(schema.teamMembers).values([
    {
      id: teamMember1Id,
      name: 'Sarah Chen',
      email: 'sarah@tahi.studio',
      title: 'Senior Designer',
      role: 'member',
      skills: JSON.stringify(['ui-design', 'branding', 'illustration']),
      weeklyCapacityHours: 40,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: teamMember2Id,
      name: 'James Park',
      email: 'james@tahi.studio',
      title: 'Full Stack Developer',
      role: 'member',
      skills: JSON.stringify(['react', 'nextjs', 'typescript', 'node']),
      weeklyCapacityHours: 40,
      createdAt: now,
      updatedAt: now,
    },
  ])

  // ── Organisations ─────────────────────────────────────────────────────────
  const org1Id = crypto.randomUUID()
  const org2Id = crypto.randomUUID()
  const org3Id = crypto.randomUUID()

  await drizzle.insert(schema.organisations).values([
    {
      id: org1Id,
      name: 'Acme Corp',
      website: 'https://acme.example.com',
      industry: 'Technology',
      status: 'active',
      planType: 'maintain',
      healthStatus: 'green',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: org2Id,
      name: 'Beta Labs',
      website: 'https://betalabs.example.com',
      industry: 'Healthcare',
      status: 'active',
      planType: 'scale',
      healthStatus: 'amber',
      healthNote: 'Slow to respond on last two requests',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: org3Id,
      name: 'Gamma Design',
      website: 'https://gammadesign.example.com',
      industry: 'Creative Services',
      status: 'active',
      planType: 'launch',
      healthStatus: 'green',
      createdAt: now,
      updatedAt: now,
    },
  ])

  // ── Contacts (2 per org) ──────────────────────────────────────────────────
  const contactIds: string[] = []
  const contactValues = [
    { orgId: org1Id, name: 'Alice Johnson', email: 'alice@acme.example.com', role: 'CEO', isPrimary: true },
    { orgId: org1Id, name: 'Bob Smith', email: 'bob@acme.example.com', role: 'Marketing Manager', isPrimary: false },
    { orgId: org2Id, name: 'Carol Williams', email: 'carol@betalabs.example.com', role: 'CTO', isPrimary: true },
    { orgId: org2Id, name: 'David Brown', email: 'david@betalabs.example.com', role: 'Product Manager', isPrimary: false },
    { orgId: org3Id, name: 'Eva Martinez', email: 'eva@gammadesign.example.com', role: 'Founder', isPrimary: true },
    { orgId: org3Id, name: 'Frank Lee', email: 'frank@gammadesign.example.com', role: 'Creative Director', isPrimary: false },
  ]

  for (const c of contactValues) {
    const id = crypto.randomUUID()
    contactIds.push(id)
    await drizzle.insert(schema.contacts).values({
      id,
      orgId: c.orgId,
      name: c.name,
      email: c.email,
      role: c.role,
      isPrimary: c.isPrimary,
      createdAt: now,
      updatedAt: now,
    })
  }

  // ── Subscriptions (1 per org for maintain/scale) ──────────────────────────
  const sub1Id = crypto.randomUUID()
  const sub2Id = crypto.randomUUID()

  await drizzle.insert(schema.subscriptions).values([
    {
      id: sub1Id,
      orgId: org1Id,
      planType: 'maintain',
      status: 'active',
      currentPeriodStart: '2026-03-01',
      currentPeriodEnd: '2026-03-31',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: sub2Id,
      orgId: org2Id,
      planType: 'scale',
      status: 'active',
      currentPeriodStart: '2026-03-01',
      currentPeriodEnd: '2026-03-31',
      createdAt: now,
      updatedAt: now,
    },
  ])

  // ── Tracks (2 per subscription: small + large) ────────────────────────────
  const trackIds: string[] = []
  for (const subId of [sub1Id, sub2Id]) {
    for (const trackType of ['small', 'large'] as const) {
      const id = crypto.randomUUID()
      trackIds.push(id)
      await drizzle.insert(schema.tracks).values({
        id,
        subscriptionId: subId,
        type: trackType,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  // ── Requests (5 across orgs) ──────────────────────────────────────────────
  const requestIds: string[] = []
  const requestValues = [
    {
      orgId: org1Id, trackId: trackIds[0], title: 'Redesign landing page hero section',
      type: 'large_task' as const, category: 'design', status: 'in_progress',
      priority: 'high' as const, assigneeId: teamMember1Id,
    },
    {
      orgId: org1Id, trackId: trackIds[1], title: 'Fix mobile nav dropdown bug',
      type: 'bug_fix' as const, category: 'development', status: 'submitted',
      priority: 'standard' as const, assigneeId: teamMember2Id,
    },
    {
      orgId: org2Id, trackId: trackIds[2], title: 'Build patient intake form',
      type: 'new_feature' as const, category: 'development', status: 'in_review',
      priority: 'high' as const, assigneeId: teamMember2Id,
    },
    {
      orgId: org2Id, trackId: trackIds[3], title: 'Update brand guidelines PDF',
      type: 'content_update' as const, category: 'design', status: 'delivered',
      priority: 'standard' as const, assigneeId: teamMember1Id,
      deliveredAt: now,
    },
    {
      orgId: org3Id, trackId: null, title: 'Website launch - full build',
      type: 'new_feature' as const, category: 'development', status: 'in_progress',
      priority: 'high' as const, assigneeId: teamMember2Id,
    },
  ]

  for (const r of requestValues) {
    const id = crypto.randomUUID()
    requestIds.push(id)
    await drizzle.insert(schema.requests).values({
      id,
      orgId: r.orgId,
      trackId: r.trackId,
      title: r.title,
      type: r.type,
      category: r.category,
      status: r.status,
      priority: r.priority,
      assigneeId: r.assigneeId,
      deliveredAt: ('deliveredAt' in r ? r.deliveredAt : null) as string | null,
      createdAt: now,
      updatedAt: now,
    })
  }

  // ── Invoices (3 across orgs) ──────────────────────────────────────────────
  const invoiceValues = [
    {
      orgId: org1Id, status: 'draft', amountUsd: 2500, totalUsd: 2500,
      dueDate: '2026-04-15',
    },
    {
      orgId: org2Id, status: 'sent', amountUsd: 4800, totalUsd: 4800,
      dueDate: '2026-04-01', sentAt: now,
    },
    {
      orgId: org3Id, status: 'paid', amountUsd: 12000, totalUsd: 12000,
      dueDate: '2026-03-15', sentAt: now, paidAt: now,
    },
  ]

  for (const inv of invoiceValues) {
    await drizzle.insert(schema.invoices).values({
      id: crypto.randomUUID(),
      orgId: inv.orgId,
      status: inv.status,
      amountUsd: inv.amountUsd,
      totalUsd: inv.totalUsd,
      dueDate: inv.dueDate,
      sentAt: inv.sentAt ?? null,
      paidAt: inv.paidAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
  }

  // ── Time entries (3) ──────────────────────────────────────────────────────
  const timeEntryValues = [
    { orgId: org1Id, requestId: requestIds[0], teamMemberId: teamMember1Id, hours: 3.5, billable: true, notes: 'Hero section mockups v1', date: '2026-03-25' },
    { orgId: org2Id, requestId: requestIds[2], teamMemberId: teamMember2Id, hours: 5, billable: true, notes: 'Patient intake form API + frontend', date: '2026-03-26' },
    { orgId: org3Id, requestId: requestIds[4], teamMemberId: teamMember2Id, hours: 8, billable: true, notes: 'Full website build - initial setup', date: '2026-03-27' },
  ]

  for (const te of timeEntryValues) {
    await drizzle.insert(schema.timeEntries).values({
      id: crypto.randomUUID(),
      orgId: te.orgId,
      requestId: te.requestId,
      teamMemberId: te.teamMemberId,
      hours: te.hours,
      billable: te.billable,
      notes: te.notes,
      date: te.date,
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.json({
    success: true,
    created: {
      teamMembers: 2,
      orgs: 3,
      contacts: 6,
      subscriptions: 2,
      tracks: 4,
      requests: 5,
      invoices: 3,
      timeEntries: 3,
    },
  })
}
