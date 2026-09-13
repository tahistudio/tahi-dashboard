/**
 * POST /api/feedback
 *
 * The beta feedback floating comment ball. Any signed-in user (Tahi team or
 * client) may post one. Identity is resolved SERVER-SIDE, never trusted from
 * the body: getRequestAuth first, and only when the caller's Clerk org is not
 * the Tahi org do we fall back to getPortalAuth to resolve the client's D1
 * organisation. There is deliberately no PATCH/DELETE and no inbox UI here:
 * rows are read back only through GET /api/admin/feedback (admin only) and
 * the MCP tool list_feedback_comments.
 *
 * org_id is stored from the SESSION only. A Tahi caller (team member or
 * admin) has no single client the comment is about, so their row carries
 * NULL org_id; a client contact's row carries the D1 organisations.id
 * getPortalAuth already resolved for their session.
 *
 * An optional `anchor` object (built client-side by
 * lib/feedback-anchor.ts, see components/tahi/feedback-ball.tsx's pick
 * mode) describes a specific element the comment is about: a selector path,
 * tag, short text snippet, bounding rect + page scroll height, and a bit of
 * ancestor context. Absent entirely for a general comment. Present but
 * malformed (oversized, or missing/non-integer rect fields) is a 400: a
 * corrupt anchor is worse than none, since GET /api/admin/feedback and the
 * MCP tool would otherwise hand a broken pointer back to whoever reads it.
 */
import { getPortalAuth, getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { contactIdentityWhere } from '@/lib/portal-identity'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, gte } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const MAX_BODY_LENGTH = 5000
const RATE_LIMIT_PER_HOUR = 30
const BREAKPOINTS = new Set(['phone', 'tablet', 'desktop'])
const THEMES = new Set(['light', 'dark'])
const MAX_ANCHOR_SELECTOR_LENGTH = 600
const MAX_ANCHOR_TEXT_LENGTH = 200
const MAX_ANCHOR_CONTEXT_LENGTH = 200
const MAX_ANCHOR_TAG_LENGTH = 50

interface FeedbackBody {
  body?: unknown
  route?: unknown
  pageTitle?: unknown
  viewportWidth?: unknown
  viewportHeight?: unknown
  breakpoint?: unknown
  theme?: unknown
  userAgent?: unknown
  context?: unknown
  anchor?: unknown
}

interface AnchorRectValue {
  x: number
  y: number
  width: number
  height: number
  scrollHeight: number
}

interface ParsedAnchor {
  selector: string
  tag: string | null
  text: string | null
  rect: AnchorRectValue
  context: string | null
}

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)
}

function parseAnchorRect(v: unknown): AnchorRectValue | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (!isFiniteInt(r.x) || !isFiniteInt(r.y) || !isFiniteInt(r.width) || !isFiniteInt(r.height) || !isFiniteInt(r.scrollHeight)) {
    return null
  }
  return { x: r.x, y: r.y, width: r.width, height: r.height, scrollHeight: r.scrollHeight }
}

/**
 * Validates the optional anchor payload.
 *   undefined -> nothing was sent (fine, a general comment)
 *   null      -> something was sent but failed validation (caller 400s)
 *   otherwise -> a validated anchor ready to store
 */
function parseAnchor(value: unknown): ParsedAnchor | null | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object') return null
  const a = value as Record<string, unknown>

  if (typeof a.selector !== 'string') return null
  const selector = a.selector.trim()
  if (!selector || selector.length > MAX_ANCHOR_SELECTOR_LENGTH) return null

  const rect = parseAnchorRect(a.rect)
  if (!rect) return null

  const tag = typeof a.tag === 'string' ? a.tag.trim().slice(0, MAX_ANCHOR_TAG_LENGTH) || null : null

  let text: string | null = null
  if (a.text !== undefined && a.text !== null) {
    if (typeof a.text !== 'string' || a.text.length > MAX_ANCHOR_TEXT_LENGTH) return null
    text = a.text
  }

  let context: string | null = null
  if (a.context !== undefined && a.context !== null) {
    if (typeof a.context !== 'string' || a.context.length > MAX_ANCHOR_CONTEXT_LENGTH) return null
    context = a.context
  }

  return { selector, tag, text, rect, context }
}

