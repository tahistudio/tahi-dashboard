/**
 * Buffer GraphQL API client (personal account).
 *
 * This wraps Buffer's new GraphQL API at https://api.buffer.com. The
 * older REST API at api.bufferapp.com/1/ has been retired in favour
 * of GraphQL.
 *
 * Auth: a Personal Access Token from
 *   https://publish.buffer.com/settings/api
 * (NOT an OIDC token from the web login flow — those are explicitly
 * rejected by the API.) Set as BUFFER_API_KEY.
 *
 * IMPORTANT: this is intentionally Liam Miller's personal Buffer
 * account, not the Tahi Studio company page.
 *
 * Capabilities exposed by the GraphQL API:
 *   - organizations: needed to scope all other queries
 *   - channels:      connected social profiles (LinkedIn, Twitter, etc.)
 *   - posts:         scheduled / sent / draft posts with text + dates
 *
 * NOT available via this API (would need Buffer's separate Analyze
 * product for these):
 *   - per-post engagement metrics (likes, comments, shares, reach)
 *   - aggregate channel analytics
 *
 * So this integration surfaces "what has Liam been posting" but cannot
 * show how those posts performed.
 */

const ENDPOINT = 'https://api.buffer.com'

export interface BufferOrganization {
  id: string
  name: string | null
}

export interface BufferChannel {
  id: string
  name: string | null
  displayName: string | null
  service: string                 // 'twitter' | 'linkedin' | 'facebook' | 'instagram' | etc.
  avatarUrl: string | null
  isQueuePaused: boolean
}

export type BufferPostStatus = 'sent' | 'scheduled' | 'draft' | 'failed' | 'needs_approval'

export interface BufferPost {
  id: string
  channelId: string
  text: string
  status: string
  createdAt: string | null         // ISO timestamp
  sentAt: string | null            // ISO if status=sent
  scheduledAt: string | null
}

export interface BufferPostPage {
  posts: BufferPost[]
  hasNextPage: boolean
  endCursor: string | null
}

interface RawOrganization { id?: string; name?: string | null }
interface RawChannel {
  id?: string
  name?: string | null
  displayName?: string | null
  service?: string
  avatar?: string | null
  isQueuePaused?: boolean
}
interface RawPost {
  id?: string
  channelId?: string
  text?: string
  status?: string
  createdAt?: string | null
  sentAt?: string | null
  scheduledAt?: string | null
}

interface GqlResponse<T> {
  data?: T
  errors?: Array<{ message: string; path?: string[] }>
}

async function gql<T>(token: string, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Buffer API ${res.status}: ${detail.slice(0, 300) || res.statusText}`)
  }
  const body = await res.json() as GqlResponse<T>
  if (body.errors && body.errors.length > 0) {
    const messages = body.errors.map(e => e.message).join('; ')
    throw new Error(`Buffer GraphQL: ${messages}`)
  }
  if (!body.data) {
    throw new Error('Buffer GraphQL: empty response')
  }
  return body.data
}

// ── Organizations ──────────────────────────────────────────────────────────

const QUERY_ORGS = `
  query GetOrganizations {
    account {
      organizations {
        id
        name
      }
    }
  }
`

interface OrgsResponse {
  account: { organizations: RawOrganization[] } | null
}

export async function listOrganizations(token: string): Promise<BufferOrganization[]> {
  const data = await gql<OrgsResponse>(token, QUERY_ORGS)
  const orgs = data.account?.organizations ?? []
  return orgs
    .filter((o): o is RawOrganization & { id: string } => !!o?.id)
    .map(o => ({ id: o.id, name: o.name ?? null }))
}

// ── Channels (connected social profiles) ───────────────────────────────────

const QUERY_CHANNELS = `
  query GetChannels($organizationId: String!) {
    channels(input: { organizationId: $organizationId }) {
      id
      name
      displayName
      service
      avatar
      isQueuePaused
    }
  }
`

interface ChannelsResponse {
  channels: RawChannel[] | null
}

export async function listChannels(token: string, organizationId: string): Promise<BufferChannel[]> {
  const data = await gql<ChannelsResponse>(token, QUERY_CHANNELS, { organizationId })
  const channels = data.channels ?? []
  return channels
    .filter((c): c is RawChannel & { id: string; service: string } => !!c?.id && !!c?.service)
    .map(c => ({
      id: c.id,
      name: c.name ?? null,
      displayName: c.displayName ?? null,
      service: c.service,
      avatarUrl: c.avatar ?? null,
      isQueuePaused: !!c.isQueuePaused,
    }))
}

// ── Posts ──────────────────────────────────────────────────────────────────

const QUERY_POSTS = `
  query GetPosts(
    $organizationId: String!,
    $statuses: [PostStatus!],
    $channelIds: [String!],
    $first: Int,
    $after: String
  ) {
    posts(
      input: {
        organizationId: $organizationId,
        filter: { status: $statuses, channelIds: $channelIds }
      },
      first: $first,
      after: $after
    ) {
      pageInfo {
        endCursor
        hasNextPage
      }
      edges {
        node {
          id
          text
          status
          createdAt
          sentAt
          scheduledAt
          channelId
        }
      }
    }
  }
`

interface PostEdge { node: RawPost }
interface PostsResponse {
  posts: {
    pageInfo: { endCursor: string | null; hasNextPage: boolean }
    edges: PostEdge[]
  } | null
}

export async function listPosts(
  token: string,
  organizationId: string,
  opts: {
    statuses?: BufferPostStatus[]
    channelIds?: string[]
    first?: number
    after?: string | null
  } = {},
): Promise<BufferPostPage> {
  const first = Math.max(1, Math.min(100, opts.first ?? 20))
  const data = await gql<PostsResponse>(token, QUERY_POSTS, {
    organizationId,
    statuses: opts.statuses?.length ? opts.statuses : ['sent'],
    channelIds: opts.channelIds && opts.channelIds.length > 0 ? opts.channelIds : null,
    first,
    after: opts.after ?? null,
  })
  const wrapper = data.posts
  if (!wrapper) return { posts: [], hasNextPage: false, endCursor: null }
  const posts: BufferPost[] = wrapper.edges
    .map(e => e.node)
    .filter((n): n is RawPost & { id: string } => !!n?.id)
    .map(n => ({
      id: n.id,
      channelId: n.channelId ?? '',
      text: n.text ?? '',
      status: n.status ?? 'unknown',
      createdAt: n.createdAt ?? null,
      sentAt: n.sentAt ?? null,
      scheduledAt: n.scheduledAt ?? null,
    }))
  return {
    posts,
    hasNextPage: !!wrapper.pageInfo?.hasNextPage,
    endCursor: wrapper.pageInfo?.endCursor ?? null,
  }
}

// ── Grouping helper (engagement aggregation isn't possible — the
// GraphQL API doesn't expose per-post metrics) ────────────────────────────

export function groupPostsByChannel(
  posts: BufferPost[],
  channels: BufferChannel[],
): Array<{ channel: BufferChannel; posts: BufferPost[] }> {
  const byId = new Map(channels.map(c => [c.id, c]))
  const grouped = new Map<string, BufferPost[]>()
  for (const p of posts) {
    if (!grouped.has(p.channelId)) grouped.set(p.channelId, [])
    grouped.get(p.channelId)!.push(p)
  }
  const out: Array<{ channel: BufferChannel; posts: BufferPost[] }> = []
  for (const [channelId, ps] of grouped) {
    const channel = byId.get(channelId)
    if (channel) out.push({ channel, posts: ps })
  }
  return out
}
