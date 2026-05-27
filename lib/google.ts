/**
 * Google API helpers. Token refresh + small typed wrappers around the
 * REST endpoints we actually use (Calendar events list + Drive file
 * download).
 *
 * Tokens live on the integrations row with service='google_workspace'.
 * Loaded once per request, refreshed on the spot if expired, and the
 * fresh token persisted back so the next request doesn't have to.
 */

import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Database = Awaited<ReturnType<typeof db>>

export interface GoogleTokens {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null  // ISO timestamp
  email: string | null
  scopes: string
}

export class GoogleNotConnectedError extends Error {
  constructor() {
    super('Google Workspace is not connected. Visit Settings → Integrations to connect.')
    this.name = 'GoogleNotConnectedError'
  }
}

export class GoogleRefreshError extends Error {
  constructor(detail: string) {
    super(`Google token refresh failed: ${detail}`)
    this.name = 'GoogleRefreshError'
  }
}

/** Loads the live access token for the org's connected Google account.
 *  Refreshes via refresh_token if the stored access token is within
 *  60s of expiry. Persists the refreshed token + new expiry. */
export async function getGoogleAccessToken(database: Database): Promise<GoogleTokens> {
  const [row] = await database
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'google_workspace'))
    .limit(1)
  if (!row || row.status !== 'connected' || !row.accessToken) {
    throw new GoogleNotConnectedError()
  }

  let config: { email?: string; scopes?: string } = {}
  try { config = JSON.parse(row.config ?? '{}') } catch { /* keep empty */ }

  const expiresAt = row.tokenExpiresAt ? new Date(row.tokenExpiresAt).getTime() : 0
  const stale = expiresAt - Date.now() < 60_000  // refresh 60s before expiry

  if (!stale) {
    return {
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      expiresAt: row.tokenExpiresAt,
      email: config.email ?? null,
      scopes: config.scopes ?? '',
    }
  }

  // Refresh.
  if (!row.refreshToken) {
    throw new GoogleRefreshError('no refresh_token on record — reconnect Google in Settings')
  }
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new GoogleRefreshError('GOOGLE_CLIENT_ID/SECRET not configured')
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: row.refreshToken,
    }).toString(),
  })
  const body = await res.json() as { access_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string }
  if (!res.ok || body.error || !body.access_token) {
    // Mark the integration as errored so the UI surfaces it.
    await database
      .update(schema.integrations)
      .set({
        status: 'error',
        errorMessage: body.error_description ?? body.error ?? 'refresh failed',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.integrations.id, row.id))
    throw new GoogleRefreshError(body.error_description ?? body.error ?? 'refresh failed')
  }
  const newExpiresAt = body.expires_in
    ? new Date(Date.now() + body.expires_in * 1000).toISOString()
    : null
  await database
    .update(schema.integrations)
    .set({
      accessToken: body.access_token,
      tokenExpiresAt: newExpiresAt,
      status: 'connected',
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.integrations.id, row.id))

  return {
    accessToken: body.access_token,
    refreshToken: row.refreshToken,
    expiresAt: newExpiresAt,
    email: config.email ?? null,
    scopes: body.scope ?? config.scopes ?? '',
  }
}

// ── Calendar ──────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string
  summary?: string
  description?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; organizer?: boolean }>
  hangoutLink?: string
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> }
  organizer?: { email?: string }
  status?: string
  htmlLink?: string
}

/** List events from the user's primary calendar between timeMin and
 *  timeMax (both ISO strings). Returns up to 250 events; pagination
 *  via nextPageToken if needed in the future. */
export async function listCalendarEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Calendar list failed: ${res.status} ${body.slice(0, 200)}`)
  }
  const data = await res.json() as { items?: CalendarEvent[] }
  return data.items ?? []
}

/** Create a new event on the user's primary calendar.
 *
 *  The event is POSTed with attendees so Google sends invites + adds
 *  the event to their calendars. We request `conferenceDataVersion=1`
 *  and a `createRequest` so Google auto-creates a Meet link — the
 *  returned `hangoutLink` becomes the meeting URL stored back on our
 *  call row. Returns the created event so callers can persist the id.
 */
export async function createCalendarEvent(
  accessToken: string,
  input: {
    title: string
    description?: string | null
    startIso: string
    durationMinutes: number
    attendeeEmails?: string[]
    location?: string | null
  },
): Promise<CalendarEvent> {
  const start = new Date(input.startIso)
  if (Number.isNaN(start.getTime())) {
    throw new Error(`createCalendarEvent: invalid startIso "${input.startIso}"`)
  }
  const end = new Date(start.getTime() + input.durationMinutes * 60_000)
  const body: Record<string, unknown> = {
    summary: input.title,
    description: input.description ?? undefined,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees: (input.attendeeEmails ?? []).filter(Boolean).map(email => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  }
  if (input.location) body.location = input.location

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Calendar create failed: ${res.status} ${text.slice(0, 300)}`)
  }
  return await res.json() as CalendarEvent
}

// ── Drive ─────────────────────────────────────────────────────────────────

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  createdTime?: string
  modifiedTime?: string
}

/** Search Drive for "Notes by Gemini" docs the user owns. q is a
 *  fully-formed Drive search query. */
export async function listDriveFiles(
  accessToken: string,
  q: string,
  limit = 50,
): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q,
    fields: 'files(id,name,mimeType,createdTime,modifiedTime)',
    pageSize: String(limit),
    orderBy: 'modifiedTime desc',
  })
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Drive list failed: ${res.status} ${body.slice(0, 200)}`)
  }
  const data = await res.json() as { files?: DriveFile[] }
  return data.files ?? []
}

/** Export a Google Doc as plain text. Returns the body as a string. */
export async function exportDriveDocAsText(
  accessToken: string,
  fileId: string,
): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Drive export failed: ${res.status} ${body.slice(0, 200)}`)
  }
  return await res.text()
}
