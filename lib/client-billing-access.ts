/** Billing-card fields must not escape through general client projections. */
export const CLIENT_BILLING_FIELDS = new Set([
  'customMrr', 'customMrrCurrency', 'customMrrIsManual', 'billingModel', 'billingModelIsManual',
  'defaultHourlyRate', 'internalNotes',
])

export function clientBillingField(key: string): boolean {
  return CLIENT_BILLING_FIELDS.has(key) || /^(stripe|xero)/i.test(key)
}

export function clientProjection(row: object, billingAllowed: boolean): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => billingAllowed || !clientBillingField(key)))
}
