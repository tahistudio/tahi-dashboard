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
  /** Buffer calls the publish/scheduled time `dueAt`. For sent posts
   *  this is when it went out; for scheduled it's when it will go. */
  dueAt?: string | null
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
  query GetChannels($organizationId: OrganizationId!) {
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

// Status filter dropped from the GraphQL query because Buffer's docs
// give two different shapes (array vs scalar) and the API silently
// returns 0 results when the shape is wrong. Safer: pull everything,
// filter status client-side in lib/buffer.ts:listPosts. Channel +
// sort + pagination still go through GraphQL.
const QUERY_POSTS = `
  query GetPosts(
    $organizationId: OrganizationId!,
    $channelIds: [ChannelId!],
    $first: Int,
    $after: String
  ) {
    posts(
      input: {
        organizationId: $organizationId,
        sort: [
          { field: dueAt, direction: desc },
          { field: createdAt, direction: desc }
        ],
        filter: { channelIds: $channelIds }
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
          dueAt
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
    /** Client-side status filter. Buffer's status enum varies across
     *  versions (sent / published / SENT), so we fetch all and filter
     *  here after normalising to lowercase. Pass empty array or omit
     *  to skip filtering entirely. */
    statuses?: BufferPostStatus[]
    channelIds?: string[]
    first?: number
    after?: string | null
  } = {},
): Promise<BufferPostPage> {
  const first = Math.max(1, Math.min(100, opts.first ?? 20))
  const data = await gql<PostsResponse>(token, QUERY_POSTS, {
    organizationId,
    channelIds: opts.channelIds && opts.channelIds.length > 0 ? opts.channelIds : null,
    first,
    after: opts.after ?? null,
  })
  const wrapper = data.posts
  if (!wrapper) return { posts: [], hasNextPage: false, endCursor: null }
  const all: BufferPost[] = wrapper.edges
    .map(e => e.node)
    .filter((n): n is RawPost & { id: string } => !!n?.id)
    .map(n => {
      const isSent = (n.status || '').toLowerCase() === 'sent' || (n.status || '').toLowerCase() === 'published'
      return {
        id: n.id,
        channelId: n.channelId ?? '',
        text: n.text ?? '',
        status: n.status ?? 'unknown',
        createdAt: n.createdAt ?? null,
        sentAt: isSent ? (n.dueAt ?? null) : null,
        scheduledAt: !isSent ? (n.dueAt ?? null) : null,
      }
    })
  // Client-side status filter. Treat 'sent' and 'published' as
  // synonyms — Buffer has used both spellings depending on era.
  let posts = all
  if (opts.statuses && opts.statuses.length > 0) {
    const requested = new Set(opts.statuses.map(s => s.toLowerCase()))
    if (requested.has('sent')) requested.add('published')
    posts = all.filter(p => requested.has((p.status || '').toLowerCase()))
  }
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

// ── Post creation (mutations) ──────────────────────────────────────────────

export type SchedulingType = 'automatic' | 'notification'
export type PostMode = 'customScheduled' | 'addToQueue' | 'shareNow' | 'draft'

export interface ImageAsset { url: string }
export interface CreatePostOpts {
  text: string
  channelId: string
  /** ISO timestamp. Required when mode='customScheduled'. */
  dueAt?: string
  /** Default: customScheduled. */
  mode?: PostMode
  /** Default: automatic. */
  schedulingType?: SchedulingType
  /** Optional image URLs to attach. Buffer fetches each by URL. */
  imageUrls?: string[]
  /** LinkedIn first comment text — sometimes accepted (Essentials+).
   *  Will be silently ignored if Buffer's schema doesn't support it
   *  on the target channel. */
  firstComment?: string
}

interface CreatePostResponse {
  createPost?: {
    post?: { id?: string; text?: string } | null
    message?: string | null
  } | null
}

/** Create a single scheduled (or immediately-queued) post on a Buffer
 *  channel. Returns the created post id on success. */
export async function createPost(token: string, opts: CreatePostOpts): Promise<{ id: string }> {
  const mode: PostMode = opts.mode ?? 'customScheduled'
  const schedulingType: SchedulingType = opts.schedulingType ?? 'automatic'

  const assets = (opts.imageUrls ?? []).map(url => ({ image: { url } }))

  // Compose mutation. First-comment is included only when provided so
  // Buffer doesn't reject the mutation on channels that don't support
  // it (Twitter, Instagram).
  const fields: string[] = [
    `text: $text`,
    `channelId: $channelId`,
    `schedulingType: $schedulingType`,
    `mode: $mode`,
  ]
  if (mode === 'customScheduled') fields.push(`dueAt: $dueAt`)
  if (assets.length > 0) fields.push(`assets: $assets`)
  if (opts.firstComment) fields.push(`firstComment: $firstComment`)

  const variableDefs: string[] = [
    '$text: String!',
    '$channelId: ChannelId!',
    '$schedulingType: SchedulingType!',
    '$mode: PostMode!',
  ]
  if (mode === 'customScheduled') variableDefs.push('$dueAt: DateTime!')
  if (assets.length > 0) variableDefs.push('$assets: [PostAssetInput!]')
  if (opts.firstComment) variableDefs.push('$firstComment: String')

  const mutation = `
    mutation CreatePost(${variableDefs.join(', ')}) {
      createPost(input: { ${fields.join(', ')} }) {
        ... on PostActionSuccess {
          post { id text }
        }
        ... on MutationError {
          message
        }
      }
    }
  `

  const variables: Record<string, unknown> = {
    text: opts.text,
    channelId: opts.channelId,
    schedulingType,
    mode,
  }
  if (mode === 'customScheduled') {
    if (!opts.dueAt) throw new Error('dueAt is required when mode=customScheduled')
    variables.dueAt = opts.dueAt
  }
  if (assets.length > 0) variables.assets = assets
  if (opts.firstComment) variables.firstComment = opts.firstComment

  const data = await gql<CreatePostResponse>(token, mutation, variables)
  const result = data.createPost
  if (!result) throw new Error('Buffer createPost returned no payload')
  if (result.message) throw new Error(`Buffer createPost: ${result.message}`)
  if (!result.post?.id) throw new Error('Buffer createPost returned no post id')
  return { id: result.post.id }
}

/** Delete a scheduled post. */
const DELETE_POST = `
  mutation DeletePost($postId: PostId!) {
    deletePost(input: { postId: $postId }) {
      ... on PostActionSuccess { post { id } }
      ... on MutationError { message }
    }
  }
`

export async function deletePost(token: string, postId: string): Promise<void> {
  const data = await gql<{ deletePost?: { post?: { id?: string } | null; message?: string | null } | null }>(
    token, DELETE_POST, { postId }
  )
  const result = data.deletePost
  if (result?.message) throw new Error(`Buffer deletePost: ${result.message}`)
}
