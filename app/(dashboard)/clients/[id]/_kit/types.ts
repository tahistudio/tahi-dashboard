/**
 * Shared row shapes for the client detail surface.
 *
 * Lifted verbatim out of client-detail.tsx so every tab and card imports one
 * copy instead of the 4,800-line file carrying them all. No field changed.
 */

export interface Contact {
  id: string
  name: string
  email: string
  role: string | null
  isPrimary: boolean
  clerkUserId: string | null
}

export interface Subscription {
  id: string
  planType: string
  status: string
  hasPrioritySupport: boolean
  hasSeoAddon: boolean
  billingInterval: string | null
  includedAddons: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  createdAt: string
}

export interface Track {
  id: string
  type: 'small' | 'large'
  isPriorityTrack: boolean
  currentRequestId: string | null
  currentRequestTitle?: string | null
}

export interface Organisation {
  id: string
  name: string
  website: string | null
  industry: string | null
  planType: string | null
  status: string
  healthStatus: string | null
  healthNote: string | null
  internalNotes: string | null
  brands: string | null
  tags: string | null
  preferredCurrency: string | null
  customMrr: number | null
  customMrrCurrency: string | null
  billingModel: string | null
  defaultHourlyRate: number | null
  retainerStartDate: string | null
  retainerEndDate: string | null
  /** How this client is billed: 'stripe' | 'xero', or null for the studio default. */
  invoiceChannel?: string | null
  /** When it is due: 'card' | 'net_7' | 'net_14' | 'net_30', or null. */
  paymentTerms?: string | null
  /** invoiceChannel resolved against the studio default; always a real rail. */
  effectiveInvoiceChannel?: string | null
  /** true when a user explicitly set the field; auto-derivation will not overwrite it. */
  billingModelIsManual?: boolean
  retainerDatesIsManual?: boolean
  customMrrIsManual?: boolean
  createdAt: string
  updatedAt: string
}

export interface Request {
  id: string
  title: string
  status: string
  type: string
  priority: string
  updatedAt: string
  createdAt: string
}

export interface ClientData {
  org: Organisation
  contacts: Contact[]
  subscription: Subscription | null
  tracks: Track[]
  recentRequests: Request[]
}
