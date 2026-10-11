import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WaitingOnYou, type WaitingItem } from '@/components/tahi/portal/home/waiting-on-you'

const review: WaitingItem = { key: 'r1', kind: 'review', ic: 'spark', title: 'Review the homepage', sub: 'Ready for review', primary: { label: 'Review', onAct: () => {} } }

describe('WaitingOnYou unavailable and preview states', () => {
  it('keeps a failed overview on the forest surface, with a status and retry', () => {
    const html = renderToStaticMarkup(<WaitingOnYou items={[]} failed onRetry={() => {}} />)
    expect(html).toContain('class="pfh-tile"')
    expect(html).toContain('role="status"')
    expect(html).toContain('Your overview did not load.')
    expect(html).toContain('Try again')
    expect(html).not.toContain('All quiet')
    expect(html).not.toContain('class="pfh-err"')
  })

  it.each([{ items: [] }, { items: [review] }])('qualifies quiet and populated results when a source failed (%#)', ({ items }) => {
    const html = renderToStaticMarkup(<WaitingOnYou items={items} partial="Some checks did not answer." onRetry={() => {}} onStart={() => {}} isFirstRun />)
    expect(html).toContain('Some checks did not answer.')
    expect(html).toContain('Try again')
    expect(html).not.toContain('All quiet')
    expect(html).not.toContain('Make your first request')
    if (items.length) expect(html).toContain('Review the homepage')
  })

  it('explains the act-as money boundary while keeping work actions available', () => {
    const invoice: WaitingItem = { key: 'i1', kind: 'invoice', ic: 'receipt', title: 'Invoice', sub: 'Due', primary: { label: 'Pay', reason: 'Money stays read-only while acting' } }
    const html = renderToStaticMarkup(<WaitingOnYou items={[review, invoice]} moneyRo previewName="Example" />)
    expect(html).toContain('You are acting as Example.')
    expect(html).toContain('Paying stays read-only; work actions remain available.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Money stays read-only while acting"[^>]*>Pay<\/button>/)
    expect(html).toMatch(/<button[^>]*class="pfh-btn primary">Review<\/button>/)
  })

  it('keeps read-only preview stronger than a money-only lens, including the quiet state', () => {
    for (const items of [[], [review]]) {
      const html = renderToStaticMarkup(<WaitingOnYou items={items} ro moneyRo previewName="Example" />)
      expect(html).toContain('Every action here is read-only in client view.')
      expect(html).not.toContain('work actions remain available')
    }
  })

  it('keeps loading ahead of unavailable or quiet copy', () => {
    const html = renderToStaticMarkup(<WaitingOnYou items={[]} loading failed partial="Not checked" />)
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('All quiet')
    expect(html).not.toContain('Your overview did not load.')
  })
})
