import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TasksViewSwitcher } from '@/components/tahi/tasks/tasks-view-switcher'

describe('Suggestions view permission', () => {
  it('omits the mixed inbox door when its required grants are absent', () => {
    const markup = renderToStaticMarkup(<TasksViewSwitcher value="list" onChange={() => undefined} suggestionsAllowed={false} />)
    expect(markup).not.toContain('Suggestions')
    expect(markup).toContain('My week')
    expect(markup).toContain('Board')
  })
  it('keeps the door for a permitted seat', () => {
    const markup = renderToStaticMarkup(<TasksViewSwitcher value="list" onChange={() => undefined} suggestionsAllowed />)
    expect(markup).toContain('Suggestions')
  })
})
