import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { drizzle, type AnyD1Database } from 'drizzle-orm/d1'
import { getTableName } from 'drizzle-orm'
import { getTableConfig, type AnySQLiteTable } from 'drizzle-orm/sqlite-core'

/** Execute real route SQL without production data, credentials or external services. */
export function permissionSqlite(tables: AnySQLiteTable[], migrationSql: readonly string[] = []) {
  const sqlite = new DatabaseSync(':memory:')
  const queries: string[] = []
  const errors: string[] = []
  for (const table of tables) {
    const { name, columns } = getTableConfig(table)
    sqlite.exec(`CREATE TABLE "${name}" (${columns.map(column =>
      `"${column.name}" ${column.getSQLType()}`,
    ).join(', ')})`)
  }
  for (const statement of migrationSql) sqlite.exec(statement)
  const adapter = {
    prepare(query: string) {
      queries.push(query)
      try {
        const statement = sqlite.prepare(query)
        const bind = (...params: SQLInputValue[]) => ({
          async all() { return { results: statement.all(...params) } },
          async raw() { return statement.all(...params).map(Object.values) },
          async run() { statement.run(...params); return { success: true } },
        })
        return { bind, ...bind() }
      } catch (error) {
        errors.push(String(error))
        throw error
      }
    },
  }
  return {
    database: drizzle(adapter as unknown as AnyD1Database),
    queries,
    errors,
    insert(table: AnySQLiteTable, values: Record<string, SQLInputValue>) {
      const keys = Object.keys(values)
      sqlite.prepare(`INSERT INTO "${getTableName(table)}" (${keys.map(key =>
        `"${key}"`,
      ).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...Object.values(values))
    },
    rows(table: AnySQLiteTable) {
      return sqlite.prepare(`SELECT * FROM "${getTableName(table)}"`).all()
    },
    close() { sqlite.close() },
  }
}