function isBreakpoint(v: unknown): v is 'phone' | 'tablet' | 'desktop' {
  return typeof v === 'string' && BREAKPOINTS.has(v)
}

function isTheme(v: unknown): v is 'light' | 'dark' {
  return typeof v === 'string' && THEMES.has(v)
}

function asTrimmedString(v: unknown, maxLength: number): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function asFiniteInt(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.round(v)
}

/** Never throws: a caller who sent unserializable junk simply loses context, not the whole comment. */
function serializeContext(value: unknown): string | null {
  if (value === undefined || value === null) return null
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!auth.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => null)) as FeedbackBody | null
  const trimmedBody = typeof body?.body === 'string' ? body.body.trim() : ''
  if (!trimmedBody) {
    return NextResponse.json({ error: 'body is required' }, { status: 400 })
  }
  if (trimmedBody.length > MAX_BODY_LENGTH) {
    return NextResponse.json({ error: `body must be ${MAX_BODY_LENGTH} characters or fewer` }, { status: 400 })
  }

  const anchor = parseAnchor(body?.anchor)
  if (anchor === null) {
    return NextResponse.json({ error: 'invalid anchor' }, { status: 400 })
  }

  const database = (await db()) as D1

  let orgId: string | null = null
  let userType: 'admin' | 'team_member' | 'contact'
  let userEmail: string | null = null

  if (isTahiAdmin(auth.orgId)) {
    // Tahi team session: resolve the roster row for their real name/role.
    // Absent a roster row (a fresh login not yet claimed) they are still
    // inside the Tahi org, so default to 'admin' rather than deny them.
    const [member] = await database
      .select({ email: schema.teamMembers.email, role: schema.teamMembers.role })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, auth.userId))
      .limit(1)
    userType = member && member.role !== 'admin' ? 'team_member' : 'admin'
    userEmail = member?.email ?? null
    orgId = null
  } else {
    const portalAuth = await getPortalAuth(req)
    if (!portalAuth.orgId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    orgId = portalAuth.orgId
    userType = 'contact'
    const [contact] = await database
      .select({ email: schema.contacts.email })
      .from(schema.contacts)
      .where(contactIdentityWhere(portalAuth.orgId, auth.userId, portalAuth.contactId))
      .limit(1)
    userEmail = contact?.email ?? null
  }

  // Light rate limit: ignore (not error) anything past 30 in the trailing
  // hour for this caller, so a broken retry loop or a bored tester can't
  // flood the table. The sender still shows its normal "Sent" state.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const recent = await database
    .select({ id: schema.feedbackComments.id })
    .from(schema.feedbackComments)
    .where(and(
      eq(schema.feedbackComments.userId, auth.userId),
      gte(schema.feedbackComments.createdAt, oneHourAgo),
    ))
    .limit(RATE_LIMIT_PER_HOUR)
  if (recent.length >= RATE_LIMIT_PER_HOUR) {
    return NextResponse.json({ ok: true, stored: false }, { status: 200 })
  }

  const id = crypto.randomUUID()
  await database.insert(schema.feedbackComments).values({
    id,
    orgId,
    userId: auth.userId,
    userType,
    userEmail,
    route: asTrimmedString(body?.route, 500),
    pageTitle: asTrimmedString(body?.pageTitle, 300),
    viewportWidth: asFiniteInt(body?.viewportWidth),
    viewportHeight: asFiniteInt(body?.viewportHeight),
    breakpoint: isBreakpoint(body?.breakpoint) ? body.breakpoint : null,
    theme: isTheme(body?.theme) ? body.theme : null,
    userAgent: asTrimmedString(body?.userAgent, 500),
    body: trimmedBody,
    context: serializeContext(body?.context),
    anchorSelector: anchor?.selector ?? null,
    anchorTag: anchor?.tag ?? null,
    anchorText: anchor?.text ?? null,
    anchorRect: anchor ? JSON.stringify(anchor.rect) : null,
    anchorContext: anchor?.context ?? null,
  })

  return NextResponse.json({ ok: true, stored: true, id }, { status: 201 })
}
