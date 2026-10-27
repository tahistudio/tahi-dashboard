import { NextRequest, NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { createRequestRecord, type RequestCreateInput } from '@/lib/request-writes'
import { loadRoundPage, targetOrigin } from '@/lib/qa/server'
import { QA_VIEWPORTS, QA_VIEWPORT_KEYS, browserLabel, isQaBrowserKey, type QaBrowserKey, type QaTarget, type QaViewportKey } from '@/lib/qa/types'

const TITLE_MAX = 200
const DESCRIPTION_MAX = 4000

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Files one QA finding as an internal request against the site's client org. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const body: unknown = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
  }
  const fields = body as Record<string, unknown>

  const title = typeof fields.title === 'string' ? fields.title.trim() : ''
  if (!title || title.length > TITLE_MAX) {
    return NextResponse.json({ error: `title must be 1 to ${TITLE_MAX} characters` }, { status: 400 })
  }

  let description = ''
  if (fields.description !== undefined && fields.description !== null) {
    if (typeof fields.description !== 'string') {
      return NextResponse.json({ error: 'description must be text' }, { status: 400 })
    }
    description = fields.description.trim()
    if (description.length > DESCRIPTION_MAX) {
      return NextResponse.json({ error: `description must be at most ${DESCRIPTION_MAX} characters` }, { status: 400 })
    }
  }

  let viewport: QaViewportKey | null = null
  if (fields.viewport !== undefined && fields.viewport !== null) {
    if (typeof fields.viewport !== 'string' || !QA_VIEWPORT_KEYS.includes(fields.viewport as QaViewportKey)) {
      return NextResponse.json({ error: 'viewport is not a known QA viewport' }, { status: 400 })
    }
    viewport = fields.viewport as QaViewportKey
  }

  let browser: QaBrowserKey | null = null
  if (fields.browser !== undefined && fields.browser !== null) {
    if (!isQaBrowserKey(fields.browser)) {
      return NextResponse.json({ error: 'browser must be chromium, firefox or webkit' }, { status: 400 })
    }
    browser = fields.browser
  }

  const database = await db() as Drizzle
  const loaded = await loadRoundPage(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })
  const { roundPage, round, site } = loaded

  const origin = targetOrigin(site, round.target as QaTarget)
  if (!origin) {
    return NextResponse.json({ error: 'This round has no URL to report against' }, { status: 400 })
  }

  const lines: string[] = []
  if (description) lines.push(description, '')
  lines.push(`Page: ${origin}${roundPage.path}`)
  const vp = viewport ? QA_VIEWPORTS.find(v => v.key === viewport) : undefined
  if (vp) lines.push(`Viewport: ${vp.label} (${vp.width}px)`)
  if (browser) lines.push(`Browser: ${browserLabel(browser)}`)
  lines.push(`From QA round: ${round.name}`)

  // The client org comes from the site, never the body. isInternal keeps the
  // request out of the client portal until a person decides to share it.
  const input: RequestCreateInput = {
    clientOrgId: site.orgId,
    title,
    description: lines.join('\n'),
    isInternal: true,
  }
  const result = await createRequestRecord(database, input, {
    actorType: 'team_member',
    actorId: userId ?? null,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.failure.error }, { status: result.failure.status })
  }

  // One SQL statement appends the id, so two concurrent creates cannot overwrite each other.
  await database.update(schema.qaRoundPages).set({
    requestIds: sql`json_insert(coalesce(${schema.qaRoundPages.requestIds}, '[]'), '$[#]', ${result.request.id})`,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.qaRoundPages.id, roundPage.id))

  return NextResponse.json({ requestId: result.request.id }, { status: 201 })
}
