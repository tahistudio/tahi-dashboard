import { Badge } from '@/components/tahi/badge'
import { invoicePayState, invoiceRailLabel, type InvoicePayFields } from '@/lib/invoice-pay-state'

export function RailChip({ invoice, full = false }: { invoice: InvoicePayFields; full?: boolean }) {
  const pay = invoicePayState(invoice)
  const label = `${invoiceRailLabel(invoice)}, ${pay.short}`
  return <Badge tone={pay.tone} title={pay.long} aria-label={full ? `${label}. ${pay.long}` : label}>{label}</Badge>
}
