/**
 * A Drizzle stand-in that actually FILTERS and actually MUTATES.
 *
 * The import cleanup's double returns every row of a table whatever the where
 * clause says, which is fine for "did it try to delete this table" but useless
 * for a merge: the whole question there is whether the right rows moved to the
 * right place. So this one evaluates the predicate and applies updates and
 * deletes to the row store, which lets a test assert on the data afterwards
 * rather than on the calls.
 *
 * The fake schema names every column with its DRIZZLE PROPERTY (orgId, not
 * org_id) so `.set({ orgId: x })` and `eq(handle.column, ...)` agree. The SQL
 * names are pinned separately, against db/schema.ts, in policy.test.ts.
 */

export interface RecordedUpdate {
  table: string
  values: Record<string, unknown>
  rows: number
}

export interface RecordedDelete {
  table: string
  rows: number
}

export interface Recorded {
  updates: RecordedUpdate[]
  deletes: RecordedDelete[]
  /** Every write in the order it happened, for the ordering assertions. */
  events: Array<{ kind: 'update' | 'delete'; table: string; values?: Record<string, unknown> }>
}

export function emptyRecorded(): Recorded {
  return { updates: [], deletes: [], events: [] }
}

export type Row = Record<string, unknown>
export type RowStore = Record<string, Row[]>

interface Pred {
  op: 'eq' | 'and' | 'or' | 'in' | 'isNull'
  col?: string
  value?: unknown
  values?: unknown[]
  parts?: Array<Pred | undefined>
}

/** The drizzle-orm module double. Predicates become plain, readable objects. */
export function drizzleStub() {
  const sqlFn = (...args: unknown[]) => ({ sql: args })
  return {
    eq: (col: unknown, value: unknown): Pred => ({ op: 'eq', col: String(col), value }),
    inArray: (col: unknown, values: unknown[]): Pred => ({ op: 'in', col: String(col), values }),
    isNull: (col: unknown): Pred => ({ op: 'isNull', col: String(col) }),
    and: (...parts: Array<Pred | undefined>): Pred => ({ op: 'and', parts }),
    or: (...parts: Array<Pred | undefined>): Pred => ({ op: 'or', parts }),
    sql: Object.assign(sqlFn, { raw: sqlFn }),
  }
}

function matches(row: Row, pred: Pred | undefined): boolean {
  if (!pred) return true
  switch (pred.op) {
    case 'eq':
      return row[pred.col as string] === pred.value
    case 'in':
      return (pred.values ?? []).includes(row[pred.col as string])
    case 'isNull': {
      const value = row[pred.col as string]
      return value === null || value === undefined
    }
    case 'and':
      return (pred.parts ?? []).every((part) => matches(row, part))
    case 'or':
      return (pred.parts ?? []).some((part) => part !== undefined && matches(row, part))
    default:
      return true
  }
}

function tableName(table: unknown): string {
  return (table as { __table?: string })?.__table ?? 'unknown'
}

/** A fake table whose every column is named after its Drizzle property. */
export function fakeTable(name: string, columns: readonly string[]): Record<string, string> {
  const out: Record<string, string> = { __table: name }
  for (const column of ['id', ...columns]) out[column] = column
  return out
}

interface QueryBuilder {
  where: (pred?: Pred) => QueryBuilder
  limit: (n: number) => QueryBuilder
  then: <T>(resolve: (value: Row[]) => T, reject?: (reason: unknown) => unknown) => Promise<T | unknown>
}

function makeQuery(store: RowStore, table: string, projection: Record<string, unknown> | undefined, pred: Pred | undefined, take?: number): QueryBuilder {
  const run = (): Row[] => {
    let rows = (store[table] ?? []).filter((row) => matches(row, pred))
    if (take !== undefined) rows = rows.slice(0, take)
    if (!projection) return rows.map((row) => ({ ...row }))
    return rows.map((row) => {
      const out: Row = {}
      for (const [key, column] of Object.entries(projection)) out[key] = row[String(column)]
      return out
    })
  }
  return {
    where: (next?: Pred) => makeQuery(store, table, projection, next, take),
    limit: (n: number) => makeQuery(store, table, projection, pred, n),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  }
}

/**
 * The database double. `store` is live: a test seeds it, runs the operation,
 * then reads it back to see where the rows ended up.
 */
export function makeFakeDb(store: RowStore, recorded: Recorded) {
  return {
    select: (projection?: Record<string, unknown>) => ({
      from: (table: unknown) => makeQuery(store, tableName(table), projection, undefined),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (pred?: Pred) => {
          const name = tableName(table)
          let count = 0
          for (const row of store[name] ?? []) {
            if (!matches(row, pred)) continue
            Object.assign(row, values)
            count += 1
          }
          recorded.updates.push({ table: name, values, rows: count })
          recorded.events.push({ kind: 'update', table: name, values })
          return Promise.resolve(undefined)
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: (pred?: Pred) => {
        const name = tableName(table)
        const before = store[name] ?? []
        const kept = before.filter((row) => !matches(row, pred))
        recorded.deletes.push({ table: name, rows: before.length - kept.length })
        recorded.events.push({ kind: 'delete', table: name })
        store[name] = kept
        return Promise.resolve(undefined)
      },
    }),
    // No `all` / `run`: the billing columns live outside the Drizzle schema and
    // their raw-SQL read is guarded, so a double without them must still work.
  }
}

/** The tables a run deleted from, in order, for the ordering assertions. */
export function deletedTables(recorded: Recorded): string[] {
  return recorded.deletes.map((row) => row.table)
}
