import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BriefSnapshot } from '@/lib/overview-brief'
import { DailyBriefProvider, useDailyBrief } from '@/components/tahi/daily-brief-provider'
import useSWR from 'swr'
import { BRIEF_FEATURES, briefViewerKey } from '@/lib/brief-cache-key'

const resource = vi.hoisted(() => ({
  data: undefined as BriefSnapshot | undefined,
  error: undefined as Error | undefined,
  isLoading: false,
  mutate: vi.fn(),
}))
const lifecycle = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }))
vi.mock('swr', () => ({ default: vi.fn(() => resource) }))
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      lifecycle.effects.push(effect)
      return react.useEffect(effect, deps)
    },
  }
})

const BEFORE: BriefSnapshot = {
  urgent: [{ tone: 'risk', verb: 'Nudge', to: 'invoices', text: 'A real overdue invoice' }],
  week: [],
  slept: [],
  generatedAt: '2026-10-14T00:00:00.000Z',
}
const AFTER: BriefSnapshot = {
  urgent: [],
  week: [{ tone: 'warn', verb: 'Open', to: 'requests', text: 'A real overdue request' }],
  slept: [],
  generatedAt: '2026-10-14T01:00:00.000Z',
}
type Refresh = ReturnType<typeof useDailyBrief>['refresh']
const actions = new Map<string, Refresh>()

function Surface({ name }: { name: string }) {
  const { data, summary, isLoading, isRefreshing, canRefresh, error, refresh } = useDailyBrief()
  actions.set(name, refresh)
  return <div data-surface={name}>
    {isLoading && <span>Loading daily brief</span>}
    {error && <span role="alert">{error}</span>}
    {data && <span>{JSON.stringify(data)}</span>}
    {summary && <span>{summary}</span>}
    <button disabled={!canRefresh || isRefreshing}>Refresh</button>
  </div>
}

