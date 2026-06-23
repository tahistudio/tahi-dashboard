import { FileAttachmentList } from 'tahi-dashboard'

const frame = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
  width: '32rem',
  maxWidth: '100%',
} as const

const label = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
} as const

const noop = () => {}

const deliverables = [
  { id: 'd1', name: 'homepage-v3.fig', sizeBytes: 8_460_000, uploadedBy: 'Staci Bonnie', url: '#' },
  { id: 'd2', name: 'acme-brand-guide.pdf', sizeBytes: 2_140_000, uploadedBy: 'Anna Okafor', url: '#' },
  { id: 'd3', name: 'hero-export.png', sizeBytes: 612_000, mime: 'image/png', uploadedBy: 'Staci Bonnie', url: '#' },
  { id: 'd4', name: 'copy-deck.docx', sizeBytes: 48_000, uploadedBy: 'Liam Miller', url: '#' },
]

export const List = () => (
  <div style={frame}>
    <FileAttachmentList items={deliverables} />
  </div>
)

export const WithActions = () => (
  <div style={frame}>
    <FileAttachmentList
      items={deliverables}
      onPreview={noop}
      onDownload={noop}
    />
  </div>
)

export const Removable = () => (
  <div style={frame}>
    <span style={label}>Staged for a message (removable)</span>
    <FileAttachmentList items={deliverables.slice(0, 3)} onRemove={noop} />
  </div>
)

export const Grid = () => (
  <div style={frame}>
    <span style={label}>Image-heavy grid</span>
    <FileAttachmentList
      variant="grid"
      items={[
        { id: 'g1', name: 'hero-export.png', sizeBytes: 612_000, mime: 'image/png' },
        { id: 'g2', name: 'mobile-hero.png', sizeBytes: 488_000, mime: 'image/png' },
        { id: 'g3', name: 'pricing-block.jpg', sizeBytes: 320_000, mime: 'image/jpeg' },
        { id: 'g4', name: 'logo-lockup.svg', sizeBytes: 7_400, mime: 'image/svg+xml' },
      ]}
    />
  </div>
)

export const Overflow = () => (
  <div style={frame}>
    <span style={label}>Capped at 3 with overflow summary</span>
    <FileAttachmentList items={deliverables} maxItems={3} />
  </div>
)
