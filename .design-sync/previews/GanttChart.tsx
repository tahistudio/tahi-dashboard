import { GanttChart } from 'tahi-dashboard'

const box = { width: '52rem', maxWidth: '100%', padding: '1.25rem', background: 'var(--color-bg)' } as const

export const WebflowProjectTimeline = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      Acme Corp -- Webflow rebuild
    </div>
    <GanttChart
      rangeStart={new Date('2026-05-01')}
      rangeEnd={new Date('2026-09-30')}
      today={new Date('2026-06-18')}
      showLegend
      rows={[
        { id: 'ph1', label: 'Phase 1: Discovery', rowType: 'section_header' },
        { id: 'discovery', label: 'Stakeholder interviews', start: new Date('2026-05-05'), end: new Date('2026-05-16'), owner: 'joint' },
        { id: 'brief', label: 'Content brief', start: new Date('2026-05-12'), end: new Date('2026-05-23'), owner: 'client' },
        { id: 'kick', label: 'Discovery sign-off', rowType: 'gate', gateDate: new Date('2026-05-26') },
        { id: 'ph2', label: 'Phase 2: Design', rowType: 'section_header' },
        { id: 'sitemap', label: 'Sitemap + IA', start: new Date('2026-05-26'), end: new Date('2026-06-06'), owner: 'tahi' },
        { id: 'wireframes', label: 'Wireframes', start: new Date('2026-06-02'), end: new Date('2026-06-20'), owner: 'tahi', riskFlag: true },
        { id: 'design', label: 'Visual design', start: new Date('2026-06-16'), end: new Date('2026-07-11'), owner: 'tahi' },
        { id: 'design-gate', label: 'Design sign-off', rowType: 'critical_gate', gateDate: new Date('2026-07-14') },
        { id: 'ph3', label: 'Phase 3: Build', rowType: 'section_header' },
        { id: 'webflow', label: 'Webflow development', start: new Date('2026-07-14'), end: new Date('2026-08-29'), owner: 'tahi', milestones: [{ date: new Date('2026-08-01'), label: 'Beta preview' }] },
        { id: 'content', label: 'Content population', start: new Date('2026-07-28'), end: new Date('2026-08-22'), owner: 'client' },
        { id: 'qa', label: 'QA + UAT', start: new Date('2026-08-25'), end: new Date('2026-09-05'), owner: 'joint' },
        { id: 'launch-gate', label: 'Launch approval', rowType: 'gate', gateDate: new Date('2026-09-08') },
        { id: 'launch', label: 'Go-live', start: new Date('2026-09-08'), end: new Date('2026-09-12'), owner: 'tahi_parallel' },
      ]}
      ariaLabel="Acme Corp Webflow rebuild timeline"
    />
  </div>
)

export const RetainerDeliveryTimeline = () => (
  <div style={box}>
    <div style={{ marginBottom: '0.75rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
      June delivery schedule
    </div>
    <GanttChart
      rangeStart={new Date('2026-06-01')}
      rangeEnd={new Date('2026-06-30')}
      today={new Date('2026-06-18')}
      rowHeight={32}
      rows={[
        { id: 'r1', label: 'Homepage refresh', start: new Date('2026-06-02'), end: new Date('2026-06-10'), owner: 'tahi' },
        { id: 'r2', label: 'Blog template', start: new Date('2026-06-09'), end: new Date('2026-06-18'), owner: 'tahi', riskFlag: true },
        { id: 'r3', label: 'CMS integration', start: new Date('2026-06-16'), end: new Date('2026-06-26'), owner: 'tahi' },
        { id: 'r4', label: 'Client review round', start: new Date('2026-06-23'), end: new Date('2026-06-30'), owner: 'joint' },
      ]}
      ariaLabel="June delivery schedule"
    />
  </div>
)
