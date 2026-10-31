import { describe, it, expect } from 'vitest'
import { groupNotes, parseNoteInput, rowToComment, toCommentDetail, type CommentRow, type NoteRow } from '@/lib/qa/comments'
import { categorySummaries, parseStoredPageSpeed, reportCategoryTotals } from '@/lib/qa/category-summary'
import type { QaIssue, QaPageCounts } from '@/lib/qa/types'

const commentRow: CommentRow = {
  id: 'c_1', roundPageId: 'rp_1', viewport: 'desktop', browser: 'chromium', selector: 'h1', ox: 0.5, oy: 0.5,
  elementTag: 'h1', elementText: 'Hi', body: 'Fix', status: 'open', requestId: null, authorId: null, authorName: null,
  createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z', resolvedAt: null, elementContext: null,
}

function note(over: Partial<NoteRow> & { id: string }): NoteRow {
  return { commentId: 'c_1', body: 'n', authorId: null, authorName: null, source: 'dashboard', createdAt: '2026-10-30T01:00:00.000Z', ...over }
}

describe('parseNoteInput', () => {
  it('trims and accepts 1 to 4000 characters', () => {
    expect(parseNoteInput({ body: '  hi  ' })).toEqual({ ok: true, value: { body: 'hi', resolve: false } })
    expect(parseNoteInput({ body: 'x'.repeat(4000) }).ok).toBe(true)
  })
  it('rejects empty, long, non text and non object input', () => {
    expect(parseNoteInput({ body: '   ' }).ok).toBe(false)
    expect(parseNoteInput({ body: 'x'.repeat(4001) }).ok).toBe(false)
    expect(parseNoteInput({ body: 3 }).ok).toBe(false)
    expect(parseNoteInput(null).ok).toBe(false)
    expect(parseNoteInput([]).ok).toBe(false)
  })
  it('reads resolve only as a boolean', () => {
    expect(parseNoteInput({ body: 'a', resolve: true })).toEqual({ ok: true, value: { body: 'a', resolve: true } })
    expect(parseNoteInput({ body: 'a', resolve: 'true' }).ok).toBe(false)
  })
})

describe('groupNotes and comment payloads', () => {
  it('groups by comment, oldest first, ties by id, unknown sources read as dashboard', () => {
    const grouped = groupNotes([
      note({ id: 'b', createdAt: '2026-10-30T02:00:00.000Z' }),
      note({ id: 'z', createdAt: '2026-10-30T01:00:00.000Z', source: 'odd' }),
      note({ id: 'a', createdAt: '2026-10-30T01:00:00.000Z', source: 'mcp' }),
      note({ id: 'o', commentId: 'c_2' }),
    ])
    expect(grouped.get('c_1')?.map(n => [n.id, n.source])).toEqual([['a', 'mcp'], ['z', 'dashboard'], ['b', 'dashboard']])
    expect(grouped.get('c_2')).toHaveLength(1)
  })

  it('carries notes and noteCount on the comment and on the detail', () => {
    const notes = [...(groupNotes([note({ id: 'a' }), note({ id: 'b', createdAt: '2026-10-30T02:00:00.000Z' })]).get('c_1') ?? [])]
    const comment = rowToComment(commentRow, notes)
    expect(comment.noteCount).toBe(2)
    expect(comment.notes.map(n => n.id)).toEqual(['a', 'b'])
    expect(rowToComment(commentRow)).toMatchObject({ notes: [], noteCount: 0 })

    const detail = toCommentDetail(commentRow, 1, '/', {
      roundId: 'r', roundName: 'R', siteName: 'S', target: 'staging', siteUrl: 'https://s.test',
    }, notes)
    expect(detail.noteCount).toBe(2)
    expect(detail.pageUrl).toBe('https://s.test/')
  })
})

describe('categorySummaries', () => {
  const issues: Pick<QaIssue, 'category' | 'severity'>[] = [
    { category: 'a11y', severity: 'fail' },
    { category: 'a11y', severity: 'warn' },
    { category: 'seo', severity: 'info' },
    { category: 'perf', severity: 'warn' },
    { category: 'launch', severity: 'fail' },
  ]
  it('counts every category the issue panel has, totals matching its tab counts', () => {
    const s = categorySummaries(issues)
    expect(s.a11y).toEqual({ total: 2, fail: 1, warn: 1, info: 0 })
    expect(s.links).toEqual({ total: 0, fail: 0, warn: 0, info: 0 })
    expect(s.seo.total).toBe(1)
    expect(s.launch.fail).toBe(1)
    expect(s.perf.total).toBe(1)
    expect(Object.keys(s).sort()).toEqual(['a11y', 'launch', 'links', 'perf', 'seo'])
  })
})

describe('parseStoredPageSpeed', () => {
  it('returns the strategies present and null for empty or bad input', () => {
    const psi = { score: 88, lcpMs: 1200, cls: 0.01, inpMs: null, tbtMs: 50, source: 'lab', fetchedAt: 'x' }
    expect(parseStoredPageSpeed(JSON.stringify({ mobile: psi }))).toEqual({ mobile: psi })
    expect(parseStoredPageSpeed(JSON.stringify({ mobile: psi, desktop: psi }))?.desktop).toEqual(psi)
    expect(parseStoredPageSpeed(null)).toBeNull()
    expect(parseStoredPageSpeed('{')).toBeNull()
    expect(parseStoredPageSpeed('[]')).toBeNull()
    expect(parseStoredPageSpeed('{}')).toBeNull()
  })
})

describe('reportCategoryTotals', () => {
  const counts = (over: Partial<QaPageCounts>): QaPageCounts => ({
    a11yCritical: 0, a11ySerious: 0, a11yModerate: 0, a11yMinor: 0, brokenLinks: 0, seoIssues: 0, launchIssues: 0, perfIssues: 0, ...over,
  })
  it('sums each category across pages and skips unscanned pages', () => {
    const t = reportCategoryTotals([
      counts({ a11yCritical: 1, a11ySerious: 2, a11yModerate: 3, a11yMinor: 4, brokenLinks: 2, seoIssues: 1 }),
      null,
      counts({ a11yCritical: 1, launchIssues: 5, perfIssues: 6 }),
    ])
    expect(t.a11y).toEqual({ critical: 2, serious: 2, moderate: 3, minor: 4, total: 11 })
    expect(t).toMatchObject({ links: 2, seo: 1, launch: 5, performance: 6 })
  })
})
