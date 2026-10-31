import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { QA_BROWSERS_MIGRATION, QA_COMMENT_NOTES_MIGRATION, QA_COMMENT_CONTEXT_MIGRATION, QA_COMMENTS_MIGRATION, SITE_QA_MIGRATION } from '@/lib/qa-migration'

describe('site QA migration 0115', () => {
  it('does not create the old two column scan index, which 0118 replaces (a rerun of 0115 must not bring it back)', () => {
    expect(SITE_QA_MIGRATION.some(s => s.includes('idx_qa_scan_results_page_vp '))).toBe(false)
    expect(readFileSync('drizzle/migrations/0115_site_qa.sql', 'utf8')).not.toContain('idx_qa_scan_results_page_vp ')
  })
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

describe('site QA comment notes migration 0119', () => {
  it('is additive and re-run safe', () => {
    for (const s of QA_COMMENT_NOTES_MIGRATION) expect(s).toMatch(/IF NOT EXISTS/)
  })
  it('the SQL file carries every statement and says to apply before deploying', () => {
    const raw = readFileSync('drizzle/migrations/0119_qa_comment_notes.sql', 'utf8')
    const sql = raw.replace(/s+/g, ' ')
    for (const s of QA_COMMENT_NOTES_MIGRATION) expect(sql).toContain(s.replace(/s+/g, ' '))
    expect(raw).toContain('Apply BEFORE deploying')
  })
  it('is registered in the migrate runner', () => {
    const route = readFileSync('app/api/admin/db/migrate/route.ts', 'utf8')
    expect(route).toContain("name: '0119'")
    expect(route).toContain('QA_COMMENT_NOTES_MIGRATION')
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

describe('site QA browsers migration 0118', () => {
  const sqlFile = () => readFileSync('drizzle/migrations/0118_qa_browsers.sql', 'utf8')

  it('adds the browser columns and the tick table, and only guards what SQLite can guard', () => {
    expect(QA_BROWSERS_MIGRATION).toContain(`ALTER TABLE qa_rounds ADD COLUMN browsers text NOT NULL DEFAULT '["chromium"]'`)
    expect(QA_BROWSERS_MIGRATION).toContain(`ALTER TABLE qa_scan_results ADD COLUMN browser text NOT NULL DEFAULT 'chromium'`)
    expect(QA_BROWSERS_MIGRATION).toContain(`ALTER TABLE qa_comments ADD COLUMN browser text NOT NULL DEFAULT 'chromium'`)
    for (const s of QA_BROWSERS_MIGRATION) {
      if (s.startsWith('ALTER TABLE')) expect(s).toMatch(/ADD COLUMN \w+ text NOT NULL DEFAULT /)
      else expect(s).toMatch(/IF NOT EXISTS|IF EXISTS/)
    }
    expect(QA_BROWSERS_MIGRATION.some(s => s.includes('CREATE TABLE IF NOT EXISTS qa_browser_ticks'))).toBe(true)
  })
  it('creates the new scan index before it drops the old one, so uniqueness never lapses', () => {
    const create = QA_BROWSERS_MIGRATION.findIndex(s => s.includes('idx_qa_scan_results_page_vp_browser'))
    const drop = QA_BROWSERS_MIGRATION.findIndex(s => s.startsWith('DROP INDEX') && s.includes('idx_qa_scan_results_page_vp'))
    const addColumn = QA_BROWSERS_MIGRATION.findIndex(s => s.startsWith('ALTER TABLE qa_scan_results'))
    expect(addColumn).toBeGreaterThanOrEqual(0)
    expect(create).toBeGreaterThan(addColumn)
    expect(drop).toBeGreaterThan(create)
  })
  it('the SQL file carries every statement and has no double hyphens', () => {
    const sql = sqlFile().replace(/\s+/g, ' ')
    for (const s of QA_BROWSERS_MIGRATION) expect(sql).toContain(`${s.replace(/\s+/g, ' ')};`)
    expect(sqlFile()).not.toContain('--')
  })
  it('is registered in the migrate runner, which tolerates a duplicate column', () => {
    const route = readFileSync('app/api/admin/db/migrate/route.ts', 'utf8')
    expect(route).toContain("name: '0118'")
    expect(route).toContain('QA_BROWSERS_MIGRATION')
  })
})
