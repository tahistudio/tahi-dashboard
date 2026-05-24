/**
 * Tests for the Buffer API client wrapper.
 *
 * Mocks fetch and exercises the parsing + aggregation helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  listProfiles, listSentUpdates, aggregateStats, groupByService,
  type BufferUpdate,
} from '../buffer'

describe('Buffer client', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  function mockFetch(payload: unknown, ok = true) {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      statusText: ok ? 'OK' : 'Server Error',
      json: () => Promise.resolve(payload),
      text: () => Promise.resolve(JSON.stringify(payload)),
    } as unknown as Response)
  }

  describe('listProfiles', () => {
    it('maps raw profile fields to typed BufferProfile', async () => {
      mockFetch([
        {
          id: 'p1',
          service: 'twitter',
          service_username: 'liammiller',
          formatted_username: '@liammiller',
          formatted_service: 'Twitter',
          avatar: 'https://...',
          timezone: 'Pacific/Auckland',
        },
        {
          id: 'p2',
          service: 'linkedin',
          service_username: null,
          formatted_username: 'Liam Miller',
          formatted_service: 'LinkedIn',
        },
      ])
      const profiles = await listProfiles('fake-token')
      expect(profiles).toHaveLength(2)
      expect(profiles[0].service).toBe('twitter')
      expect(profiles[0].formattedUsername).toBe('@liammiller')
      expect(profiles[1].service).toBe('linkedin')
    })

    it('filters out malformed profile rows', async () => {
      mockFetch([
        { id: 'good', service: 'twitter' },
        { /* no id */ service: 'twitter' },
        { id: 'no-service' },
      ])
      const profiles = await listProfiles('fake')
      expect(profiles).toHaveLength(1)
    })

    it('returns empty array on non-array payload', async () => {
      mockFetch({ error: 'something' })
      const profiles = await listProfiles('fake')
      expect(profiles).toEqual([])
    })

    it('throws on non-OK response', async () => {
      mockFetch({ error: 'unauthorized' }, false)
      await expect(listProfiles('fake')).rejects.toThrow(/Buffer API 500/)
    })
  })

  describe('listSentUpdates', () => {
    it('converts epoch sent_at to ISO and extracts statistics', async () => {
      mockFetch({
        updates: [
          {
            id: 'u1',
            profile_id: 'p1',
            profile_service: 'twitter',
            text: 'Hello world',
            sent_at: 1717200000,
            statistics: { favorites: 10, retweets: 3, reach: 500 },
            service_link: 'https://twitter.com/x/status/123',
            media: { picture: 'https://...' },
          },
        ],
      })
      const updates = await listSentUpdates('fake', 'p1', 10)
      expect(updates).toHaveLength(1)
      expect(updates[0].text).toBe('Hello world')
      expect(updates[0].sentAt).toMatch(/^2024-06-01T/)
      expect(updates[0].statistics).toEqual({ favorites: 10, retweets: 3, reach: 500 })
      expect(updates[0].mediaUrl).toBe('https://...')
    })

    it('caps count at 100', async () => {
      mockFetch({ updates: [] })
      await listSentUpdates('fake', 'p1', 999)
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/count=100/),
        expect.anything(),
      )
    })

    it('floors count at 1', async () => {
      mockFetch({ updates: [] })
      await listSentUpdates('fake', 'p1', 0)
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/count=1\b/),
        expect.anything(),
      )
    })
  })

  describe('aggregateStats', () => {
    it('sums per-key across updates', () => {
      const updates: BufferUpdate[] = [
        { id: 'a', profileId: 'p', profileService: 'twitter', text: '', textFormatted: null, sentAt: null, scheduledAt: null, status: 'sent', statistics: { likes: 5, comments: 2 }, serviceLink: null, mediaUrl: null },
        { id: 'b', profileId: 'p', profileService: 'twitter', text: '', textFormatted: null, sentAt: null, scheduledAt: null, status: 'sent', statistics: { likes: 3, shares: 1 }, serviceLink: null, mediaUrl: null },
      ]
      expect(aggregateStats(updates)).toEqual({ likes: 8, comments: 2, shares: 1 })
    })

    it('returns empty object for empty input', () => {
      expect(aggregateStats([])).toEqual({})
    })
  })

  describe('groupByService', () => {
    it('groups updates by profileService', () => {
      const updates: BufferUpdate[] = [
        { id: 'a', profileId: 'p1', profileService: 'twitter', text: '', textFormatted: null, sentAt: null, scheduledAt: null, status: 'sent', statistics: {}, serviceLink: null, mediaUrl: null },
        { id: 'b', profileId: 'p2', profileService: 'linkedin', text: '', textFormatted: null, sentAt: null, scheduledAt: null, status: 'sent', statistics: {}, serviceLink: null, mediaUrl: null },
        { id: 'c', profileId: 'p1', profileService: 'twitter', text: '', textFormatted: null, sentAt: null, scheduledAt: null, status: 'sent', statistics: {}, serviceLink: null, mediaUrl: null },
      ]
      const grouped = groupByService(updates)
      expect(grouped.twitter).toHaveLength(2)
      expect(grouped.linkedin).toHaveLength(1)
    })

    it('uses "unknown" key for empty profileService', () => {
      const updates: BufferUpdate[] = [
        { id: 'a', profileId: 'p', profileService: '', text: '', textFormatted: null, sentAt: null, scheduledAt: null, status: 'sent', statistics: {}, serviceLink: null, mediaUrl: null },
      ]
      expect(Object.keys(groupByService(updates))).toEqual(['unknown'])
    })
  })
})

beforeEach(() => {
  // reset between tests
})
