import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps, ReactNode } from 'react'
import { RecorderDevicesSection } from '@/components/tahi/settings/sections/recorder-devices'

const captured = vi.hoisted(() => ({
  stateIndex: 0, states: new Map<number, unknown>(),
  admin: true, signedIn: true, loaded: true, sessionId: 'session-1' as string | null,
  data: { items: [] } as { items: { id: string; name: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null; revokedReason: string | null }[] } | undefined,
  error: undefined as unknown, loading: false,
  key: null as string | null,
  refreshInterval: 0,
  effects: [] as (() => void | (() => void))[],
  cleanups: [] as (() => void)[],
  mutate: vi.fn(), buttons: new Map<string, () => void | Promise<void>>(),
  confirm: null as (() => void | Promise<void>) | null,
}))

vi.mock('react', async original => {
  const actual = await original<typeof import('react')>()
  return { ...actual, useEffect: (effect: () => void | (() => void)) => { captured.effects.push(effect) }, useState: (initial: unknown) => {
    const index = captured.stateIndex++
    if (index >= 6) return actual.useState(initial)
    const value = captured.states.has(index) ? captured.states.get(index) : typeof initial === 'function' ? initial() : initial
    return [value, (next: unknown) => captured.states.set(index, typeof next === 'function' ? next(value) : next)]
  } }
})
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ isLoaded: captured.loaded, isSignedIn: captured.signedIn, sessionId: captured.sessionId }) }))
vi.mock('react-dom', async original => {
  const actual = await original<typeof import('react-dom')>()
  return { ...actual, createPortal: (children: ReactNode) => children }
})
vi.mock('@/components/tahi/permissions-context', () => ({ usePermissions: () => ({ isAdmin: captured.admin }) }))
vi.mock('@/lib/use-resource', () => ({ useResource: (key: string | null, config?: { refreshInterval?: number }) => {
  captured.key = key
  captured.refreshInterval = config?.refreshInterval ?? 0
  return { data: captured.data, error: captured.error, isLoading: captured.loading, mutate: captured.mutate }
} }))
vi.mock('@/components/tahi/tahi-button', async original => {
  const actual = await original<typeof import('@/components/tahi/tahi-button')>()
  return { ...actual, TahiButton: (props: ComponentProps<typeof actual.TahiButton>) => {
    if (props.onClick && !props.disabled && !props.loading) captured.buttons.set(props['aria-label'] ?? String(props.children), props.onClick as () => void)
    return <actual.TahiButton {...props} />
  } }
})
vi.mock('@/components/tahi/confirm-dialog', () => ({ ConfirmDialog: (props: { open: boolean; onConfirm: () => Promise<void> | void }) => {
  captured.confirm = props.open ? props.onConfirm : null
  return null
} }))

const device = { id: 'device-1', name: 'Liam laptop', createdAt: '2026-10-14T00:00:00Z', lastSeenAt: '2026-10-14T01:00:00Z', revokedAt: null, revokedReason: null }

function render(isAdmin = true): string {
  captured.cleanups.splice(0).forEach(cleanup => cleanup())
  captured.effects = []
  captured.stateIndex = 0
  captured.buttons.clear()
  const html = renderToStaticMarkup(<RecorderDevicesSection isAdmin={isAdmin} />)
  for (const effect of captured.effects) {
    const cleanup = effect()
    if (cleanup) captured.cleanups.push(cleanup)
  }
  return html
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('document', { body: {} })
  vi.useFakeTimers()
  vi.stubGlobal('window', { setInterval, clearInterval })
  vi.setSystemTime(new Date('2026-10-14T02:00:00Z'))
  captured.states.clear()
  captured.admin = true; captured.signedIn = true; captured.loaded = true; captured.sessionId = 'session-1'
  captured.data = { items: [] }; captured.error = undefined; captured.loading = false; captured.confirm = null
  captured.mutate.mockImplementation(async () => captured.data)
})
afterEach(() => { captured.cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Recorder devices Settings states', () => {
  it('renders an empty state and a session-only pairing action with touch targets', () => {
    const html = render()
    expect(captured.key).toBe('/api/admin/recorder-devices')
    expect(html).toContain('No recorder devices yet')
    expect(html).toContain('Pair a device')
    expect(html).toContain('min-height:2.75rem')
    expect(html).toContain('var(--color-bg)')
    expect(html).toContain('var(--radius-leaf-sm)')
    expect(html).toMatch(/No recorder devices yet<\/h3>.*Pair a device<\/button>/)
    expect(html.match(/Pair a device<\/button>/g)).toHaveLength(1)
  })

  it('renders loading separately from empty and populated states', () => {
    captured.loading = true
    const html = render()
    expect(html).toContain('Loading recorder devices')
    expect(html).not.toContain('No recorder devices yet')
  })

  it('renders a read error with a working retry action', async () => {
    captured.error = new Error('Offline')
    expect(render()).toContain('Could not load recorder devices')
    await captured.buttons.get('Try again')?.()
    expect(captured.mutate).toHaveBeenCalledOnce()
  })

  it('shows dates and persistent revoke actions, while revoked devices cannot be revoked again', () => {
    captured.data = { items: [device, { ...device, id: 'old', name: 'Old computer', lastSeenAt: null, revokedAt: '2026-10-13T02:00:00Z' }] }
    const html = render()
    expect(html).toContain('Liam laptop')
    expect(html).toContain('Last seen:')
    expect(html).toContain('Paired:')
    expect(html).toContain('Not yet seen')
    expect(html).toContain('Revoked')
    expect(html).toContain('var(--badge-neutral-bg)')
    expect(captured.buttons.has('Revoke Liam laptop')).toBe(true)
    expect(captured.buttons.has('Revoke Old computer')).toBe(false)
    expect(html).toContain('flex-col sm:flex-row')
    expect(html).toContain('overflow-wrap:anywhere')
  })

  it.each([false, true])('hides the component from a non-admin (workspace flag %s)', workspaceAdmin => {
    captured.admin = false
    expect(render(workspaceAdmin)).toBe('')
    expect(captured.key).toBeNull()
  })

  it.each(['unsigned', 'loading', 'no-session'])('disables code creation without a real Clerk session: %s', state => {
    captured.signedIn = state !== 'unsigned'; captured.loaded = state !== 'loading'; captured.sessionId = state === 'no-session' ? null : 'session-1'
    const html = render()
    expect(html).toContain('Sign in with your admin account')
    expect(captured.buttons.has('Pair a device')).toBe(false)
  })
})

