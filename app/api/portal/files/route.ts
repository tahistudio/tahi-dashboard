import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface FileItem {
  id: string
  name: string
  type: string
  uploadedBy: string
  ago: string
  url: string
}

function rel(iso: string | null, now: number): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now - t)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  return `${Math.floor(d / 7)}w ago`
}

// Short type chip from the filename extension (Figma / PDF / ZIP / PNG …).
function fileType(filename: string, mimeType: string | null): string {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : ''
  if (ext === 'fig') return 'Figma'
  if (ext) return ext.toUpperCase()
  if (mimeType) {
    const sub = mimeType.split('/').pop()
    if (sub) return sub.toUpperCase()
  }
  return 'File'
}

// ── GET /api/portal/files ────────────────────────────────────────────────────
// Recent org files for the client "Recent files" card. Scoped to the caller's
// org, external-visible only: files attached to an internal request or an
// internal message are excluded so nothing private leaks. Honest empty [] when
// there are no files. Read-only, safe under Client-view impersonation.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 20) : 8

  const database = await db()
  const drizzle = database as D1
  const now = Date.now()

  let rows: Array<{
    id: string
    filename: string
    storageKey: string
    mimeType: string | null
    uploadedById: string
    uploadedByType: string
    createdAt: string
    reqInternal: boolean | null
    msgInternal: boolean | null
  }> = []
  try {
    // Overfetch, then strip files on internal requests/messages in JS. The
    // leftJoins expose the parent's isInternal flags without narrowing the base
    // set (org-level / brand files have null parents and stay included).
    rows = await drizzle
      .select({
        id: schema.files.id,
        filename: schema.files.filename,
        storageKey: schema.files.storageKey,
        mimeType: schema.files.mimeType,
        uploadedById: schema.files.uploadedById,
        uploadedByType: schema.files.uploadedByType,
        createdAt: schema.files.createdAt,
        reqInternal: schema.requests.isInternal,
        msgInternal: schema.messages.isInternal,
      })
      .from(schema.files)
      .leftJoin(schema.requests, eq(schema.files.requestId, schema.requests.id))
      .leftJoin(schema.messages, eq(schema.files.messageId, schema.messages.id))
      .where(eq(schema.files.orgId, orgId))
      .orderBy(desc(schema.files.createdAt))
      .limit(limit * 4)
  } catch {
    rows = []
  }

  const visible = rows.filter((r) => r.reqInternal !== true && r.msgInternal !== true).slice(0, limit)

  // Resolve uploader display names: team members and contacts in one batch each.
  const teamIds = new Set<string>()
  const contactIds = new Set<string>()
  for (const r of visible) {
    if (r.uploadedByType === 'team_member') teamIds.add(r.uploadedById)
    else if (r.uploadedByType === 'contact') contactIds.add(r.uploadedById)
  }

  const nameById = new Map<string, string>()
  if (teamIds.size > 0) {
    try {
      const members = await drizzle
        .select({ id: schema.teamMembers.id, name: schema.teamMembers.name })
        .from(schema.teamMembers)
      for (const m of members) if (teamIds.has(m.id)) nameById.set(m.id, m.name)
    } catch {
      // ignore — falls back to a generic label
    }
  }
  if (contactIds.size > 0) {
    try {
      const contacts = await drizzle
        .select({ id: schema.contacts.id, name: schema.contacts.name })
        .from(schema.contacts)
        .where(eq(schema.contacts.orgId, orgId))
      for (const c of contacts) if (contactIds.has(c.id)) nameById.set(c.id, c.name)
    } catch {
      // ignore
    }
  }

  const items: FileItem[] = visible.map((r) => ({
    id: r.id,
    name: r.filename,
    type: fileType(r.filename, r.mimeType),
    uploadedBy: nameById.get(r.uploadedById) ?? (r.uploadedByType === 'team_member' ? 'Your team' : 'You'),
    ago: rel(r.createdAt, now),
    url: `/api/uploads/serve?key=${encodeURIComponent(r.storageKey)}`,
  }))

  return NextResponse.json({ items })
}
