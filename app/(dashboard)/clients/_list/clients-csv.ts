/**
 * CSV for whatever is on screen. Exporting the rows the user is looking at is
 * the only export that can be honest here: the endpoint pages at 50 and the
 * rail has already narrowed them, so a "download everything" button would
 * quietly hand over one page and call it everything.
 *
 * The quoting, the byte order mark and the formula guard all live in
 * lib/csv.ts, so this file only decides which columns a client has.
 */

import { toCsv } from '@/lib/csv'
import { CLIENT_HEALTH_LABELS, CLIENT_STATUS_LABELS, ENGAGEMENT_LABEL, healthKeyOf, type ClientRow } from './clients-views'

export { downloadCsv } from '@/lib/csv'

export function clientsToCsv(rows: readonly ClientRow[], includeMoney: boolean): string {
  const header = [
    'Name', 'Status', 'Plan', 'Engagement', 'Health', 'Open requests',
    'Tracks', 'Owner', 'Tags', 'Website', 'Industry', 'Last activity', 'Client since',
  ]
  if (includeMoney) header.splice(4, 0, 'MRR (NZD)')

  const lines: (string | number | null)[][] = [header]
  for (const row of rows) {
    const values: (string | number | null)[] = [
      row.name,
      CLIENT_STATUS_LABELS[row.status] ?? row.status,
      row.planType ?? 'No plan',
      ENGAGEMENT_LABEL[row.engagement],
    ]
    if (includeMoney) values.push(row.mrrNzd ?? '')
    values.push(
      CLIENT_HEALTH_LABELS[healthKeyOf(row)],
      row.openRequestCount,
      row.tracks.total,
      row.ownerName ?? '',
      row.tags.join(' | '),
      row.website ?? '',
      row.industry ?? '',
      row.updatedAt ?? '',
      row.createdAt ?? '',
    )
    lines.push(values)
  }
  return toCsv(lines)
}
