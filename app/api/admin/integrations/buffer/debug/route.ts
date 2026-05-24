/**
 * GET /api/admin/integrations/buffer/debug
 *
 * Diagnostic endpoint that runs the raw Buffer queries and dumps
 * what comes back, so we can spot enum mismatches (sent vs published
 * vs SENT), missing scalars, and silent-empty responses.
 *
 * Returns:
 *   - organization: first org on the account
 *   - channels: all channels (raw)
 *   - allPosts: first 20 posts WITHOUT status filter (so we see
 *               whatever Buffer returns + can read the real status
 *               enum values back)
 *   - postsByStatus: counts grouped by the actual status value
 *
 * Not paginated, not cached. Use this to confirm what's actually in
 * Buffer when the dashboard says "0 posts" but the Buffer UI shows
 * post counts.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { listOrganizations, listChannels, listPosts } from '@/lib/buffer'

export const dynamic = 'force-dynamic'

interface IntrospectField { name: string; type: { name?: string | null; ofType?: { name?: string | null } | null } }
interface IntrospectType {
  name: string
  kind: string
  fields?: IntrospectField[] | null
  enumValues?: Array<{ name: string }> | null
}

/** Run GraphQL introspection against Buffer to discover the actual
 *  schema. Looks for any type with a name containing "analytic",
 *  "metric", "engagement", etc. so we can confirm whether per-post
 *  analytics are exposed under a name we missed. */
async function introspectBufferSchema(token: string): Promise<{
  analyticsLikeTypes: IntrospectType[]
  postFields: IntrospectField[]
  channelFields: IntrospectField[]
  postStatusEnum: string[]
}> {
  const query = `
    query {
      __schema {
        types {
          name
          kind
          fields { name type { name ofType { name } } }
          enumValues { name }
        }
      }
    }
  `
  const res = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const body = await res.json() as { data?: { __schema?: { types?: IntrospectType[] } } }
  const types = body.data?.__schema?.types ?? []
  const interesting = /analytic|metric|engagement|insight|performance|stat(s|istic)|reach|impression|reaction|view/i
  const analyticsLikeTypes = types.filter(t => interesting.test(t.name))
  const postType = types.find(t => t.name === 'Post')
  const channelType = types.find(t => t.name === 'Channel')
  const postStatusType = types.find(t => t.name === 'PostStatus')
  return {
    analyticsLikeTypes,
    postFields: postType?.fields ?? [],
    channelFields: channelType?.fields ?? [],
    postStatusEnum: (postStatusType?.enumValues ?? []).map(v => v.name),
  }
}

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const token = process.env.BUFFER_API_KEY
  if (!token) {
    return NextResponse.json({ error: 'BUFFER_API_KEY not configured' }, { status: 500 })
  }

  try {
    const orgs = await listOrganizations(token)
    if (orgs.length === 0) {
      return NextResponse.json({ note: 'No organisations found on this token', orgs })
    }
    const org = orgs[0]
    const channels = await listChannels(token, org.id)
    // No status filter — see what statuses Buffer actually uses.
    const page = await listPosts(token, org.id, { first: 50 })
    const byStatus: Record<string, number> = {}
    for (const p of page.posts) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1
    }

    // Run introspection — tells us definitively what types + fields
    // exist (including hidden analytics types if any).
    let schema: Awaited<ReturnType<typeof introspectBufferSchema>> | null = null
    let schemaError: string | null = null
    try {
      schema = await introspectBufferSchema(token)
    } catch (err) {
      schemaError = err instanceof Error ? err.message : String(err)
    }

    return NextResponse.json({
      organization: org,
      channelCount: channels.length,
      channels: channels.map(c => ({ id: c.id, service: c.service, displayName: c.displayName })),
      postCount: page.posts.length,
      postsByStatus: byStatus,
      hasNextPage: page.hasNextPage,
      samplePosts: page.posts.slice(0, 3).map(p => ({
        id: p.id,
        status: p.status,
        channelId: p.channelId,
        sentAt: p.sentAt,
        scheduledAt: p.scheduledAt,
        createdAt: p.createdAt,
        textPreview: p.text.slice(0, 80),
      })),
      schema: schema ? {
        analyticsLikeTypes: schema.analyticsLikeTypes.map(t => ({
          name: t.name, kind: t.kind, fields: t.fields?.map(f => f.name) ?? null,
        })),
        postStatusEnum: schema.postStatusEnum,
        postFieldNames: schema.postFields.map(f => f.name),
        channelFieldNames: schema.channelFields.map(f => f.name),
      } : null,
      schemaError,
    })
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : 'Buffer call failed',
    }, { status: 502 })
  }
}
