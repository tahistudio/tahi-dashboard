/**
 * lib/tahi-bot.ts, and the one shared author-name resolver it feeds
 * (lib/messages-store.ts#authorName, which every message thread reads
 * through). No component-render harness exists in this repo (vitest runs
 * under environment: 'node', no jsdom or @testing-library/react installed),
 * so "a bot author renders as Tahi bot" is pinned down at the resolver each
 * renderer calls rather than by mounting the JSX. components/tahi/bot-mark.tsx
 * and the isBot branch in components/tahi/request-thread.tsx both key off the
 * same authorType === 'bot' check asserted here.
 */
import { describe, it, expect } from 'vitest'
import { TAHI_BOT, isBotAuthor } from '../tahi-bot'
import { authorName, type NameBook } from '../messages-store'

describe('isBotAuthor', () => {
  it('is true only for the fixed bot identity', () => {
    expect(isBotAuthor('bot')).toBe(true)
    expect(isBotAuthor('team_member')).toBe(false)
    expect(isBotAuthor('contact')).toBe(false)
    expect(isBotAuthor(null)).toBe(false)
    expect(isBotAuthor(undefined)).toBe(false)
  })
})

describe('authorName', () => {
  const book: NameBook = {
    team: new Map([['tm1', { name: 'Ana', avatarUrl: null }]]),
    contact: new Map([['c1', 'Sam']]),
  }

  it('maps a bot author to "Tahi bot", never a person, even when a row somehow shares an id with a real contact or teammate', () => {
    expect(authorName(book, { authorId: 'tm1', authorType: 'bot' })).toBe(TAHI_BOT.name)
    expect(authorName(book, { authorId: 'c1', authorType: 'bot' })).toBe(TAHI_BOT.name)
    expect(authorName(book, { authorId: 'tahi-bot', authorType: 'bot' })).toBe('Tahi bot')
  })

  it('still resolves team members and contacts normally', () => {
    expect(authorName(book, { authorId: 'tm1', authorType: 'team_member' })).toBe('Ana')
    expect(authorName(book, { authorId: 'c1', authorType: 'contact' })).toBe('Sam')
  })

  it('answers null for an unresolved person rather than inventing a name', () => {
    expect(authorName(book, { authorId: 'ghost', authorType: 'team_member' })).toBeNull()
    expect(authorName(book, { authorId: 'ghost', authorType: 'contact' })).toBeNull()
  })
})
