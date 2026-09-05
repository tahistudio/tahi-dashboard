import { describe, it, expect } from 'vitest'
import { parseQuickAdd, type QuickAddClient } from './tasks-quick-add'

// Saturday 5 September 2026, local. getDay() === 6.
const NOW = new Date(2026, 8, 5, 12, 0, 0)

const CLIENTS: QuickAddClient[] = [
  { id: 'o1', name: 'Kowtow' },
  { id: 'o2', name: 'Allbirds' },
]

describe('priority', () => {
  it('lifts an explicit bang token out of the title', () => {
    const out = parseQuickAdd('Draft the brief !high', CLIENTS, NOW)
    expect(out.priority).toBe('high')
    expect(out.title).toBe('Draft the brief')
  })

  it('aliases the prototype scale onto the repo scale', () => {
    expect(parseQuickAdd('x !medium', CLIENTS, NOW).priority).toBe('standard')
    expect(parseQuickAdd('x !low', CLIENTS, NOW).priority).toBe('standard')
    expect(parseQuickAdd('x !urgent', CLIENTS, NOW).priority).toBe('urgent')
  })

  it('reads a bare "urgent" and removes the word', () => {
    const out = parseQuickAdd('urgent fix for the footer', CLIENTS, NOW)
    expect(out.priority).toBe('urgent')
    expect(out.title).toBe('fix for the footer')
  })

  it('leaves priority null when nothing is said', () => {
    expect(parseQuickAdd('Just a task', CLIENTS, NOW).priority).toBeNull()
  })
})

describe('dates', () => {
  it('reads today and tomorrow', () => {
    expect(parseQuickAdd('ping them today', CLIENTS, NOW).dueDate).toBe('2026-09-05')
    expect(parseQuickAdd('ping them tomorrow', CLIENTS, NOW).dueDate).toBe('2026-09-06')
    expect(parseQuickAdd('ping them tmrw', CLIENTS, NOW).dueDate).toBe('2026-09-06')
  })

  it('reads "next week" as the coming Monday', () => {
    // getDay() is 6 (Saturday), so (8 - 6) % 7 === 2 days out: Monday the 7th.
    expect(parseQuickAdd('review next week', CLIENTS, NOW).dueDate).toBe('2026-09-07')
  })

  it('reads "in N days"', () => {
    expect(parseQuickAdd('follow up in 3 days', CLIENTS, NOW).dueDate).toBe('2026-09-08')
  })

  it('reads a weekday name and never resolves it to today', () => {
    expect(parseQuickAdd('call on friday', CLIENTS, NOW).dueDate).toBe('2026-09-11')
    // Saturday from a Saturday means next Saturday, not now.
    expect(parseQuickAdd('call saturday', CLIENTS, NOW).dueDate).toBe('2026-09-12')
  })

  it('strips the date token from the title', () => {
    expect(parseQuickAdd('Send the deck tomorrow', CLIENTS, NOW).title).toBe('Send the deck')
  })

  it('leaves the date null when nothing matches', () => {
    expect(parseQuickAdd('Send the deck', CLIENTS, NOW).dueDate).toBeNull()
  })
})

describe('client', () => {
  it('strips an @mention and links the client', () => {
    const out = parseQuickAdd('Chase invoice @Kowtow', CLIENTS, NOW)
    expect(out.orgId).toBe('o1')
    expect(out.title).toBe('Chase invoice')
  })

  it('is case insensitive on the mention', () => {
    expect(parseQuickAdd('Chase @kowtow', CLIENTS, NOW).orgId).toBe('o1')
  })

  it('keeps a bare name in the title but still links', () => {
    const out = parseQuickAdd('Kowtow redirect map', CLIENTS, NOW)
    expect(out.orgId).toBe('o1')
    expect(out.title).toBe('Kowtow redirect map')
  })

  it('leaves the client null when no name appears', () => {
    expect(parseQuickAdd('Tidy the drive', CLIENTS, NOW).orgId).toBeNull()
  })
})

describe('level', () => {
  it('is tahi_internal with no client', () => {
    expect(parseQuickAdd('Tidy the drive', CLIENTS, NOW).level).toBe('tahi_internal')
  })

  it('is internal_client_task once a client is found, mention or not', () => {
    expect(parseQuickAdd('Chase @Kowtow', CLIENTS, NOW).level).toBe('internal_client_task')
    expect(parseQuickAdd('Kowtow redirect map', CLIENTS, NOW).level).toBe('internal_client_task')
  })
})

describe('title', () => {
  it('collapses whitespace and trims', () => {
    expect(parseQuickAdd('  Draft   the    brief  !high ', CLIENTS, NOW).title).toBe('Draft the brief')
  })

  it('is empty when the input is only tokens', () => {
    expect(parseQuickAdd('@Kowtow tomorrow !high', CLIENTS, NOW).title).toBe('')
  })
})

describe('everything at once', () => {
  it('parses a full line', () => {
    const out = parseQuickAdd('Send the redirect map @Kowtow friday !urgent', CLIENTS, NOW)
    expect(out).toEqual({
      title: 'Send the redirect map',
      orgId: 'o1',
      level: 'internal_client_task',
      dueDate: '2026-09-11',
      priority: 'urgent',
    })
  })
})
