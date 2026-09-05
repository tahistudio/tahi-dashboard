import { describe, it, expect, vi } from 'vitest'
import {
  filterMenuOptions,
  isCompleteDateValue,
  menuQueryChange,
  openDateEditor,
  reduceDateEditor,
  resolveDateCommit,
  type DateEditorEvent,
  type DateEditorState,
  type InlineMenuOption,
} from '@/components/tahi/inline-field'

// Vitest runs in the `node` environment here, so this covers the rules the Due
// editor commits through rather than the input itself. A native date input
// fires `input` on every segment AND reports a complete value the moment
// every segment is non-empty, so the whole editing session, not just a single
// draft, is what has to be exercised: that is what `reduceDateEditor` is for.

/**
 * Drives a whole session the way the component does: `input` on every
 * keystroke, then whatever finishes it. Returns every value the parent would
 * have been handed, in order.
 */
function driveEditor(initial: string | null, events: DateEditorEvent[]) {
  let state: DateEditorState = openDateEditor(initial)
  const writes: (string | null)[] = []
  let closed = false
  for (const event of events) {
    const result = reduceDateEditor(state, event)
    if (result.write !== undefined) writes.push(result.write)
    state = result.state
    closed = closed || result.close
  }
  return { writes, draft: state.draft, opened: state.opened, closed }
}

describe('isCompleteDateValue', () => {
  it('accepts a full ISO calendar date', () => {
    expect(isCompleteDateValue('2026-09-10')).toBe(true)
    expect(isCompleteDateValue('2024-02-29')).toBe(true)
  })

  it('rejects anything a half-filled input reports', () => {
    expect(isCompleteDateValue('')).toBe(false)
    expect(isCompleteDateValue('2026')).toBe(false)
    expect(isCompleteDateValue('2026-09')).toBe(false)
    expect(isCompleteDateValue('2026-9-1')).toBe(false)
  })

  it('rejects a well-shaped string that is not a real date', () => {
    expect(isCompleteDateValue('2026-13-01')).toBe(false)
    expect(isCompleteDateValue('2026-02-30')).toBe(false)
    expect(isCompleteDateValue('2026-00-10')).toBe(false)
  })
})

describe('resolveDateCommit', () => {
  // These are the single-draft rules. They are NOT the regression the audit
  // found: a real date input never reports '2026-09' over an existing value,
  // it reports a complete-but-unintended '2026-01-10'. That sequence lives in
  // "the Due editing session" below, which is the only place it can be shown.
  it('a partial draft over an existing date changes nothing', () => {
    expect(resolveDateCommit('2026-09', '2026-09-10')).toEqual({ changed: false, value: '2026-09-10' })
  })

  it('a partial draft on an empty field does not clear it', () => {
    expect(resolveDateCommit('2026', null)).toEqual({ changed: false, value: null })
  })

  it('commits a complete date that differs from the current value', () => {
    expect(resolveDateCommit('2026-12-10', '2026-09-10')).toEqual({ changed: true, value: '2026-12-10' })
  })

  it('does not re-write the value it already holds', () => {
    expect(resolveDateCommit('2026-09-10', '2026-09-10')).toEqual({ changed: false, value: '2026-09-10' })
  })

  it('reads through a stored value that carries a time component', () => {
    expect(resolveDateCommit('2026-09-10', '2026-09-10T00:00:00.000Z'))
      .toEqual({ changed: false, value: '2026-09-10' })
  })

  it('clears the date when the field is emptied, but only if there was one', () => {
    expect(resolveDateCommit('', '2026-09-10')).toEqual({ changed: true, value: null })
    expect(resolveDateCommit('', null)).toEqual({ changed: false, value: null })
  })
})

