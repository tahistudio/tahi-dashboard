/**
 * Which channel raised an invoice: Manual, Xero or Stripe.
 *
 * Lives on its own so the list and the detail page cannot drift. They did:
 * the list badged the real source while the detail page said "Manual" for
 * every invoice, because the admin detail route never selected the column.
 */
import { Badge, type BadgeTone } from '@/components/tahi/badge'

const SOURCE_TONE: Record<string, { label: string; tone: BadgeTone }> = {
  manual: { label: 'Manual', tone: 'neutral' },
  xero:   { label: 'Xero',   tone: 'teal'    },
  stripe: { label: 'Stripe', tone: 'purple'  },
}

export function SourceBadge({ source }: { source: string | null }) {
  const cfg = SOURCE_TONE[source ?? 'manual'] ?? SOURCE_TONE['manual']
  return <Badge tone={cfg.tone} variant="soft" size="sm">{cfg.label}</Badge>
}
