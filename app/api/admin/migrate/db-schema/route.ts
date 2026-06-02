// TEMP migration: dump every CREATE TABLE / CREATE INDEX from sqlite_master.
// GET /api/admin/migrate/db-schema -> { statements: string[] }

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

  // Pull every table + index DDL except SQLite internals and Cloudflare internals.
  // Tables before indexes so dest can apply in order without FK / target-missing errors.
  const tables = await env.DB.prepare(
    `SELECT name, sql FROM sqlite_master
     WHERE type = 'table'
       AND sql IS NOT NULL
       AND name NOT LIKE 'sqlite_%'
       AND name NOT LIKE 'd1_%'
       AND name NOT LIKE '_cf_%'
     ORDER BY name`
  ).all<{ name: string; sql: string }>()

  const indexes = await env.DB.prepare(
    `SELECT name, tbl_name, sql FROM sqlite_master
     WHERE type = 'index'
       AND sql IS NOT NULL
       AND tbl_name NOT LIKE 'sqlite_%'
       AND tbl_name NOT LIKE 'd1_%'
       AND tbl_name NOT LIKE '_cf_%'
     ORDER BY tbl_name, name`
  ).all<{ name: string; tbl_name: string; sql: string }>()

  const stripFk = req.nextUrl.searchParams.get('stripFk') === '1'

  // Normalize: add IF NOT EXISTS so apply is idempotent
  const tableStatements = (tables.results ?? []).map(r => {
    let s = r.sql.replace(/^\s*CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ')
    if (stripFk) {
      // Identifier: backtick-quoted, double-quoted, or bare
      const ID = '(?:`[^`]+`|"[^"]+"|\\w+)'
      // ON DELETE/UPDATE action clauses (chainable)
      const ON = '(?:\\s+ON\\s+(?:DELETE|UPDATE)\\s+(?:CASCADE|SET\\s+NULL|SET\\s+DEFAULT|RESTRICT|NO\\s+ACTION))'
      // Strip table-level FOREIGN KEY first (more specific). If we ran the
      // inline REFERENCES strip first it would partially destroy these matches.
      s = s.replace(new RegExp(`,\\s*FOREIGN\\s+KEY\\s*\\([^)]+\\)\\s+REFERENCES\\s+${ID}\\s*\\([^)]+\\)${ON}*`, 'gi'), '')
      // Then strip any remaining inline column-level REFERENCES
      s = s.replace(new RegExp(`\\s+REFERENCES\\s+${ID}\\s*\\([^)]+\\)${ON}*`, 'gi'), '')
    }
    return s
  })
  const indexStatements = (indexes.results ?? []).map(r =>
    r.sql.replace(/^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+/i, (_m, u) =>
      `CREATE ${u ?? ''}INDEX IF NOT EXISTS `
    )
  )

  return NextResponse.json({
    tableCount: tableStatements.length,
    indexCount: indexStatements.length,
    statements: [...tableStatements, ...indexStatements],
  })
}
