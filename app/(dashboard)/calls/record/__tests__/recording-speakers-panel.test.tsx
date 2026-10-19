import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecordingSpeakersPanel } from '../recording-speakers-panel'
import type { RecordingSpeaker } from '@/lib/meeting-recordings-types'

const speakers: RecordingSpeaker[] = [
  { key: 'mic', track: 'mic', defaultLabel: 'Liam Miller', label: 'Liam Miller', custom: false },
  { key: 'system:0', track: 'system', defaultLabel: 'Them 1', label: 'Michael Day', custom: true },
  { key: 'system:1', track: 'system', defaultLabel: 'Them 2', label: 'Them 2', custom: false },
]

function render(list: RecordingSpeaker[], disabled = false) {
  return renderToStaticMarkup(<RecordingSpeakersPanel recordingId="rec-1" speakers={list} disabled={disabled} onUpdated={() => undefined} />)
}

describe('recording speakers panel', () => {
  it('shows an empty state instead of a form before any speech is transcribed', () => {
    const html = render([])
    expect(html).toContain('Speakers')
    expect(html).toContain('No speakers yet. They appear here once the audio is transcribed.')
    expect(html).not.toContain('<input')
    expect(html).not.toContain('Save names')
  })

  it('offers one labelled, bounded input per voice with its current name', () => {
    const html = render(speakers)
    expect(html.match(/<input/g)).toHaveLength(3)
    expect(html).toContain('value="Liam Miller"')
    expect(html).toContain('value="Michael Day"')
    expect(html).toContain('value="Them 2"')
    expect(html).toContain('maxLength="80"')
    expect(html).toContain('Microphone')
    expect(html).toContain('System audio')
    expect(html).toContain('(Them 1)')
  })

  it('only offers a reset for a voice that has been renamed', () => {
    const html = render(speakers)
    expect(html.match(/>Reset</g)).toHaveLength(1)
    expect(html).toContain('aria-label="Reset Them 1 to its default name"')
  })

  it('starts with save disabled, announces suggestion loading and links the datalist', () => {
    const html = render(speakers)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^]*Save names/)
    expect(html).toContain('Loading name suggestions.')
    const list = /list="([^"]+)"/.exec(html)?.[1]
    expect(list).toBeTruthy()
    expect(html).toContain(`<datalist id="${list}">`)
  })

  it('disables every control while the page is busy', () => {
    const html = render(speakers, true)
    expect(html.match(/<input[^>]*disabled=""/g)).toHaveLength(3)
  })

  it('meets touch target size and uses design tokens rather than hex for dark mode', () => {
    const html = render(speakers)
    expect(html).toContain('min-height:2.75rem')
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(html).toContain('var(--color-')
    expect(html).toContain('tahi-focus-ring')
  })
})
