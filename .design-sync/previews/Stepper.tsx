import { Stepper } from 'tahi-dashboard'

const frame = {
  padding: '1.5rem',
  background: 'var(--color-bg-cream)',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '0.5rem',
}

const steps = [
  { id: 'brief',  label: 'Brief',   sub: 'Discovery' },
  { id: 'design', label: 'Design',  sub: 'Tahi Studio' },
  { id: 'build',  label: 'Build' },
  { id: 'review', label: 'Review' },
  { id: 'ship',   label: 'Ship' },
]

/** Horizontal — early in the flow (current = Design) */
export const HorizontalMidFlow = () => (
  <div style={frame}>
    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: '0.75rem', marginTop: 0 }}>
      Propel Homepage — design phase
    </p>
    <Stepper steps={steps} current="design" onStepClick={() => {}} />
  </div>
)

/** Horizontal — near end of the flow (current = Review, Build done) */
export const HorizontalNearEnd = () => (
  <div style={frame}>
    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: '0.75rem', marginTop: 0 }}>
      Aotea Credit Union — review phase
    </p>
    <Stepper steps={steps} current="review" onStepClick={() => {}} size="sm" />
  </div>
)

/** Vertical — onboarding checklist for a new client */
export const VerticalOnboarding = () => (
  <div style={{ ...frame, maxWidth: '18rem' }}>
    <p style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.75rem' }}>
      Client onboarding
    </p>
    <Stepper
      vertical
      steps={[
        { id: 'contract',  label: 'Sign contract',    sub: 'NDA + MSA' },
        { id: 'brief',     label: 'Complete brief',   sub: 'Discovery form' },
        { id: 'kickoff',   label: 'Kickoff call',     sub: 'Liam + Staci' },
        { id: 'access',    label: 'Share access',     sub: 'Webflow + hosting' },
      ]}
      current="kickoff"
      onStepClick={() => {}}
    />
  </div>
)

/** Error state — a step flagged for attention */
export const WithError = () => (
  <div style={frame}>
    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: '0.75rem', marginTop: 0 }}>
      Retainer proposal — build blocked
    </p>
    <Stepper
      steps={[
        { id: 'brief',   label: 'Brief' },
        { id: 'design',  label: 'Design' },
        { id: 'build',   label: 'Build', error: true },
        { id: 'ship',    label: 'Ship' },
      ]}
      current="build"
    />
  </div>
)