describe('the Due editing session', () => {
  it('case A: retyping a segment of an existing date writes once, at the end', () => {
    // Due 2026-09-10. The user opens the editor and types 1 then 2 into the
    // month. A native date input reports a COMPLETE value at each keystroke,
    // so this is verbatim what the element emits: an intermediate 2026-01-10
    // that the user never meant. Nothing may reach the parent until the
    // commit, and the commit must carry only what they finished on.
    const run = driveEditor('2026-09-10', [
      { type: 'input', raw: '2026-01-10' },
      { type: 'input', raw: '2026-12-10' },
      { type: 'commit', raw: '2026-12-10' },
    ])

    expect(run.writes).toEqual(['2026-12-10'])
    expect(run.closed).toBe(true)
  })

  it('case A, abandoned: the same keystrokes then Escape write nothing at all', () => {
    // The failure the finding describes. The user starts changing the month,
    // thinks better of it, and presses Escape. Before this, the intermediate
    // had already been PATCHed and the revert read back a `value` prop the
    // optimistic patch had overwritten, so the request stayed on 2026-01-10.
    const run = driveEditor('2026-09-10', [
      { type: 'input', raw: '2026-01-10' },
      { type: 'cancel' },
    ])

    expect(run.writes).toEqual([])
    expect(run.draft).toBe('2026-09-10')
    expect(run.closed).toBe(true)
  })

  it('case A, walked away from: blur on the intermediate still writes only what is in the box', () => {
    // Blur is a commit, so an abandoned edit that ends by clicking elsewhere
    // does write. One write, and it is the draft the input was showing, not
    // a stray from two keystrokes ago.
    const run = driveEditor('2026-09-10', [
      { type: 'input', raw: '2026-01-10' },
      { type: 'commit', raw: '2026-01-10' },
    ])

    expect(run.writes).toEqual(['2026-01-10'])
  })

  it('types a year out one digit at a time without writing 0202', () => {
    // Typing a four-digit year emits 0002, 0020, 0202, 2027 in turn, each of
    // them a complete calendar date. Committing on change fired a PATCH and a
    // toast for every one of them, out of order.
    const run = driveEditor('2026-09-10', [
      { type: 'input', raw: '0002-09-10' },
      { type: 'input', raw: '0020-09-10' },
      { type: 'input', raw: '0202-09-10' },
      { type: 'input', raw: '2027-09-10' },
      { type: 'commit', raw: '2027-09-10' },
    ])

    expect(run.writes).toEqual(['2027-09-10'])
  })

  it('case B: a date can still be set from scratch by keyboard', () => {
    const run = driveEditor(null, [
      { type: 'input', raw: '2026' },
      { type: 'input', raw: '2026-12' },
      { type: 'input', raw: '2026-12-10' },
      { type: 'commit', raw: '2026-12-10' },
    ])

    expect(run.writes).toEqual(['2026-12-10'])
  })

  it('applies a picker selection on the commit that follows it', () => {
    // The picker emits one complete value, so the mouse path is a single
    // input followed by the blur that closes the editor.
    const run = driveEditor('2026-09-10', [
      { type: 'input', raw: '2026-09-24' },
      { type: 'commit', raw: '2026-09-24' },
    ])

    expect(run.writes).toEqual(['2026-09-24'])
  })

  it('clears the date when the input is emptied and committed', () => {
    const run = driveEditor('2026-09-10', [
      { type: 'input', raw: '' },
      { type: 'commit', raw: '' },
    ])

    expect(run.writes).toEqual([null])
  })

  it('leaves the date alone when the input holds something that is not a date yet', () => {
    // badInput is the element saying "there is text in here that is not a
    // date". Its value reads '' in that state, and committing that would
    // clear a due date the user was only part way through changing.
    const run = driveEditor('2026-09-10', [
      { type: 'commit', raw: '', badInput: true },
    ])

    expect(run.writes).toEqual([])
    expect(run.closed).toBe(true)
  })

  it('does not write back the value it opened on', () => {
    const run = driveEditor('2026-09-10', [{ type: 'commit', raw: '2026-09-10' }])
    expect(run.writes).toEqual([])
  })

  it('measures against the value it opened on, not one that arrives mid-edit', () => {
    // A refetch or another optimistic patch can move the field's `value`
    // while the editor is up. The session snapshotted its baseline at open,
    // so Escape still restores what the user was looking at.
    const state = openDateEditor('2026-09-10')
    expect(state.opened).toBe('2026-09-10')

    const typed = reduceDateEditor(state, { type: 'input', raw: '2026-12-10' })
    const cancelled = reduceDateEditor(typed.state, { type: 'cancel' })
    expect(cancelled.state.draft).toBe('2026-09-10')
    expect(cancelled.write).toBeUndefined()
  })

  it('reads through a stored value that carries a time component', () => {
    expect(openDateEditor('2026-09-10T00:00:00.000Z')).toEqual({
      draft: '2026-09-10',
      opened: '2026-09-10',
    })
  })
})

