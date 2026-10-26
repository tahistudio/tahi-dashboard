import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { QA_COMMENTS_MIGRATION, SITE_QA_MIGRATION } from '@/lib/qa-migration'

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
