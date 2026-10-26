import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { QA_COMMENT_CONTEXT_MIGRATION, QA_COMMENTS_MIGRATION, SITE_QA_MIGRATION } from '@/lib/qa-migration'

describe('site QA migration 0115', () => {
  it('is additive and re-run safe', () => {
    for (const s of SITE_QA_MIGRATION) expect(s).toMatch(/IF NOT EXISTS/)
  })
  it('the SQL file carries every statement', () => {
    const sql = readFileSync('drizzle/migrations/0115_site_qa.sql', 'utf8').replace(/\s+/g, ' ')
    for (const s of SITE_QA_MIGRATION) expect(sql).toContain(s.replace(/\s+/g, ' '))
  })
})

describe('site QA comments migration 0116', () => {
  it('is additive and re-run safe', () => {
    for (const s of QA_COMMENTS_MIGRATION) expect(s).toMatch(/IF NOT EXISTS/)
  })
  it('the SQL file carries every statement', () => {
    const sql = readFileSync('drizzle/migrations/0116_qa_comments.sql', 'utf8').replace(/\s+/g, ' ')
    for (const s of QA_COMMENTS_MIGRATION) expect(sql).toContain(s.replace(/\s+/g, ' '))
  })
})

describe('site QA comment context migration 0117', () => {
  it('only adds the element_context column', () => {
    expect(QA_COMMENT_CONTEXT_MIGRATION).toEqual(['ALTER TABLE qa_comments ADD COLUMN element_context text'])
  })
  it('the SQL file carries every statement', () => {
    const sql = readFileSync('drizzle/migrations/0117_qa_comment_context.sql', 'utf8').replace(/\s+/g, ' ')
    for (const s of QA_COMMENT_CONTEXT_MIGRATION) expect(sql).toContain(s.replace(/\s+/g, ' '))
  })
  it('is registered in the migrate runner, which tolerates a duplicate column', () => {
    const route = readFileSync('app/api/admin/db/migrate/route.ts', 'utf8')
    expect(route).toContain("name: '0117'")
    expect(route).toContain('QA_COMMENT_CONTEXT_MIGRATION')
    expect(route).toContain('duplicate column name')
  })
})
