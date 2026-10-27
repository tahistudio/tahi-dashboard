import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isValidElement, type ReactNode } from 'react'
import { WebhooksSection } from '@/components/tahi/settings/sections/webhooks'

interface TestKeyboardEvent {
  key: string
  shiftKey: boolean
  preventDefault: () => void
}

interface FocusTarget {
  focus: () => void
}

const captured = vi.hoisted(() => ({
  hookIndex: 0,
  states: new Map<number, unknown>(),
  refs: new Map<number, { current: unknown }>(),
  effects: [] as (() => void | (() => void))[],
  cleanups: [] as (() => void)[],
  buttons: new Map<string, () => void>(),
  inputs: new Map<string, (event: { target: { value: string } }) => void>(),
  keyHandlers: new Set<(event: TestKeyboardEvent) => void>(),
  focusTargets: new Map<string, FocusTarget>(),
  activeElement: null as FocusTarget | null,
  dialog: null as FocusTarget | null,
  submit: null as ((event: { preventDefault: () => void }) => void) | null,
  mutate: vi.fn(),
  data: { endpoints: [] } as { endpoints: { id: string; url: string; events: string[]; active: boolean; createdAt: string }[] },
}))

vi.mock('react', async original => {
  const actual = await original<typeof import('react')>()
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => captured.effects.push(effect),
    useState: (initial: unknown) => {
      const index = captured.hookIndex++
      if (!captured.states.has(index)) captured.states.set(index, typeof initial === 'function' ? initial() : initial)
      return [captured.states.get(index), (next: unknown) => {
        captured.states.set(index, typeof next === 'function' ? next(captured.states.get(index)) : next)
      }]
    },
    useRef: (initial: unknown) => {
      const index = captured.hookIndex++
      if (!captured.refs.has(index)) captured.refs.set(index, { current: initial })
      return captured.refs.get(index)
    },
  }
})

interface ElementProps {
  children?: ReactNode
  id?: string
  disabled?: boolean
  role?: string
  ref?: { current: unknown }
  onClick?: () => void
  onChange?: (event: { target: { value: string } }) => void
  onSubmit?: (event: { preventDefault: () => void }) => void
}

function textContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textContent).join('')
  if (isValidElement<ElementProps>(node)) return textContent(node.props.children)
  return ''
}

function captureActions(node: ReactNode): void {
  if (Array.isArray(node)) { node.forEach(captureActions); return }
  if (!isValidElement<ElementProps>(node)) return
  if (node.type === 'button' && node.props.onClick && !node.props.disabled) captured.buttons.set(textContent(node.props.children), node.props.onClick)
  if (node.type === 'input' && node.props.id && node.props.onChange && !node.props.disabled) captured.inputs.set(node.props.id, node.props.onChange)
  if (node.type === 'form' && node.props.onSubmit) captured.submit = node.props.onSubmit
  captureActions(node.props.children)
}

function attachDialogRef(node: ReactNode): void {
  if (Array.isArray(node)) { node.forEach(attachDialogRef); return }
  if (!isValidElement<ElementProps>(node)) return
  if (node.props.role === 'dialog' && node.props.ref) {
    const controls: FocusTarget[] = []
    function collectControls(child: ReactNode): void {
      if (Array.isArray(child)) { child.forEach(collectControls); return }
      if (!isValidElement<ElementProps>(child)) return
      if ((child.type === 'input' || child.type === 'button') && !child.props.disabled) {
        const target: FocusTarget = { focus: vi.fn(() => { captured.activeElement = target }) }
        controls.push(target)
        captured.focusTargets.set(child.props.id ?? textContent(child.props.children), target)
      }
      collectControls(child.props.children)
    }
    collectControls(node.props.children)
    const dialog = {
      focus: vi.fn(() => { captured.activeElement = dialog }),
      querySelector: () => controls[0],
      querySelectorAll: () => controls,
    }
    node.props.ref.current = dialog
    captured.dialog = dialog
  }
  attachDialogRef(node.props.children)
}

vi.mock('react-dom', async original => {
  const actual = await original<typeof import('react-dom')>()
  return { ...actual, createPortal: (children: ReactNode) => { captureActions(children); attachDialogRef(children); return children } }
})
vi.mock('@/lib/use-resource', () => ({ useResource: () => ({ data: captured.data, isLoading: false, mutate: captured.mutate }) }))
vi.mock('@/components/tahi/settings/primitives', () => ({
  SectionShell: (props: { action?: ReactNode; children?: ReactNode }) => { captureActions(props.action); return <>{props.action}{props.children}</> },
  EmptyRow: ({ text }: { text: string }) => <p>{text}</p>,
  RowActions: () => null,
  Toggle: () => null,
  EditDialog: () => null,
}))

