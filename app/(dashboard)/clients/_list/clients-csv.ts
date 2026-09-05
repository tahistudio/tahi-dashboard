/**
 * CSV for whatever is on screen. Exporting the rows the user is looking at is
 * the only export that can be honest here: the endpoint pages at 50 and the
 * rail has already narrowed them, so a "download everything" button would
 * quietly hand over one page and call it everything.
 */

import { CLIENT_HEALTH_LABELS, CLIENT_STATUS_LABELS, ENGAGEMENT_LABEL, healthKeyOf, type ClientRow } from './clients-views'

function cell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function clientsToCsv(rows: readonly ClientRow[], includeMoney: boolean): string {
  const header = [
    'Name', 'Status', 'Plan', 'Engagement', 'Health', 'Open requests',
    'Tracks', 'Tags', 'Website', 'Industry', 'Last activity', 'Client since',
  ]
  if (includeMoney) header.splice(4, 0, 'MRR (NZD)')

  const lines = [header.map(cell).join(',')]
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
      row.tags.join(' | '),
      row.website ?? '',
      row.industry ?? '',
      row.updatedAt ?? '',
      row.createdAt ?? '',
    )
    lines.push(values.map(cell).join(','))
  }
  return lines.join('\n')
}

/** Hands the browser a file. Safe to call only from an event handler. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
