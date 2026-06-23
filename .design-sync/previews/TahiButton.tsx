import { TahiButton } from 'tahi-dashboard'

const wrap = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.625rem',
  alignItems: 'center',
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
} as const

const col = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
} as const

// Arrow SVG matching the Tahi brand trailing icon pattern
const ArrowSvg = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 6h7M6.5 3l3 3-3 3" />
  </svg>
)

const PlusSvg = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
    <path d="M6 2v8M2 6h8" />
  </svg>
)

export const Variants = () => (
  <div style={wrap}>
    <TahiButton variant="primary">Approve proposal</TahiButton>
    <TahiButton variant="secondary">Download invoice</TahiButton>
    <TahiButton variant="ghost">Dismiss</TahiButton>
    <TahiButton variant="danger">Cancel retainer</TahiButton>
  </div>
)

export const Sizes = () => (
  <div style={wrap}>
    <TahiButton variant="primary" size="sm">New request</TahiButton>
    <TahiButton variant="primary" size="md">New request</TahiButton>
    <TahiButton variant="primary" size="lg">New request</TahiButton>
    <TahiButton variant="secondary" size="sm">View invoice</TahiButton>
    <TahiButton variant="secondary" size="md">View invoice</TahiButton>
    <TahiButton variant="secondary" size="lg">View invoice</TahiButton>
  </div>
)

export const WithIcon = () => (
  <div style={wrap}>
    <TahiButton variant="primary" icon={<ArrowSvg />}>Send contract</TahiButton>
    <TahiButton variant="secondary" iconLeft={<PlusSvg />}>Add client</TahiButton>
    <TahiButton variant="ghost" icon={<ArrowSvg />}>View schedule</TahiButton>
    <TahiButton variant="danger" icon={<ArrowSvg />}>Archive project</TahiButton>
  </div>
)

export const Loading = () => (
  <div style={wrap}>
    <TahiButton variant="primary" loading>Saving changes</TahiButton>
    <TahiButton variant="secondary" loading>Syncing Xero</TahiButton>
    <TahiButton variant="danger" loading>Cancelling</TahiButton>
  </div>
)

export const Disabled = () => (
  <div style={wrap}>
    <TahiButton variant="primary" disabled>Approve proposal</TahiButton>
    <TahiButton variant="secondary" disabled>Download invoice</TahiButton>
    <TahiButton variant="ghost" disabled>Dismiss</TahiButton>
    <TahiButton variant="danger" disabled>Cancel retainer</TahiButton>
  </div>
)
