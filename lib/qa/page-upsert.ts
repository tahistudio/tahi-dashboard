/**
 * Shared page upsert for the Site QA bulk add and the crawler. Server side
 * only (D1). Paths must already be normalised with normalisePath.
 */
import { eq, inArray } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { schema } from '@/db/d1'
import { computeGroups } from '@/lib/qa/grouping'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** qa_pages has 9 columns, so 10 rows is 90 bound params per insert (D1 cap is 100). */
const INSERT_CHUNK = 10
/** 3 SET values plus 90 ids stays under D1's 100 bound parameters per statement. */
const ID_CHUNK = 90

export interface PageUpsertResult { added: number; restored: number; skipped: number }

/**
 * Adds pages to one site. A path that is already active is skipped, a path
 * that was removed is restored, and any other path is inserted. Duplicates in
 * the input are counted once. Group keys are recomputed over every active page
 * on the site, so new pages join their template groups and existing pages in a
 * group that just grew are regrouped too. Removed pages are never deleted.
 */
export async function upsertSitePages(
  database: D1,
  siteId: string,
  paths: string[],
  source: 'manual' | 'crawl',
): Promise<PageUpsertResult> {
  const now = new Date().toISOString()
  const rows = await database.select().from(schema.qaPages).where(eq(schema.qaPages.siteId, siteId))
  const byPath = new Map(rows.map(r => [r.path, r]))

  const restoreSet = new Set<string>()
  const insertPaths: string[] = []
  let restored = 0
  let skipped = 0
  for (const path of new Set(paths)) {
    const row = byPath.get(path)
    if (row && !row.removedAt) {
      skipped++
    } else if (row) {
      restoreSet.add(path)
      restored++
    } else {
      insertPaths.push(path)
    }
  }

  const activePaths = rows.filter(r => !r.removedAt).map(r => r.path)
  const groups = computeGroups([...activePaths, ...restoreSet, ...insertPaths])

  // Existing rows whose group changes (or that are being restored), bucketed by
  // the new groupKey so each bucket is one UPDATE ... WHERE id IN (...).
  const regroup = new Map<string | null, string[]>()
  const addRegroup = (groupKey: string | null, id: string) => {
    const ids = regroup.get(groupKey)
    if (ids) ids.push(id)
    else regroup.set(groupKey, [id])
  }
  for (const row of rows) {
    if (row.removedAt) {
      if (restoreSet.has(row.path)) addRegroup(groups.get(row.path) ?? null, row.id)
      continue
    }
    const groupKey = groups.get(row.path) ?? null
    if (row.groupKey !== groupKey) addRegroup(groupKey, row.id)
  }

  const inserts: (typeof schema.qaPages.$inferInsert)[] = insertPaths.map(path => ({
    id: crypto.randomUUID(), siteId, path, groupKey: groups.get(path) ?? null, source,
    removedAt: null, createdAt: now, updatedAt: now,
  }))

  const statements: BatchItem<'sqlite'>[] = []
  for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
    statements.push(database.insert(schema.qaPages).values(inserts.slice(i, i + INSERT_CHUNK)))
  }
  for (const [groupKey, ids] of regroup) {
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      statements.push(database.update(schema.qaPages)
        .set({ groupKey, removedAt: null, updatedAt: now })
        .where(inArray(schema.qaPages.id, ids.slice(i, i + ID_CHUNK))))
    }
  }
  if (statements.length > 0) await database.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])

  return { added: inserts.length, restored, skipped }
}
