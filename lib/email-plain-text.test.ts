/**
 * lib/email-plain-text.test.ts
 *
 * The text/plain half of a message is the half nobody looks at, so it is the
 * half that rots. Two things have to hold: it carries the same words the HTML
 * does, and a template that cannot be rendered to text still sends as HTML
 * rather than throwing the whole message away.
 */

import { describe, it, expect, vi } from 'vitest'
import { createElement } from 'react'

import { plainTextAlternative } from '@/lib/email-plain-text'

function Greeting({ name }: { name: string }) {
  return createElement(
    'html',
    null,
    createElement('body', null, createElement('p', null, `Kia ora ${name}, your invoice is ready.`)),
  )
}

function Boom(): never {
  throw new Error('template exploded during render')
}

describe('plainTextAlternative', () => {
  it('renders the same words the HTML half carries', async () => {
    const text = await plainTextAlternative(createElement(Greeting, { name: 'Marama' }))

    expect(text).toBeDefined()
    expect(text).toContain('Kia ora Marama')
    expect(text).toContain('your invoice is ready')
    // Text, not markup: a text part full of tags is worse than no text part.
    expect(text).not.toContain('<p')
  })

  it('returns undefined rather than throwing when the template blows up', async () => {
    // react-dom prints its own error report on a failed render; the assertion
    // below is the outcome that matters, so keep the run readable.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(plainTextAlternative(createElement(Boom))).resolves.toBeUndefined()
    } finally {
      quiet.mockRestore()
    }
  })

  it('returns undefined for an element that renders to nothing but whitespace', async () => {
    const blank = createElement('html', null, createElement('body', null, ' '))

    await expect(plainTextAlternative(blank)).resolves.toBeUndefined()
  })
})
