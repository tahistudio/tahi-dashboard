// TEMP migration: stream one table's rows via rowid cursor pagination.
// GET /api/admin/migrate/db-export?table=X&afterRowid=N&limit=500

import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

function authOk(req: NextRequest): boolean {
  const h = req.headers.get('authorization')
  const t = h?.startsWith('Bearer ') ? h.slice(7) : null
  return !!(t && process.env.TAHI_API_TOKEN && t === process.env.TAHI_API_TOKEN)
}

const MAX_LIMIT = 1000
const DEFAULT_LIMIT = 500

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = req.nextUrl.searchParams
  const rawTable = params.get('table') ?? ''
  const table = rawTable.replace(/[^a-zA-Z0-9_]/g, '')
  if (!table || table !== rawTable) {
    return NextResponse.json({ error: 'Invalid table name' }, { status: 400 })
  }

  const afterRowid = Number(params.get('afterRowid') ?? '0') || 0
  const limit = Math.min(Number(params.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, MAX_LIMIT)

  const { env } = await getCloudflareContext({ async: true })
  if (!env?.DB) return NextResponse.json({ error: 'No DB binding' }, { status: 500 })

  // Confirm table exists
  const exists = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).bind(table).first<{ name: string }>()
  if (!exists) return NextResponse.json({ error: `Table not found: ${table}` }, { status: 404 })

  const res = await env.DB.prepare(
    `SELECT rowid AS __rowid, * FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`
  ).bind(afterRowid, limit).all<Record<string, unknown> & { __rowid: number }>()

  const rows = res.results ?? []
  const lastRowid = rows.length > 0 ? rows[rows.length - 1].__rowid : afterRowid
  const hasMore = rows.length === limit

  // Strip __rowid from payload before sending
  const cleanRows = rows.map(r => {
    const { __rowid: _drop, ...rest } = r
    return rest
  })

  return NextResponse.json({
    table,
    rows: cleanRows,
    count: cleanRows.length,
    nextAfterRowid: hasMore ? lastRowid : null,
  })
}
