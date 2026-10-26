// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://qa-view.example.com/about"}
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createCommentLayer, type CommentLayer } from '../../../workers/qa-view/src/scanner/comments'
import { uniqueSelector } from '../../../workers/qa-view/src/scanner/selector'
import { ancestorsOf, buildElementContext } from '../../../workers/qa-view/src/scanner/context'
import type { QaPickMessage } from '../types'

/*
 * The comment layer and selector builder run inside the proxied client page.
 * They are exercised here against a jsdom document. jsdom has no layout, so
 * element boxes are faked with place(). Real pointer and pin placement is
 * covered by the e2e spec.
 */

const PAGE_URL = 'https://client.example.com/about'

const layers: CommentLayer[] = []

function makeLayer(): { layer: CommentLayer; post: ReturnType<typeof vi.fn> } {
  const post = vi.fn()
  const layer = createCommentLayer({
    win: window,
    doc: document,
    post,
    pageUrl: () => PAGE_URL,
    shadowMode: 'open',
  })
  layers.push(layer)
  return { layer, post }
}

function must<T extends Element = Element>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`missing ${selector}`)
  return el
}

function place(el: Element, left: number, top: number, width: number, height: number): void {
  const rect = { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
  el.getBoundingClientRect = () => rect
}

afterEach(() => {
  for (const layer of layers.splice(0)) {
    layer.setMode(false)
    layer.destroy()
  }
  document.querySelector('[data-qa-comment-layer]')?.remove()
  document.documentElement.style.cursor = ''
  document.body.innerHTML = ''
})

describe('uniqueSelector', () => {
  function expectResolves(el: Element): string {
    const selector = uniqueSelector(el, document)
    expect(document.querySelector(selector)).toBe(el)
    return selector
  }

  it('uses the id when it is unique', () => {
    document.body.innerHTML = '<main><section id="hero"><p>Intro</p></section></main>'
    const el = must('#hero')
    expect(expectResolves(el)).toBe('#hero')
  })

  it('does not use a duplicated id and still resolves to the element', () => {
    document.body.innerHTML = '<div id="dup"><p class="a">one</p></div><div id="dup"><p class="b">two</p></div>'
    const target = must('.b')
    const selector = expectResolves(target)
    expect(selector).not.toBe('#dup')
  })

  it('resolves deeply nested elements', () => {
    document.body.innerHTML = '<div>'.repeat(15) + '<em>deep</em>' + '</div>'.repeat(15)
    expectResolves(must('em'))
  })

  it('resolves siblings of the same tag', () => {
    document.body.innerHTML = '<ul><li>a</li><li>b</li><li>c</li></ul>'
    const items = document.querySelectorAll('li')
    expectResolves(items[0])
    expectResolves(items[1])
    expectResolves(items[2])
  })

  it('resolves through an ancestor with a unique id', () => {
    document.body.innerHTML = '<section id="wrap"><div><p>x</p></div><div><p>y</p></div></section>'
    const second = document.querySelectorAll('p')[1]
    expect(expectResolves(second)).toBe('div:nth-of-type(2) > p')
  })

  // A custom element name over the cap makes any selector for the element itself too long.
  it('falls back to the nearest addressable ancestor when the element selector is over 1000 characters', () => {
    const long = `x-${'a'.repeat(1100)}`
    document.body.innerHTML = `<main><div><${long}>text</${long}></div></main>`
    const el = must(long)
    const selector = uniqueSelector(el, document)
    expect(selector.length).toBeLessThanOrEqual(1000)
    expect(selector).toBe('div')
    expect(document.querySelector(selector)?.contains(el)).toBe(true)
  })

  it('picks the closest addressable ancestor, not one further up with an id', () => {
    const long = `x-${'b'.repeat(1100)}`
    document.body.innerHTML = `<section id="anchor"><div><${long}>text</${long}></div></section>`
    const selector = uniqueSelector(must(long), document)
    expect(selector).toBe('div')
  })

  it('escapes ids that need escaping', () => {
    document.body.innerHTML = '<div id="hero.title:one"><span>a</span></div><div id="2col"><span>b</span></div><div id="a b"><span>c</span></div>'
    expectResolves(document.getElementById('hero.title:one') ?? document.body)
    expectResolves(document.querySelectorAll('span')[0])
    expectResolves(document.querySelectorAll('span')[1])
    expectResolves(document.querySelectorAll('span')[2])
  })
})

describe('createCommentLayer comment mode', () => {
  function setupPage(): void {
    document.body.innerHTML = '<main><h1>Title</h1><a id="go" href="https://client.example.com/x">Click me</a><button id="btn">Go</button></main>'
  }

  it('comment mode click posts a qa:pick with the selector and offsets, and does not reach the link', () => {
    setupPage()
    const { layer, post } = makeLayer()
    const anchor = must<HTMLAnchorElement>('#go')
    place(anchor, 100, 20, 200, 40)
    const handler = vi.fn()
    anchor.addEventListener('click', handler)

    layer.setMode(true)
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 150, clientY: 40 })
    anchor.dispatchEvent(ev)

    expect(ev.defaultPrevented).toBe(true)
    expect(handler).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith({
      type: 'qa:pick',
      version: 1,
      url: PAGE_URL,
      selector: uniqueSelector(anchor, document),
      ox: 0.25,
      oy: 0.5,
      tag: 'a',
      text: 'Click me',
      context: expect.objectContaining({ id: 'go', classes: [] }),
    })
  })

  it('the pick carries element context: classes, ancestors nearest first, box and viewport', () => {
    document.body.innerHTML =
      '<div class="page-wrapper"><section id="hero" class="section_hero is-dark"><div class="padding-global">' +
      '<div class="container-large"><h1 class="heading-style-h1 u-center">Title</h1></div></div></section></div>'
    const { layer, post } = makeLayer()
    const h1 = must('h1')
    place(h1, 10, 20, 300, 60)
    layer.setMode(true)
    h1.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }))

    const msg = post.mock.calls[0][0] as QaPickMessage
    const ctx = msg.context
    if (!ctx) throw new Error('no context')
    expect(ctx.id).toBeNull()
    expect(ctx.classes).toEqual(['heading-style-h1', 'u-center'])
    expect(ctx.ancestors.map(a => a.tag)).toEqual(['div', 'div', 'section'])
    expect(ctx.ancestors[0].classes).toEqual(['container-large'])
    expect(ctx.ancestors[2]).toEqual({ tag: 'section', id: 'hero', classes: ['section_hero', 'is-dark'] })
    expect(ctx.html.startsWith('<h1 class="heading-style-h1 u-center">')).toBe(true)
    expect(ctx.box).toEqual({ x: 10, y: 20, width: 300, height: 60 })
    for (const n of [ctx.scrollY, ctx.pageHeight, ctx.viewportWidth, ctx.viewportHeight, ctx.box.x, ctx.box.y]) {
      expect(Number.isFinite(n)).toBe(true)
      expect(Number.isInteger(n)).toBe(true)
    }
    expect(ctx.viewportWidth).toBe(window.innerWidth)
  })

  it('context limits: 20 classes of 100 chars, 8 ancestors, 600 chars of html, stop at a body child', () => {
    const many = Array.from({ length: 30 }, (_, i) => `c${i}`).join(' ')
    const longClass = 'x'.repeat(150)
    let nested = `<p class="${many} ${longClass}">${'t'.repeat(900)}</p>`
    for (let i = 0; i < 10; i++) nested = `<div class="d${i}">${nested}</div>`
    document.body.innerHTML = nested
    const target = must('p')
    const ctx = buildElementContext(target, window, document)
    expect(ctx.classes).toHaveLength(20)
    expect(ctx.html.length).toBe(600)
    expect(ctx.ancestors).toHaveLength(8)
    expect(ctx.ancestors[0].classes).toEqual(['d0'])
    expect(ancestorsOf(target)[7].classes).toEqual(['d7'])

    const longOnly = document.createElement('i')
    longOnly.setAttribute('class', longClass)
    document.body.appendChild(longOnly)
    expect(buildElementContext(longOnly, window, document).classes[0]).toHaveLength(100)
  })

  it('ancestors stop at the first landmark and at a body child, and never list body', () => {
    document.body.innerHTML = '<main><article><div class="a"><span id="s">x</span></div></article></main><p id="top"><b id="b">y</b></p>'
    expect(ancestorsOf(must('#s')).map(a => a.tag)).toEqual(['div', 'article'])
    expect(ancestorsOf(must('#b')).map(a => a.tag)).toEqual(['p'])
    expect(ancestorsOf(must('main'))).toEqual([])
  })

  it('clamps ox and oy to 0 to 1 when the click is outside the box', () => {
    setupPage()
    const { layer, post } = makeLayer()
    const anchor = must('#go')
    place(anchor, 100, 20, 200, 40)
    layer.setMode(true)
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 500, clientY: 0 }))
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'qa:pick', ox: 1, oy: 0 }))
  })

  it('off restores the previous cursor, removes the hover outline and lets clicks through', () => {
    setupPage()
    const { layer, post } = makeLayer()
    document.documentElement.style.cursor = 'pointer'
    const btn = must<HTMLElement>('#btn')
    const handler = vi.fn()
    btn.addEventListener('click', handler)

    layer.setMode(true)
    expect(document.documentElement.style.cursor).toBe('crosshair')
    btn.dispatchEvent(new Event('pointermove', { bubbles: true }))
    expect(btn.style.outlineOffset).toBe('2px')
    expect(btn.style.outline).toContain('solid')

    layer.setMode(false)
    expect(document.documentElement.style.cursor).toBe('pointer')
    expect(btn.style.outline).toBe('')
    expect(btn.style.outlineOffset).toBe('')

    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(post).not.toHaveBeenCalled()
  })

  it('Esc turns comment mode off locally and posts qa:comment-mode-changed once', () => {
    setupPage()
    const { layer, post } = makeLayer()
    layer.setMode(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.documentElement.style.cursor).not.toBe('crosshair')
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith({ type: 'qa:comment-mode-changed', version: 1, on: false })
    // With the mode already off, the next Esc is forwarded as qa:escape.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenLastCalledWith({ type: 'qa:escape', version: 1 })
  })

  it('turning the mode off from the dashboard does not post a change message', () => {
    setupPage()
    const { layer, post } = makeLayer()
    layer.setMode(true)
    layer.setMode(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('Esc while comment mode is off posts qa:escape once', () => {
    setupPage()
    const { post } = makeLayer()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith({ type: 'qa:escape', version: 1 })
  })

  it('keys other than Escape post nothing', () => {
    setupPage()
    const { post } = makeLayer()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(post).not.toHaveBeenCalled()
  })
})

describe('createCommentLayer pins', () => {
  function setupPage(): void {
    document.body.innerHTML = '<main><h1>Title</h1><button id="btn">Go</button></main>'
  }

  function pinRoot(): ShadowRoot {
    const host = document.querySelector('[data-qa-comment-layer]')
    if (!host || !host.shadowRoot) throw new Error('no comment layer host')
    return host.shadowRoot
  }

  it('renders one button per resolvable pin in the shadow host', () => {
    setupPage()
    const { layer } = makeLayer()
    place(must('h1'), 10, 10, 200, 50)
    place(must('#btn'), 300, 100, 100, 40)

    layer.setPins([
      { id: 'a', n: 1, selector: 'h1', ox: 0, oy: 0.5, resolved: false },
      { id: 'b', n: 2, selector: '#btn', ox: 1, oy: 1, resolved: true },
      { id: 'c', n: 3, selector: '.missing', ox: 0.5, oy: 0.5, resolved: false },
      { id: 'd', n: 4, selector: '((', ox: 0.5, oy: 0.5, resolved: false },
    ])

    const buttons = pinRoot().querySelectorAll('button')
    expect(buttons.length).toBe(2)
    expect(buttons[0].getAttribute('aria-label')).toBe('Comment 1')
    expect(buttons[1].getAttribute('aria-label')).toBe('Comment 2')
    expect(buttons[1].getAttribute('data-resolved')).toBe('true')
    expect(buttons[0].style.left).toBe('-2px')
    expect(buttons[0].style.top).toBe('23px')
    expect(buttons[1].style.left).toBe('388px')
    expect(buttons[1].style.top).toBe('128px')
  })

  it('pin click posts qa:pin-click and no qa:pick, even in comment mode', () => {
    setupPage()
    const { layer, post } = makeLayer()
    place(must('h1'), 10, 10, 200, 50)
    layer.setPins([{ id: 'pin-1', n: 1, selector: 'h1', ox: 0.5, oy: 0.5, resolved: false }])

    layer.setMode(true)
    const button = pinRoot().querySelector('button')
    if (!button) throw new Error('no pin button')
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }))

    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith({ type: 'qa:pin-click', version: 1, id: 'pin-1' })
  })

  it('focusPin does not throw for a known or unknown id', () => {
    setupPage()
    const { layer } = makeLayer()
    place(must('h1'), 10, 10, 200, 50)
    layer.setPins([{ id: 'pin-1', n: 1, selector: 'h1', ox: 0.5, oy: 0.5, resolved: false }])
    expect(() => layer.focusPin('pin-1')).not.toThrow()
    expect(() => layer.focusPin('nope')).not.toThrow()
  })
})
