/**
 * PortalStatusBadge - the client's status chip.
 *
 * Identical in shape and colour to the studio <StatusBadge> (both resolve
 * through REQUEST_STATUS_CONFIG, so a status is the same colour on both sides
 * of the wall, in both themes). The only difference is the WORD: it comes from
 * lib/portal-status, the one client vocabulary.
 *
 * The plain-English gloss rides an aria-label, not only a title. A title on a
 * non-interactive span is hover-only for a pointer, absent on touch and not
 * reliably announced, so on its own it reached almost nobody. Where there is
 * room the gloss is ALSO rendered as visible text beside the chip (see the
 * client branch of the request detail header); this is the floor, not the plan.
 *
 * `titled={false}` drops the title for the one case where the chip is nested
 * inside an element that already has its own: two titles on the same target
 * means the inner one wins and the outer one, which explains where the link
 * goes, never appears.
 *
 * Used at the badge itself in the client list and the client request detail, so
 * adopting it is a mapping rather than a rewrite of either surface.
 */

import { cn } from '@/lib/utils'
import { portalStatusMeta, portalStatusTitle } from '@/lib/portal-status'

export function PortalStatusBadge({
  status,
  className,
  titled = true,
}: {
  status: string
  className?: string
  /** Set false when an ancestor carries its own title attribute. */
  titled?: boolean
}) {
  const meta = portalStatusMeta(status)
  return (
    <span
      className={cn('inline-flex items-center justify-center whitespace-nowrap', className)}
      title={titled ? portalStatusTitle(status) : undefined}
      aria-label={portalStatusTitle(status)}
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