describe('Recorder devices Settings actions', () => {
  it('creates a code for self only and shows its expiry without storing a token', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ code: 'ABCD2345', expiresAt: '2026-10-14T02:10:00Z' }))
    vi.stubGlobal('fetch', fetch)
    render()
    await captured.buttons.get('Pair a device')?.()
    expect(fetch).toHaveBeenCalledWith('/api/admin/recorder-devices/pairing-code', expect.objectContaining({ method: 'POST', body: '{}' }))
    const html = render()
    expect(html).toContain('ABCD2345')
    expect(html).toContain('Keep this code private')
    expect(captured.refreshInterval).toBe(15_000)
    expect(html).not.toContain('tahi_rec_')
    captured.states.set(5, Date.parse('2026-10-14T02:11:00Z'))
    const expired = render()
    expect(expired).toContain('This pairing code has expired')
    expect(expired).not.toContain('ABCD2345')
    expect(captured.refreshInterval).toBe(0)
  })

  it('shows a code creation failure and allows retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Clerk session required' }, { status: 401 })))
    render()
    await captured.buttons.get('Pair a device')?.()
    const html = render()
    expect(html).toContain('Clerk session required')
    expect(html).toContain('role="alert"')
    expect(captured.buttons.has('Pair a device')).toBe(true)
  })

  it('closes the single-use code card when polling discovers a new paired device', async () => {
    captured.data = { items: [device] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'ABCD2345', expiresAt: '2026-10-14T02:10:00Z' })))
    render()
    await captured.buttons.get('Pair a device')?.()
    expect(captured.mutate).toHaveBeenCalledOnce()
    expect(render()).toContain('ABCD2345')
    expect(render()).toContain('ABCD2345')
    captured.data = { items: [device, { ...device, id: 'device-2', name: 'New laptop' }] }
    render()
    const html = render()
    expect(html).not.toContain('ABCD2345')
    expect(html).toContain('New laptop is paired and ready to record.')
    expect(captured.refreshInterval).toBe(0)
  })

  it('checks status before reading a non-JSON 5xx and shows a friendly retry message', async () => {
    const response = new Response('<html>Server unavailable</html>', { status: 503 })
    let checkedStatus = false
    Object.defineProperty(response, 'ok', { get: () => { checkedStatus = true; return false } })
    vi.spyOn(response, 'json').mockImplementation(async () => {
      expect(checkedStatus).toBe(true)
      throw new SyntaxError('Invalid JSON')
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    render()
    await captured.buttons.get('Pair a device')?.()
    const html = render()
    expect(html).toContain('Recorder devices are temporarily unavailable. Try again in a moment.')
    expect(html).not.toContain('Invalid JSON')
    expect(captured.buttons.has('Pair a device')).toBe(true)
  })

  it('does not create a code when the pre-create device list cannot be checked', async () => {
    captured.mutate.mockResolvedValue(undefined)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render()
    await captured.buttons.get('Pair a device')?.()
    expect(fetch).not.toHaveBeenCalled()
    expect(render()).toContain('Could not check your recorder devices. Try again.')
  })

  it('requires the explicit revoke action before writing and refreshes the owned list', async () => {
    captured.data = { items: [device] }
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true }))
    vi.stubGlobal('fetch', fetch)
    render()
    await captured.buttons.get('Revoke Liam laptop')?.()
    expect(fetch).not.toHaveBeenCalled()
    render()
    expect(captured.confirm).not.toBeNull()
    await captured.confirm?.()
    expect(fetch).toHaveBeenCalledWith('/api/admin/recorder-devices/device-1/revoke', expect.objectContaining({ method: 'POST', body: '{}' }))
    expect(captured.mutate).toHaveBeenCalledOnce()
    expect(render()).toContain('Its uploads are now blocked')
  })

  it('surfaces failed revocation without claiming success', async () => {
    captured.data = { items: [device] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Could not revoke' }, { status: 503 })))
    render()
    await captured.buttons.get('Revoke Liam laptop')?.()
    render()
    await captured.confirm?.()
    const html = render()
    expect(html).toContain('Could not revoke')
    expect(html).not.toContain('Its uploads are now blocked')
    expect(captured.mutate).not.toHaveBeenCalled()
  })

  it('shows a friendly non-JSON revocation failure without claiming success', async () => {
    captured.data = { items: [device] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad gateway', { status: 502 })))
    render()
    await captured.buttons.get('Revoke Liam laptop')?.()
    render()
    await captured.confirm?.()
    const html = render()
    expect(html).toContain('Recorder devices are temporarily unavailable. Try again in a moment.')
    expect(html).not.toContain('Its uploads are now blocked')
    expect(captured.mutate).not.toHaveBeenCalled()
  })
})
