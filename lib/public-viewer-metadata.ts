/**
 * `generateMetadata` helpers for the public, no-auth document viewers
 * (`/p/proposal/[token]`, `/p/schedule/[token]`).
 *
 * A shared link previewed in Slack, iMessage or an email client has no
 * page title, no description and no image unless the page ships real
 * OpenGraph tags. Both viewers query the same public token as their GET
 * route (no HTTP round-trip to our own API) and return a safe generic
 * fallback for anything invalid, revoked or never-shared so an OG scrape
 * never leaks the existence of a token.
 */
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { publicUrl } from '@/lib/app-url'

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/

export interface PublicDocMetadata {
  title: string
  description: string
  path: string
}

const FALLBACK_PROPOSAL: PublicDocMetadata = {
  title: 'Proposal',
  description: 'A Tahi Studio proposal.',
  path: '',
}

const FALLBACK_SCHEDULE: PublicDocMetadata = {
  title: 'Project schedule',
  description: 'A Tahi Studio project schedule.',
  path: '',
}

/** Statuses a public GET route will actually render, mirroring the
 *  `where`/status guards in the GET routes themselves. Anything else
 *  (never shared, revoked) falls back to the generic title. */
const VISIBLE_PROPOSAL_STATUSES = new Set(['shared', 'accepted', 'declined', 'expired'])

export async function resolveProposalMetadata(token: string | undefined | null): Promise<PublicDocMetadata> {
  if (!token || !TOKEN_RE.test(token)) return FALLBACK_PROPOSAL
  try {
    const database = await db()
    const [row] = await database
      .select({
        title: schema.proposals.title,
        status: schema.proposals.status,
        orgName: schema.organisations.name,
      })
      .from(schema.proposals)
      .leftJoin(schema.organisations, eq(schema.proposals.orgId, schema.organisations.id))
      .where(eq(schema.proposals.publicShareToken, token))
      .limit(1)

    if (!row || !VISIBLE_PROPOSAL_STATUSES.has(row.status)) return FALLBACK_PROPOSAL

    const title = row.title?.trim() || FALLBACK_PROPOSAL.title
    const description = row.orgName
      ? `A Tahi Studio proposal prepared for ${row.orgName}.`
      : FALLBACK_PROPOSAL.description
    return { title, description, path: `/p/proposal/${token}` }
  } catch {
    return FALLBACK_PROPOSAL
  }
}

export async function resolveScheduleMetadata(token: string | undefined | null): Promise<PublicDocMetadata> {
  if (!token || !TOKEN_RE.test(token)) return FALLBACK_SCHEDULE
  try {
    const database = await db()
    const [row] = await database
      .select({
        title: schema.projectSchedules.title,
        status: schema.projectSchedules.status,
        orgName: schema.organisations.name,
      })
      .from(schema.projectSchedules)
      .leftJoin(schema.organisations, eq(schema.projectSchedules.orgId, schema.organisations.id))
      .where(eq(schema.projectSchedules.publicShareToken, token))
      .limit(1)

    if (!row || row.status !== 'shared') return FALLBACK_SCHEDULE

    const title = row.title?.trim() || FALLBACK_SCHEDULE.title
    const description = row.orgName
      ? `A Tahi Studio project schedule prepared for ${row.orgName}.`
      : FALLBACK_SCHEDULE.description
    return { title, description, path: `/p/schedule/${token}` }
  } catch {
    return FALLBACK_SCHEDULE
  }
}

/** Build the Next.js `Metadata` object shared by both viewers. */
export function toMetadata(doc: PublicDocMetadata) {
  const url = doc.path ? publicUrl(doc.path) : undefined
  const image = publicUrl('/tahi-logo.png')
  return {
    title: doc.title,
    description: doc.description,
    robots: { index: false, follow: false },
    openGraph: {
      title: doc.title,
      description: doc.description,
      type: 'website' as const,
      ...(url ? { url } : {}),
      images: [{ url: image }],
    },
    twitter: {
      card: 'summary_large_image' as const,
      title: doc.title,
      description: doc.description,
      images: [image],
    },
  }
}
