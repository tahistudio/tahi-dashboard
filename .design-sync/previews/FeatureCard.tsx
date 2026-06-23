import { FeatureCard, TahiButton } from 'tahi-dashboard'

const frame = {
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '1rem',
}

/** Forest variant — AI briefing card */
export const Forest = () => (
  <div style={{ ...frame, maxWidth: '26rem' }}>
    <FeatureCard variant="forest" padding="lg">
      <FeatureCard.Eyebrow>AI briefing</FeatureCard.Eyebrow>
      <FeatureCard.Title>Ready for Staci's call with Propel</FeatureCard.Title>
      <FeatureCard.Description>
        3 open requests, 1 overdue invoice ($4,200), last message 18h ago. Renewal in 14 days.
      </FeatureCard.Description>
      <FeatureCard.Footer>
        <TahiButton size="sm" variant="ghost">Open briefing</TahiButton>
      </FeatureCard.Footer>
    </FeatureCard>
  </div>
)

/** Lime variant — the standout CTA tile */
export const Lime = () => (
  <div style={{ ...frame, maxWidth: '26rem' }}>
    <FeatureCard variant="lime" padding="lg">
      <FeatureCard.Eyebrow>Retainer</FeatureCard.Eyebrow>
      <FeatureCard.Title>One retainer, every specialist</FeatureCard.Title>
      <FeatureCard.Description>
        Scale and Maintain plans give clients direct access to Liam for strategy and Staci for design, on one monthly rate.
      </FeatureCard.Description>
      <FeatureCard.Footer>
        <TahiButton size="sm">View retainer plans</TahiButton>
      </FeatureCard.Footer>
    </FeatureCard>
  </div>
)

/** Cream variant — contrast inside a dark panel */
export const Cream = () => (
  <div style={{ ...frame, background: 'var(--color-brand-deepest)', padding: '1.5rem', maxWidth: '26rem' }}>
    <FeatureCard variant="cream" padding="md">
      <FeatureCard.Eyebrow>New this sprint</FeatureCard.Eyebrow>
      <FeatureCard.Title style={{ fontSize: '1.125rem' }}>Aotea Credit Union homepage</FeatureCard.Title>
      <FeatureCard.Description>
        Responsive rebuild with Webflow CMS. Currently in client review. Sign-off due Friday.
      </FeatureCard.Description>
    </FeatureCard>
  </div>
)

/** Photo variant — hero panel (no real photo, uses the overlay alone) */
export const Photo = () => (
  <div style={{ ...frame, maxWidth: '26rem' }}>
    <FeatureCard variant="photo" padding="lg">
      <FeatureCard.Eyebrow>Tahi Studio</FeatureCard.Eyebrow>
      <FeatureCard.Title>Webflow delivery, start to finish</FeatureCard.Title>
      <FeatureCard.Description>
        Strategy, design, and development under one roof in Auckland, New Zealand.
      </FeatureCard.Description>
      <FeatureCard.Footer>
        <TahiButton size="sm" variant="ghost">Learn more</TahiButton>
      </FeatureCard.Footer>
    </FeatureCard>
  </div>
)
