import { TahiLink } from 'tahi-dashboard'

const wrap = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.875rem',
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
} as const

const ArrowSvg = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2.5 6h7M6.5 3l3 3-3 3" />
  </svg>
)

export const BrandTone = () => (
  <div style={wrap}>
    <TahiLink href="#" tone="brand">View proposal</TahiLink>
    <TahiLink href="#" tone="brand" icon={<ArrowSvg />}>Download retainer agreement</TahiLink>
    <TahiLink href="#" tone="brand">Acme Co invoice INV-0042</TahiLink>
    <TahiLink href="#" tone="brand" icon={<ArrowSvg />}>Open in Xero</TahiLink>
  </div>
)

const darkFrame = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.875rem',
  padding: '1.25rem',
  background: '#1e2a1b',
  borderRadius: 'var(--radius-md)',
} as const

export const OnDark = () => (
  <div style={darkFrame}>
    <TahiLink href="#" tone="on-dark">View schedule</TahiLink>
    <TahiLink href="#" tone="on-dark" icon={<ArrowSvg />}>Liam Miller — project lead</TahiLink>
    <TahiLink href="#" tone="on-dark">Browse Tahi service catalogue</TahiLink>
  </div>
)

const limeFrame = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.875rem',
  padding: '1.25rem',
  background: 'var(--color-accent)',
  borderRadius: 'var(--radius-md)',
} as const

export const OnLime = () => (
  <div style={limeFrame}>
    <TahiLink href="#" tone="on-lime">Start free trial</TahiLink>
    <TahiLink href="#" tone="on-lime" icon={<ArrowSvg />}>See how we build in Webflow</TahiLink>
  </div>
)