function render(): string {
  captured.cleanups.splice(0).forEach(cleanup => cleanup())
  captured.hookIndex = 0
  captured.effects = []
  captured.buttons.clear()
  captured.inputs.clear()
  captured.focusTargets.clear()
  captured.dialog = null
  captured.submit = null
  const html = renderToStaticMarkup(<WebhooksSection isAdmin />)
  for (const effect of captured.effects) {
    const cleanup = effect()
    if (cleanup) captured.cleanups.push(cleanup)
  }
  for (const index of captured.states.keys()) if (index >= captured.hookIndex) captured.states.delete(index)
  for (const index of captured.refs.keys()) if (index >= captured.hookIndex) captured.refs.delete(index)
  return html
}

function openCreate(): string {
  render()
  captured.buttons.get('Add endpoint')?.()
  render()
  return render()
}

function fillAndSubmit(): void {
  captured.inputs.get('webhook-endpoint-url')?.({ target: { value: 'https://receiver.test/hook' } })
  captured.inputs.get('webhook-endpoint-events')?.({ target: { value: 'request.created, request.created, invoice.paid' } })
  render()
  expect(captured.submit).not.toBeNull()
  captured.submit?.({ preventDefault: () => undefined })
}

function pressKey(key: string, shiftKey = false) {
  const preventDefault = vi.fn()
  captured.keyHandlers.forEach(handler => handler({ key, shiftKey, preventDefault }))
  return preventDefault
}

beforeEach(() => {
  vi.clearAllMocks()
  captured.states.clear()
  captured.refs.clear()
  captured.keyHandlers.clear()
  captured.activeElement = null
  captured.data = { endpoints: [] }
  captured.mutate.mockResolvedValue(undefined)
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('document', {
    body: {}, get activeElement() { return captured.activeElement },
    querySelector: () => null,
    documentElement: { classList: { contains: () => false } },
    addEventListener: (type: string, listener: (event: TestKeyboardEvent) => void) => { if (type === 'keydown') captured.keyHandlers.add(listener) },
    removeEventListener: (type: string, listener: (event: TestKeyboardEvent) => void) => { if (type === 'keydown') captured.keyHandlers.delete(listener) },
  })
})
afterEach(() => {
  captured.cleanups.splice(0).forEach(cleanup => cleanup())
  vi.unstubAllGlobals()
})

