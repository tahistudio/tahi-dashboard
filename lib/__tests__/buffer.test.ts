/**
 * Tests for the Buffer GraphQL API client.
 *
 * Mocks fetch and exercises the GraphQL-shaped responses.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  listOrganizations, listChannels, listPosts, groupPostsByChannel,
  type BufferPost, type BufferChannel,
} from '../buffer'

describe('Buffer GraphQL client', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function mockGql(data: unknown, ok = true, errors?: Array<{ message: string }>) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? 'OK' : 'Server Error',
      json: () => Promise.resolve({ data, errors }),
      text: () => Promise.resolve(JSON.stringify({ data, errors })),
    } as unknown as Response)
  }

  describe('listOrganizations', () => {
    it('extracts orgs from account.organizations payload', async () => {
      mockGql({ account: { organizations: [{ id: 'org1', name: 'Tahi' }, { id: 'org2', name: null }] } })
      const orgs = await listOrganizations('fake')
      expect(orgs).toHaveLength(2)
      expect(orgs[0]).toEqual({ id: 'org1', name: 'Tahi' })
      expect(orgs[1]).toEqual({ id: 'org2', name: null })
    })

    it('returns empty array when account is null', async () => {
      mockGql({ account: null })
      const orgs = await listOrganizations('fake')
      expect(orgs).toEqual([])
    })

    it('filters out orgs without ids', async () => {
      mockGql({ account: { organizations: [{ id: 'good' }, { name: 'no-id' }] } })
      const orgs = await listOrganizations('fake')
      expect(orgs).toHaveLength(1)
      expect(orgs[0].id).toBe('good')
    })

    it('throws on GraphQL errors', async () => {
      mockGql(null, true, [{ message: 'OIDC tokens not accepted' }])
      await expect(listOrganizations('fake')).rejects.toThrow(/OIDC tokens not accepted/)
    })

    it('throws on HTTP error', async () => {
      mockGql({ account: null }, false)
      await expect(listOrganizations('fake')).rejects.toThrow(/Buffer API 500/)
    })
  })

  describe('listChannels', () => {
    it('maps raw channel fields to typed BufferChannel', async () => {
      mockGql({
        channels: [
          {
            id: 'ch1',
            name: 'liam-twitter',
            displayName: '@liammiller',
            service: 'twitter',
            avatar: 'https://...',
            isQueuePaused: false,
          },
          {
            id: 'ch2',
            displayName: 'Liam Miller',
            service: 'linkedin',
            isQueuePaused: true,
          },
        ],
      })
      const channels = await listChannels('fake', 'org1')
      expect(channels).toHaveLength(2)
      expect(channels[0].service).toBe('twitter')
      expect(channels[0].displayName).toBe('@liammiller')
      expect(channels[0].isQueuePaused).toBe(false)
      expect(channels[1].isQueuePaused).toBe(true)
    })

    it('drops channels without id or service', async () => {
      mockGql({
        channels: [
          { id: 'good', service: 'twitter' },
          { service: 'no-id' },
          { id: 'no-service' },
        ],
      })
      const channels = await listChannels('fake', 'org1')
      expect(channels).toHaveLength(1)
      expect(channels[0].id).toBe('good')
    })

    it('returns empty when channels is null', async () => {
      mockGql({ channels: null })
      const channels = await listChannels('fake', 'org1')
      expect(channels).toEqual([])
    })
  })

  describe('listPosts', () => {
    it('extracts posts from edges/node structure', async () => {
      mockGql({
        posts: {
          pageInfo: { endCursor: 'cursor1', hasNextPage: true },
          edges: [
            {
              node: {
                id: 'p1',
                channelId: 'ch1',
                text: 'Hello world',
                status: 'sent',
                createdAt: '2026-05-20T12:00:00Z',
                dueAt: '2026-05-20T12:05:00Z',
              },
            },
            {
              node: {
                id: 'p2',
                channelId: 'ch2',
                text: 'Second post',
                status: 'sent',
                createdAt: '2026-05-19T10:00:00Z',
                dueAt: '2026-05-19T10:05:00Z',
              },
            },
          ],
        },
      })
      const page = await listPosts('fake', 'org1', { first: 10 })
      expect(page.posts).toHaveLength(2)
      expect(page.posts[0].text).toBe('Hello world')
      expect(page.posts[0].sentAt).toBe('2026-05-20T12:05:00Z')
      expect(page.hasNextPage).toBe(true)
      expect(page.endCursor).toBe('cursor1')
    })

    it('clamps first to 1-100 range', async () => {
      mockGql({ posts: { pageInfo: { endCursor: null, hasNextPage: false }, edges: [] } })
      await listPosts('fake', 'org1', { first: 999 })
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body as string) as { variables: { first: number } }
      expect(body.variables.first).toBe(100)
    })

    it('filters by status client-side, not via GraphQL variables', async () => {
      mockGql({
        posts: {
          pageInfo: { endCursor: null, hasNextPage: false },
          edges: [
            { node: { id: 'p1', channelId: 'ch1', text: 'sent post', status: 'sent', createdAt: null, dueAt: null } },
            { node: { id: 'p2', channelId: 'ch1', text: 'queued post', status: 'queued', createdAt: null, dueAt: null } },
          ],
        },
      })
      const page = await listPosts('fake', 'org1', { statuses: ['sent'] })
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body as string) as { variables: Record<string, unknown> }
      expect(body.variables.statuses).toBeUndefined()
      expect(page.posts.map(p => p.id)).toEqual(['p1'])
    })

    it('passes channelIds filter through', async () => {
      mockGql({ posts: { pageInfo: { endCursor: null, hasNextPage: false }, edges: [] } })
      await listPosts('fake', 'org1', { channelIds: ['ch1', 'ch2'] })
      const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
      const body = JSON.parse(call[1].body as string) as { variables: { channelIds: string[] } }
      expect(body.variables.channelIds).toEqual(['ch1', 'ch2'])
    })

    it('returns empty page when posts is null', async () => {
      mockGql({ posts: null })
      const page = await listPosts('fake', 'org1')
      expect(page).toEqual({ posts: [], hasNextPage: false, endCursor: null })
    })
  })

  describe('groupPostsByChannel', () => {
    it('groups posts by channelId with denormalised channel info', () => {
      const channels: BufferChannel[] = [
        { id: 'ch1', name: 't', displayName: 'Twitter', service: 'twitter', avatarUrl: null, isQueuePaused: false },
        { id: 'ch2', name: 'l', displayName: 'LinkedIn', service: 'linkedin', avatarUrl: null, isQueuePaused: false },
      ]
      const posts: BufferPost[] = [
        { id: 'p1', channelId: 'ch1', text: 'a', status: 'sent', createdAt: null, sentAt: null, scheduledAt: null },
        { id: 'p2', channelId: 'ch1', text: 'b', status: 'sent', createdAt: null, sentAt: null, scheduledAt: null },
        { id: 'p3', channelId: 'ch2', text: 'c', status: 'sent', createdAt: null, sentAt: null, scheduledAt: null },
      ]
      const grouped = groupPostsByChannel(posts, channels)
      expect(grouped).toHaveLength(2)
      const twitter = grouped.find(g => g.channel.service === 'twitter')
      expect(twitter?.posts).toHaveLength(2)
      const linkedin = grouped.find(g => g.channel.service === 'linkedin')
      expect(linkedin?.posts).toHaveLength(1)
    })

    it('skips posts whose channel id is unknown', () => {
      const channels: BufferChannel[] = [
        { id: 'ch1', name: null, displayName: null, service: 'twitter', avatarUrl: null, isQueuePaused: false },
      ]
      const posts: BufferPost[] = [
        { id: 'p1', channelId: 'ch1', text: 'a', status: 'sent', createdAt: null, sentAt: null, scheduledAt: null },
        { id: 'p2', channelId: 'orphan', text: 'b', status: 'sent', createdAt: null, sentAt: null, scheduledAt: null },
      ]
      const grouped = groupPostsByChannel(posts, channels)
      expect(grouped).toHaveLength(1)
      expect(grouped[0].posts).toHaveLength(1)
    })
  })
})
