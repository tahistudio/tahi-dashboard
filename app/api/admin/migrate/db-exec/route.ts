// TEMP migration: run an array of SQL statements against the local D1 binding.
// POST /api/admin/migrate/db-exec  body: { statements: string[] }
// Returns per-statement success/error.

import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

function authOk(req: NextRequest): boolean {
  const h = req.headers.get('authorization')
  const t = h?.startsWith('Bearer ') ? h.slice(7) : null
  return !!(t && process.env.TAHI_API_TOKEN && t === process.env.TAHI_API_TOKEN)
}

export async function POST(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let payload: { statements?: unknown }
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!Array.isArray(payload.statements)) {
    return NextResponse.json({ error: 'statements must be an array of strings' }, { status: 400 })
  }
  const stmts = payload.statements as unknown[]
  for (const s of stmts) {
    if (typeof s !== 'string') {
      return NextResponse.json({ error: 'every statement must be a string' }, { status: 400 })
    }
  }

  const { env } = await getCloudflareContext({ async: true })
  if (!env?.DB) return NextResponse.json({ error: 'No DB binding' }, { status: 500 })

  const results: { ok: boolean; error?: string; statement: string }[] = []
  for (const sql of stmts as string[]) {
    try {
      await env.DB.prepare(sql).run()
      results.push({ ok: true, statement: sql.slice(0, 80) })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      results.push({ ok: false, error: msg, statement: sql.slice(0, 80) })
    }
  }

  const okCount = results.filter(r => r.ok).length
  const failCount = results.length - okCount
  return NextResponse.json({
    total: results.length,
    ok: okCount,
    failed: failCount,
    results: failCount > 0 ? results.filter(r => !r.ok) : undefined,
  })
}