describe('webhook signing secret creation', () => {
  it('shows the returned secret once, copies it, and clears it on close and reopen', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ endpoint: { id: 'hook-1', secret: 'whsec_saved_secret' } }, { status: 201 }))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('fetch', fetch)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    expect(openCreate()).toContain('Create endpoint')
    fillAndSubmit()
    await vi.waitFor(() => expect(captured.mutate).toHaveBeenCalledOnce())
    const html = render()
    expect(html).toContain('Endpoint created')
    expect(html).toContain('value="whsec_saved_secret"')
    expect(html).toContain("You won&#x27;t see this again")
    expect(html).toContain('verify webhook signatures')
    expect(html).toContain('min-height:2.75rem')
    expect(captured.submit).toBeNull()
    const request = JSON.parse(fetch.mock.calls[0][1].body) as { secret: string; events: string[] }
    expect(request.secret).toMatch(/^whsec_[a-f0-9]{32}$/)
    // Typed with dots, saved as the emitted underscore names (lib/webhook-events.ts).
    expect(request.events).toEqual(['request_created', 'invoice_paid'])
    captured.buttons.get('Copy secret')?.()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('whsec_saved_secret'))
    expect(render()).toContain('Copied')
    captured.buttons.get('Done')?.()
    expect(render()).not.toContain('whsec_saved_secret')
    expect(openCreate()).not.toContain('whsec_saved_secret')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('prevents a second request and closing while creation is pending', async () => {
    let resolve: ((response: Response) => void) | undefined
    const fetch = vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done }))
    vi.stubGlobal('fetch', fetch)
    openCreate()
    fillAndSubmit()
    const repeatSubmit = captured.submit
    repeatSubmit?.({ preventDefault: () => undefined })
    captured.buttons.get('Cancel')?.()
    expect(fetch).toHaveBeenCalledOnce()
    expect(render()).toContain('Creating...')
    expect(captured.buttons.has('Cancel')).toBe(false)
    resolve?.(Response.json({ endpoint: { id: 'hook-1', secret: 'whsec_saved_secret' } }, { status: 201 }))
    await vi.waitFor(() => expect(captured.mutate).toHaveBeenCalledOnce())
    expect(render()).toContain('whsec_saved_secret')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('wraps Tab and Shift+Tab between the dialog controls', () => {
    expect(openCreate()).toContain('tabindex="-1"')
    const first = captured.focusTargets.get('webhook-endpoint-url')
    const last = captured.focusTargets.get('Create endpoint')
    expect(first).toBeDefined()
    expect(last).toBeDefined()
    captured.activeElement = last ?? null
    expect(pressKey('Tab')).toHaveBeenCalledOnce()
    expect(first?.focus).toHaveBeenCalled()
    expect(captured.activeElement).toBe(first)
    captured.activeElement = first ?? null
    expect(pressKey('Tab', true)).toHaveBeenCalledOnce()
    expect(last?.focus).toHaveBeenCalledOnce()
    expect(captured.activeElement).toBe(last)
  })

  it('holds keyboard focus and refuses Escape while all controls are disabled during creation', async () => {
    let resolve: ((response: Response) => void) | undefined
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(done => { resolve = done })))
    openCreate()
    fillAndSubmit()
    expect(render()).toContain('Creating...')
    expect(captured.focusTargets.size).toBe(0)
    const dialog = captured.dialog
    expect(dialog?.focus).toHaveBeenCalledOnce()
    expect(captured.activeElement).toBe(dialog)
    expect(pressKey('Tab')).toHaveBeenCalledOnce()
    expect(dialog?.focus).toHaveBeenCalledTimes(2)
    expect(captured.activeElement).toBe(dialog)
    expect(pressKey('Tab', true)).toHaveBeenCalledOnce()
    expect(dialog?.focus).toHaveBeenCalledTimes(3)
    pressKey('Escape')
    expect(render()).toContain('Creating...')
    resolve?.(Response.json({ endpoint: { id: 'hook-1', secret: 'whsec_saved_secret' } }, { status: 201 }))
    await vi.waitFor(() => expect(captured.mutate).toHaveBeenCalledOnce())
    expect(render()).toContain('whsec_saved_secret')
    expect(captured.activeElement).toBe(captured.focusTargets.get('webhook-signing-secret'))
    pressKey('Escape')
    expect(render()).not.toContain('role="dialog"')
    expect(captured.keyHandlers.size).toBe(0)
  })

  it.each(['http', 'network'])('keeps input and a visible error after a %s creation failure', async failure => {
    const fetch = failure === 'http'
      ? vi.fn().mockResolvedValue(Response.json({ error: 'Endpoint URL is invalid' }, { status: 400 }))
      : vi.fn().mockRejectedValue(new Error('Offline'))
    vi.stubGlobal('fetch', fetch)
    openCreate()
    fillAndSubmit()
    await vi.waitFor(() => {
      const html = render()
      expect(html).toContain('role="alert"')
      expect(html).toContain(failure === 'http' ? 'Endpoint URL is invalid' : 'Check your connection')
      expect(html).toContain('value="https://receiver.test/hook"')
      expect(html).toContain('Create endpoint')
      expect(html).not.toContain('Signing secret')
    })
    expect(captured.mutate).not.toHaveBeenCalled()
  })

  it('retains the accepted secret if successful response parsing or list refresh fails', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('Created', { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    captured.mutate.mockRejectedValue(new Error('Refresh failed'))
    openCreate()
    fillAndSubmit()
    await vi.waitFor(() => expect(captured.mutate).toHaveBeenCalledOnce())
    const request = JSON.parse(fetch.mock.calls[0][1].body) as { secret: string }
    const html = render()
    expect(html).toContain(`value="${request.secret}"`)
    expect(html).toContain('Endpoint created')
    expect(captured.submit).toBeNull()
    expect(html).not.toContain('role="alert"')
  })

  it('offers manual copy if clipboard access is denied, without hiding the secret', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ endpoint: { id: 'hook-1', secret: 'whsec_saved_secret' } }, { status: 201 })))
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) } })
    openCreate()
    fillAndSubmit()
    await vi.waitFor(() => expect(captured.mutate).toHaveBeenCalledOnce())
    render()
    captured.buttons.get('Copy secret')?.()
    await vi.waitFor(() => {
      const html = render()
      expect(html).toContain('Select and copy the secret manually')
      expect(html).toContain('value="whsec_saved_secret"')
    })
  })
})
