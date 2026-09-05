/**
 * The one CSV writer. Every browser-side export in the dashboard goes through
 * here so the third surface cannot invent a fourth set of rules.
 *
 * Three things are not optional, and each of them exists because of a real
 * failure rather than a preference:
 *
 * 1. The byte order mark. Without it Excel reads a UTF-8 file as the system
 *    codepage and mangles a client name; macrons are routine in NZ names, so
 *    this is the common case and not the edge case.
 * 2. CRLF line endings, which is what the spec says and what Excel expects.
 * 3. A guard on the four characters a spreadsheet treats as the start of a
 *    formula. A client called "=Sum Studio" must not become a live cell.
 *
 * Numbers are never touched by the guard: a negative figure has to survive the
 * round trip as a number, so only strings can be prefixed.
 */

/** The mark Excel wants before it will read UTF-8. Built from its code point
 *  rather than pasted in, because an invisible character in source survives
 *  exactly one careless edit. */
export const CSV_BOM = String.fromCharCode(0xFEFF)

const FORMULA_LEAD = /^[=+\-@\t\r]/

/**
 * One field, quoted. Every field is quoted rather than only the ones that need
 * it: a name with a comma is normal, and a reader that has to decide is a
 * reader that can be wrong.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (typeof value === 'number') return `"${value}"`
  const text = String(value ?? '')
  // A leading =, +, - or @ makes a spreadsheet evaluate the cell. The
  // apostrophe is the standard neutraliser and does not show in the cell.
  const safe = FORMULA_LEAD.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

/** Rows of raw values to one CSV body. */
export function toCsv(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n')
}

/**
 * Hands the browser a file. Safe to call only from an event handler, and only
 * in the browser: it reaches for `document`.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`${CSV_BOM}${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