function render(viewerKey: string | null = 'owner:tahi-org') {
  return renderToStaticMarkup(<DailyBriefProvider viewerKey={viewerKey}>
    <Surface name="home" /><Surface name="nav" />
  </DailyBriefProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.clear()
  lifecycle.effects = []
  resource.data = BEFORE
  resource.error = undefined
  resource.isLoading = false
  resource.mutate.mockImplementation(async (next: BriefSnapshot) => { resource.data = next; return next })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('one daily brief resource for home and navigation', () => {
  it('reads once and exposes the same generated snapshot and refresh action to both surfaces', () => {
    const markup = render()

    expect(useSWR).toHaveBeenCalledTimes(1)
    expect(markup.match(/A real overdue invoice/g)).toHaveLength(2)
    expect(markup.match(/2026-10-14T00:00:00.000Z/g)).toHaveLength(2)
    expect(actions.get('home')).toBe(actions.get('nav'))
    expect(markup.match(/1 thing needs you today, 0 this week\./g)).toHaveLength(2)
  })

  it('coalesces concurrent clicks and publishes the exact refreshed snapshot once without a second GET', async () => {
    let complete: ((response: Response) => void) | undefined
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { complete = resolve }))
    vi.stubGlobal('fetch', fetcher)
    render()

    const fromHome = actions.get('home')!()
    const fromNav = actions.get('nav')!()
    expect(fromHome).toBe(fromNav)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/admin/overview/brief/refresh?force=1', { method: 'POST' })
    complete!(Response.json(AFTER))

    expect(await fromHome).toEqual(AFTER)
    expect(await fromNav).toEqual(AFTER)
    expect(resource.mutate).toHaveBeenCalledExactlyOnceWith(AFTER, { revalidate: false })
    const markup = render()
    expect(markup.match(/A real overdue request/g)).toHaveLength(2)
    expect(markup.match(/2026-10-14T01:00:00.000Z/g)).toHaveLength(2)
    expect(markup).not.toContain('A real overdue invoice')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(markup.match(/0 things need you today, 1 this week\./g)).toHaveLength(2)
  })

  it('shares one all-clear summary only for a computed empty snapshot', () => {
    resource.data = { urgent: [], week: [], slept: [], generatedAt: BEFORE.generatedAt }
    expect(render().match(/All clear\. Nothing is waiting on you right now\./g)).toHaveLength(2)
    resource.data = undefined
    expect(render()).not.toContain('All clear')
  })

  it.each([403, 500])('preserves both snapshots on a failed refresh (%s)', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Failed' }, { status })))
    render()

    expect(await actions.get('home')!()).toBeUndefined()
    expect(resource.mutate).not.toHaveBeenCalled()
    expect(resource.data).toEqual(BEFORE)
  })

  it('exposes shared loading and read failure states without fabricating an empty brief', () => {
    resource.data = undefined
    resource.isLoading = true
    expect(render().match(/Loading daily brief/g)).toHaveLength(2)

    resource.isLoading = false
    resource.error = new Error('Read failed')
    const markup = render()
    expect(markup.match(/role="alert"/g)).toHaveLength(2)
    expect(markup.match(/could not be loaded/g)).toHaveLength(2)
    expect(markup).not.toContain('generatedAt')
  })

  it('isolates viewers and never retains the previous viewer\'s data', () => {
    render('designer:tahi-org')
    expect(useSWR).toHaveBeenCalledWith(
      ['/api/admin/overview/brief', 'designer:tahi-org'],
      expect.any(Function),
      { keepPreviousData: false },
    )
  })

  it('replaces the refresh lifecycle when viewer permissions change or client preview starts', () => {
    const before = DailyBriefProvider({ viewerKey: 'owner:all-features', children: null })
    const narrowed = DailyBriefProvider({ viewerKey: 'owner:requests-only', children: null })
    const preview = DailyBriefProvider({ viewerKey: null, children: null })

    expect(before.key).not.toBe(narrowed.key)
    expect(narrowed.key).not.toBe(preview.key)
  })

  it('replaces both cache identity and refresh lifecycle when only allowed organisations change', () => {
    const auth = { userId: 'same-user', orgId: 'same-workspace' }
    const wide = briefViewerKey(auth, ['org-a', 'org-b'], BRIEF_FEATURES)
    const narrow = briefViewerKey(auth, ['org-b'], BRIEF_FEATURES)
    const before = DailyBriefProvider({ viewerKey: wide, children: null })
    const after = DailyBriefProvider({ viewerKey: narrow, children: null })

    expect(wide).not.toBe(narrow)
    expect(before.key).not.toBe(after.key)
    expect(briefViewerKey(auth, ['org-b', 'org-a'], [...BRIEF_FEATURES].reverse())).toBe(wide)
    render(narrow)
    expect(useSWR).toHaveBeenCalledWith(['/api/admin/overview/brief', narrow], expect.any(Function), { keepPreviousData: false })
  })

  it.each([200, 500])('discards an old viewer\'s in-flight response (%s) without clearing the new refresh', async oldStatus => {
    const responses: Array<(response: Response) => void> = []
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { responses.push(resolve) }))
    vi.stubGlobal('fetch', fetcher)
    const auth = { userId: 'same-user', orgId: 'same-workspace' }
    render(briefViewerKey(auth, ['org-a', 'org-b'], BRIEF_FEATURES))
    // SSR captures the lifecycle effect. Exercise its mount/unmount cleanup
    // explicitly, so an obsolete pending request is tested without a DOM.
    const cleanup = lifecycle.effects[0]()
    const oldWork = actions.get('home')!()
    if (typeof cleanup !== 'function') throw new Error('Missing lifecycle cleanup')
    cleanup()
    render(briefViewerKey(auth, ['org-b'], BRIEF_FEATURES))
    const newWork = actions.get('home')!()

    expect(fetcher).toHaveBeenCalledTimes(2)
    responses[0](Response.json(BEFORE, { status: oldStatus }))
    expect(await oldWork).toBeUndefined()
    expect(resource.mutate).not.toHaveBeenCalled()
    expect(actions.get('nav')!()).toBe(newWork)

    responses[1](Response.json(AFTER))
    expect(await newWork).toEqual(AFTER)
    expect(resource.mutate).toHaveBeenCalledExactlyOnceWith(AFTER, { revalidate: false })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not fetch or refresh for client and preview audiences', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    resource.data = undefined
    render(null)

    expect(useSWR).toHaveBeenCalledWith(null, expect.any(Function), { keepPreviousData: false })
    expect(await actions.get('nav')!()).toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('shows an honest unavailable state with disabled refresh when viewer access could not be resolved', () => {
    resource.data = undefined
    const markup = render(null)

    expect(markup.match(/role="alert"/g)).toHaveLength(2)
    expect(markup.match(/Reload the page to check your access/g)).toHaveLength(2)
    expect(markup.match(/<button disabled="">Refresh<\/button>/g)).toHaveLength(2)
    expect(markup).not.toContain('Loading daily brief')
    expect(markup).not.toContain('generatedAt')
  })
})
