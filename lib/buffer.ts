/**
 * Buffer API client (personal account).
 *
 * This wraps Buffer's classic REST API (api.bufferapp.com/1). Auth is a
 * single Personal Access Token via `Authorization: Bearer <token>`, set
 * as the BUFFER_API_KEY env var. The token belongs to ONE user — in our
 * case, Liam Miller's personal Buffer account — and exposes that user's
 * connected social profiles (personal Twitter, personal LinkedIn,
 * Instagram, etc).
 *
 * IMPORTANT: this is intentionally Liam's personal social activity, not
 * the Tahi Studio company page. Tahi page metrics live in a separate
 * surface if/when we add a company-level integration.
 *
 * Endpoints used:
 *   GET /profiles.json
 *   GET /profiles/:id/updates/sent.json?count=N
 *   GET /profiles/:id/updates/pending.json?count=N
 *
 * Per-post engagement metrics live on each `update.statistics` blob.
 * Shape varies by service (Twitter has favorites/retweets, LinkedIn has
 * likes/comments/shares, etc.), so consumers should treat statistics as
 * an opaque record and surface what the service actually returned.
 */

const BASE_URL = 'https://api.bufferapp.com/1'

export interface BufferProfile {
  id: string
  service: string                // 'twitter' | 'linkedin' | 'instagram' | 'facebook' | ...
  serviceUsername: string | null // e.g. 'liammiller'
  formattedUsername: string | null  // e.g. '@liammiller'
  formattedService: string | null   // e.g. 'Twitter', 'LinkedIn'
  avatarUrl: string | null
  timezone: string | null
}

export interface BufferUpdate {
  id: string
  profileId: string
  profileService: string
  text: string
  textFormatted: string | null
  sentAt: string | null            // ISO timestamp (from `sent_at` epoch)
  scheduledAt: string | null
  status: 'sent' | 'buffer' | 'pending' | 'failed' | string
  statistics: Record<string, number>
  /** Public URL of the live post if Buffer knows it (otherwise null). */
  serviceLink: string | null
  /** First media URL if any. */
  mediaUrl: string | null
}

interface RawProfile {
  id?: string
  service?: string
  service_username?: string | null
  formatted_username?: string | null
  formatted_service?: string | null
  avatar?: string | null
  timezone?: string | null
}

interface RawStatistics {
  [k: string]: number | undefined
}

interface RawUpdate {
  id?: string
  profile_id?: string
  profile_service?: string
  text?: string
  text_formatted?: string | null
  sent_at?: number | null
  scheduled_at?: number | null
  status?: string
  statistics?: RawStatistics | null
  service_link?: string | null
  media?: { picture?: string | null; thumbnail?: string | null } | null
}

function epochToIso(epoch: number | null | undefined): string | null {
  if (epoch == null) return null
  if (!Number.isFinite(epoch)) return null
  return new Date(epoch * 1000).toISOString()
}

function toProfile(raw: RawProfile): BufferProfile | null {
  if (!raw.id || !raw.service) return null
  return {
    id: raw.id,
    service: raw.service,
    serviceUsername: raw.service_username ?? null,
    formattedUsername: raw.formatted_username ?? null,
    formattedService: raw.formatted_service ?? null,
    avatarUrl: raw.avatar ?? null,
    timezone: raw.timezone ?? null,
  }
}

function toUpdate(raw: RawUpdate): BufferUpdate | null {
  if (!raw.id) return null
  const stats: Record<string, number> = {}
  if (raw.statistics) {
    for (const [k, v] of Object.entries(raw.statistics)) {
      if (typeof v === 'number' && Number.isFinite(v)) stats[k] = v
    }
  }
  return {
    id: raw.id,
    profileId: raw.profile_id ?? '',
    profileService: raw.profile_service ?? '',
    text: raw.text ?? '',
    textFormatted: raw.text_formatted ?? null,
    sentAt: epochToIso(raw.sent_at ?? null),
    scheduledAt: epochToIso(raw.scheduled_at ?? null),
    status: raw.status ?? 'unknown',
    statistics: stats,
    serviceLink: raw.service_link ?? null,
    mediaUrl: raw.media?.picture ?? raw.media?.thumbnail ?? null,
  }
}

async function bufferFetch(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Buffer API ${res.status}: ${detail.slice(0, 200) || res.statusText}`)
  }
  return res.json()
}

export async function listProfiles(token: string): Promise<BufferProfile[]> {
  const raw = await bufferFetch('/profiles.json', token) as unknown
  if (!Array.isArray(raw)) return []
  return raw.map(p => toProfile(p as RawProfile)).filter((p): p is BufferProfile => p !== null)
}

export async function listSentUpdates(
  token: string,
  profileId: string,
  count = 20,
): Promise<BufferUpdate[]> {
  const safeCount = Math.max(1, Math.min(100, Math.round(count)))
  const raw = await bufferFetch(`/profiles/${encodeURIComponent(profileId)}/updates/sent.json?count=${safeCount}`, token) as unknown
  const obj = (raw && typeof raw === 'object' && 'updates' in raw) ? raw as { updates?: unknown } : null
  const updates = obj?.updates
  if (!Array.isArray(updates)) return []
  return updates.map(u => toUpdate(u as RawUpdate)).filter((u): u is BufferUpdate => u !== null)
}

export async function listPendingUpdates(
  token: string,
  profileId: string,
  count = 20,
): Promise<BufferUpdate[]> {
  const safeCount = Math.max(1, Math.min(100, Math.round(count)))
  const raw = await bufferFetch(`/profiles/${encodeURIComponent(profileId)}/updates/pending.json?count=${safeCount}`, token) as unknown
  const obj = (raw && typeof raw === 'object' && 'updates' in raw) ? raw as { updates?: unknown } : null
  const updates = obj?.updates
  if (!Array.isArray(updates)) return []
  return updates.map(u => toUpdate(u as RawUpdate)).filter((u): u is BufferUpdate => u !== null)
}

/** Aggregate engagement across a list of updates. Sums whatever metrics
 *  the underlying service returned. Useful for "total likes this month"
 *  style headline numbers. */
export function aggregateStats(updates: BufferUpdate[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const u of updates) {
    for (const [k, v] of Object.entries(u.statistics)) {
      totals[k] = (totals[k] ?? 0) + v
    }
  }
  return totals
}

/** Group updates by profile service for service-level analytics. */
export function groupByService(updates: BufferUpdate[]): Record<string, BufferUpdate[]> {
  const out: Record<string, BufferUpdate[]> = {}
  for (const u of updates) {
    const key = u.profileService || 'unknown'
    if (!out[key]) out[key] = []
    out[key].push(u)
  }
  return out
}
