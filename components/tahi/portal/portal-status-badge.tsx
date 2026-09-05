/**
 * PortalStatusBadge - the client's status chip.
 *
 * Identical in shape and colour to the studio <StatusBadge> (both resolve
 * through REQUEST_STATUS_CONFIG, so a status is the same colour on both sides
 * of the wall, in both themes). The only difference is the WORD: it comes from
 * lib/portal-status, the one client vocabulary, and the plain-English gloss
 * rides along in the title so it reaches a pointer and a screen reader without
 * needing room in the chip.
 *
 * Used at the badge itself in the client list and the client request detail, so
 * adopting it is a mapping rather than a rewrite of either surface.
 */

import { cn } from '@/lib/utils'
import { portalStatusMeta, portalStatusTitle } from '@/lib/portal-status'

export function PortalStatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const meta = portalStatusMeta(status)
  return (
    <span
      className={cn('inline-flex items-center justify-center whitespace-nowrap', className)}
      title={portalStatusTitle(status)}
      style={{
        padding: '0.125rem 0.5rem',
        borderRadius: 'var(--radius-full, 9999px)',
        fontSize: 'var(--text-xs, 0.75rem)',
        fontWeight: 500,
        minWidth: '5.5rem',
        background: meta.bg,
        color: meta.text,
        border: `1px solid ${meta.border}`,
      }}
    >
      {meta.label}
    </span>
  )
}
