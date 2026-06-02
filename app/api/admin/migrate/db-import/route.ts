// TEMP migration: bulk-insert rows into one table using INSERT OR REPLACE (idempotent).
// POST /api/admin/migrate/db-import  body: { table: string, rows: Record<string, unknown>[] }

import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

function authOk(req: NextRequest): boolean {
  const h = req.headers.get('authorization')
  const t = h?.startsWith('Bearer ') ? h.slice(7) : null
  return !!(t && process.env.TAHI_API_TOKEN && t === process.env.TAHI_API_TOKEN)
}

const MAX_BATCH = 1000

export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let payload: { table?: string; rows?: Record<string, unknown>[] }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const rawTable = payload.table ?? ''
  const table = rawTable.replace(/[^a-zA-Z0-9_]/g, '')
  if (!table || table !== rawTable) {
    return NextResponse.json({ error: 'Invalid table name' }, { status: 400 })
  }
  const rows = payload.rows ?? []
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: 'rows must be an array' }, { status: 400 })
  }
  if (rows.length === 0) return NextResponse.json({ inserted: 0 })
  if (rows.length > MAX_BATCH) {
    return NextResponse.json({ error: `Batch too large (max ${MAX_BATCH})` }, { status: 400 })
  }

  const { env } = await getCloudflareContext({ async: true })
  if (!env?.DB) return NextResponse.json({ error: 'No DB binding' }, { status: 500 })

  const exists = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).bind(table).first<{ name: string }>()
  if (!exists) return NextResponse.json({ error: `Table not found: ${table}` }, { status: 404 })

  // Inspect column names actually present on dest so we only insert known cols
  const colsRes = await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{
    name: string
    notnull: number
    dflt_value: string | null
    pk: number
  }>()
  const validCols = new Set((colsRes.results ?? []).map(c => c.name))
  if (validCols.size === 0) {
    return NextResponse.json({ error: 'No columns found' }, { status: 500 })
  }

  // Use the union of columns present across rows AND valid dest cols
  const colOrder: string[] = []
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (validCols.has(k) && !colOrder.includes(k)) colOrder.push(k)
    }
  }
  if (colOrder.length === 0) {
    return NextResponse.json({ error: 'No matching columns between rows and table' }, { status: 400 })
  }

  const placeholders = colOrder.map(() => '?').join(', ')
  const colList = colOrder.map(c => `"${c}"`).join(', ')
  const sql = `INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${placeholders})`

  const stmts = rows.map(r => {
    const vals = colOrder.map(c => {
      const v = r[c]
      if (v === undefined) return null
      if (typeof v === 'boolean') return v ? 1 : 0
      return v
    })
    return env.DB.prepare(sql).bind(...vals)
  })

  // Disable FK enforcement BEFORE the batch (PRAGMAs inside a transaction are
  // silently ignored). exec() runs outside a transaction and the connection is
  // reused for the subsequent batch() call within this request.
  try {
    await env.DB.exec('PRAGMA foreign_keys = OFF')
  } catch {
    // Some D1 versions don't expose exec(); fall back to prepare().run()
    await env.DB.prepare('PRAGMA foreign_keys = OFF').run()
  }

  try {
    const results = await env.DB.batch(stmts)
    const inserted = results.reduce((s, r) => s + (r.meta?.changes ?? 0), 0)
    return NextResponse.json({ inserted, batches: results.length, cols: colOrder.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: 'Insert failed', details: msg }, { status: 500 })
  }
}
