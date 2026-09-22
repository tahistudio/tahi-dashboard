/**
 * lib/suggestion-summary.ts, the one reading of a suggestion.
 *
 * The point of this file existing at all is that the Slack DM and the /tasks
 * inbox describe the same row in the same words (CN.2 contract section 3).
 * That is only true while both sides call the SAME function, so what is
 * pinned here is the identity of the exports, not a second copy of the
 * behaviour the view's own tests already cover: the page's module must
 * re-export these, not re-implement them.
 */
import { describe, it, expect } from 'vitest'
import * as shared from '@/lib/suggestion-summary'
import * as page from '@/app/(dashboard)/tasks/suggestions-logic'

describe('the page and Slack read one summariser', () => {
  const names = [
    'SUGGESTION_KIND_LABELS',
    'attachButtonLabel',
    'bestMatchTarget',
    'canAttachBestMatch',
    'confidenceLabel',
    'similarMatchLine',
    'suggestedAssigneeLine',
    'suggestionKindLabel',
    'summariseProposal',
    'targetRequestLine',
  ] as const

  for (const name of names) {
    it(`re-exports ${name} rather than re-implementing it`, () => {
      expect(page[name]).toBe(shared[name])
    })
  }
})

describe('the summary of a proposal', () => {
  it('never throws on a shape it cannot read', () => {
    expect(shared.summariseProposal('create_task', 'not json')).toBe('Untitled task')
    expect(shared.summariseProposal('create_task', null)).toBe('Untitled task')
    expect(shared.summariseProposal('update_task', { fields: {} })).toBe('No fields changed')
    expect(shared.summariseProposal('add_subtasks', { subtasks: [1, ' ', 'Write the brief'] })).toBe('Write the brief')
    expect(shared.summariseProposal('not_a_kind', {})).toBe('Unrecognised suggestion')
  })

  it('names a kind it has never heard of as itself', () => {
    expect(shared.suggestionKindLabel('create_task')).toBe('New task')
    expect(shared.suggestionKindLabel('invent_a_kind')).toBe('invent_a_kind')
  })
})
