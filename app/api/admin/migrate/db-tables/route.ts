// TEMP migration: list every user table + row count. Delete with the rest of /migrate/*.

import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'

function authOk(req: NextRequest): boolean {
  const h = req.headers.get('authorization')
  const t = h?.startsWith('Bearer ') ? h.slice(7) : null
  return !!(t && process.env.TAHI_API_TOKEN && t === process.env.TAHI_API_TOKEN)
}

export async function GET(req: NextRequest) {
  if (!authOk(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { env } = await getCloudflareContext({ async: true })
  if (!env?.DB) return NextResponse.json({ error: 'No DB binding' }, { status: 500 })

  const tablesRes = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%' ORDER BY name"
  ).all<{ name: string }>()

  const tables: { name: string; rowCount: number }[] = []
  for (const row of tablesRes.results ?? []) {
    const safe = row.name.replace(/[^a-zA-Z0-9_]/g, '')
    if (safe !== row.name) continue
    const c = await env.DB.prepare(`SELECT COUNT(*) as n FROM "${safe}"`).first<{ n: number }>()
    tables.push({ name: safe, rowCount: c?.n ?? 0 })
  }

  return NextResponse.json({
    total: tables.reduce((s, t) => s + t.rowCount, 0),
    tables,
  })
}
