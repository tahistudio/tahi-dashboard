/**
 * The minimum-context gate, which both sides run.
 *
 * The dialog checks it before it spends a fetch and the route checks it again
 * before it spends a model call, so the rule has to be one function. These
 * cases are the contract between them.
 */
import { describe, it, expect } from 'vitest'
import { MIN_TITLE_CHARS, MIN_TITLE_WORDS, countWords, hasEnoughContext } from '@/lib/predict/context'

describe('countWords', () => {
  it('counts words the way a person would', () => {
    expect(countWords('Rebuild the pricing page')).toBe(4)
  })

  it('is not fooled by runs of whitespace or newlines', () => {
    expect(countWords('  Rebuild   the\npricing\tpage  ')).toBe(4)
  })

  it('answers zero for an empty or blank title', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })
})

describe('hasEnoughContext', () => {
  const request = (title: string, orgId: string | null = 'org_1') =>
    hasEnoughContext({ subject: 'request', title, orgId })

  it('takes a four word, sixteen character title with a client', () => {
    expect(request('Rebuild the pricing page')).toBe(true)
  })

  it('refuses a title under the word floor however long the words are', () => {
    // Three words, well over sixteen characters.
    expect(request('Homepage refresh urgently')).toBe(false)
    expect(MIN_TITLE_WORDS).toBe(4)
  })

  it('refuses a title under the character floor however many words it has', () => {
    // Five words, fifteen characters.
    expect(request('a b c d ef ghi')).toBe(false)
    expect(MIN_TITLE_CHARS).toBe(16)
  })

  it('does not count surrounding whitespace toward either floor', () => {
    expect(request('   fix it now ok   ')).toBe(false)
  })

  it('refuses a request with no client, whatever the title says', () => {
    // A studio median without a client is an average wearing a judgement's
    // clothes, and the client is the whole reason the grounding is worth
    // reading.
    expect(request('Rebuild the pricing page hero', null)).toBe(false)
  })

  it('takes a studio task with no client, because it legitimately has none', () => {
    expect(hasEnoughContext({
      subject: 'task',
      title: 'Write the quarterly capacity review',
      orgId: null,
      level: 'tahi_internal',
    })).toBe(true)
  })

  it('refuses a client task with no client chosen yet', () => {
    expect(hasEnoughContext({
      subject: 'task',
      title: 'Write the quarterly capacity review',
      orgId: null,
      level: 'internal_client_task',
    })).toBe(false)
  })

  it('takes a client task once the client is chosen', () => {
    expect(hasEnoughContext({
      subject: 'task',
      title: 'Write the quarterly capacity review',
      orgId: 'org_1',
      level: 'internal_client_task',
    })).toBe(true)
  })
})