// ── The menu's search box ────────────────────────────────────────────────────
//
// Both of these exist for the blocker picker, which searches the SERVER rather
// than a list the page already holds. Neither can be shown through a render
// (vitest runs in the node environment here and this repo has no jsdom), so
// the two facts the picker depends on are pinned as pure functions, and the
// component is a direct caller of both.

describe('menuQueryChange', () => {
  it('tells the caller about the keystroke and returns what the box now holds', () => {
    const notify = vi.fn()
    expect(menuQueryChange('desi', notify)).toBe('desi')
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('desi')
  })

  it('reports every keystroke, because a server search debounces at the caller', () => {
    const notify = vi.fn()
    for (const q of ['d', 'de', 'des']) menuQueryChange(q, notify)
    expect(notify.mock.calls.map(c => c[0])).toEqual(['d', 'de', 'des'])
  })

  it('reports an emptied box rather than going quiet', () => {
    const notify = vi.fn()
    expect(menuQueryChange('', notify)).toBe('')
    expect(notify).toHaveBeenCalledWith('')
  })

  it('is harmless without a caller, which is the four existing call sites', () => {
    expect(() => menuQueryChange('anything')).not.toThrow()
    expect(menuQueryChange('anything')).toBe('anything')
  })
})

describe('filterMenuOptions', () => {
  const options: InlineMenuOption[] = [
    { value: 'a', label: 'Homepage hero' },
    { value: 'b', label: 'Pricing table', keywords: 'Acme #042' },
    { value: 'c', node: null, keywords: 'Nav rebuild' },
    // What a server-searched option looks like: a rich node, no label, and
    // nothing that repeats what the server matched on.
    { value: 'd', node: null },
  ]

  it('returns everything when nothing has been typed', () => {
    expect(filterMenuOptions(options, '').map(o => o.value)).toEqual(['a', 'b', 'c', 'd'])
    expect(filterMenuOptions(options, '   ').map(o => o.value)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('matches on the label and on the keywords, case insensitively', () => {
    expect(filterMenuOptions(options, 'HERO').map(o => o.value)).toEqual(['a'])
    expect(filterMenuOptions(options, 'acme').map(o => o.value)).toEqual(['b'])
    expect(filterMenuOptions(options, '#042').map(o => o.value)).toEqual(['b'])
    expect(filterMenuOptions(options, 'nav').map(o => o.value)).toEqual(['c'])
  })

  it('drops an option that matches nothing', () => {
    expect(filterMenuOptions(options, 'nothing like this')).toEqual([])
  })

  it('skips the local pass entirely when the caller already filtered', () => {
    // The whole point. A server-searched option carries a node and no label,
    // so re-filtering here would throw away every row the server matched on a
    // title, and the picker would look permanently empty.
    expect(filterMenuOptions(options, 'HERO', true).map(o => o.value)).toEqual(['a', 'b', 'c', 'd'])
    expect(filterMenuOptions(options, 'nothing like this', true)).toHaveLength(4)
  })

  it('defaults to filtering, so the existing call sites are untouched', () => {
    expect(filterMenuOptions(options, 'hero', false).map(o => o.value)).toEqual(['a'])
    expect(filterMenuOptions(options, 'hero').map(o => o.value)).toEqual(['a'])
  })
})
