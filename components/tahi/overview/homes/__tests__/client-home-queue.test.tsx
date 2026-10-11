import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// The repo has no DOM test runtime. This small hook host exercises the actual
// board's event handlers and renders each resulting tree with ReactDOMServer.
const host = vi.hoisted(() => ({
  active: false,
  index: 0,
  updating: false,
  slots: [] as Array<{ value?: unknown; deps?: readonly unknown[] }>,
  effects: [] as Array<() => void>,
  refresh: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/use-resource', () => ({
  useResource: (key: string | null) => ({
    data: key === '/api/portal/subscription' ? { clientType: 'retainer', seat: 'admin', subscription: null }
      : key?.startsWith('/api/portal/requests') ? { requests: [] } : { items: [] },
    isLoading: false,
    mutate: host.refresh,
  }),
}))
vi.mock('@/lib/display-currency-context', () => ({ useDisplayCurrency: () => ({ formatNative: (amount: number) => String(amount) }) }))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useMemo<T>(factory: () => T, deps: readonly unknown[]) {
      return host.active ? factory() : actual.useMemo(factory, deps)
    },
    useCallback<T extends (...args: never[]) => unknown>(callback: T, deps: readonly unknown[]) {
      return host.active ? callback : actual.useCallback(callback, deps)
    },
    useState(initial: unknown) {
      if (!host.active) return actual.useState(initial)
      const index = host.index++
      if (!host.slots[index]) host.slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [host.slots[index].value, (next: unknown) => {
        host.updating = true
        try {
          host.slots[index].value = typeof next === 'function' ? next(host.slots[index].value) : next
        } finally { host.updating = false }
      }]
    },
    useRef(initial: unknown) {
      if (!host.active) return actual.useRef(initial)
      const index = host.index++
      if (!host.slots[index]) host.slots[index] = { value: { current: initial } }
      return host.slots[index].value
    },
    useEffect(effect: () => void, deps: readonly unknown[]) {
      if (!host.active) return actual.useEffect(effect, deps)
      const index = host.index++
      const old = host.slots[index]?.deps
      if (!old || deps.some((dep, i) => !Object.is(dep, old[i]))) host.effects.push(effect)
      host.slots[index] = { deps }
    },
  }
})

import { ClientHome, TrackBoard } from '@/components/tahi/overview/homes/client-home'

type Props = Parameters<typeof TrackBoard>[0]
type Element = { type: unknown; props: Record<string, unknown> }

function nodes(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!isValidElement<Record<string, unknown>>(tree)) return []
  return [tree, ...nodes(tree.props.children as ReactNode)]
}

function view(props: Props) {
  host.index = 0
  host.active = true
  let tree: ReactNode
  try { tree = TrackBoard(props) } finally { host.active = false }
  host.effects.splice(0).forEach(effect => effect())
  return tree
}

function control(tree: ReactNode, label: string) {
  const button = nodes(tree).find(node => node.type === 'button' && node.props['aria-label'] === label)
  if (!button) throw new Error(`Missing control: ${label}`)
  return button.props as { disabled: boolean; onClick: () => Promise<void> }
}

function titles(tree: ReactNode) {
  return nodes(tree).filter(node => node.type === 'li').map(row => nodes(row as ReactNode).find(node => node.type === 'b')?.props.children)
}

const request = (id: string, title: string, queueOrder: number, type = 'small_task') => ({ id, title, queueOrder, type, status: 'submitted', priority: null, dueDate: null, createdAt: '2026-09-01' })
const small = [request('s1', 'Small one', 0), request('s2', 'Small two', 2)]
const large = [request('l1', 'Large one', 1, 'large_task')]
function props(onReorder = vi.fn<Props['onReorder']>().mockResolvedValue(undefined)): Props {
  return {
    tracks: [
      { id: 'synthetic-large-0', type: 'large', synthetic: true, isPriorityTrack: false, currentRequest: null, queue: large },
      { id: 'real-small', type: 'small', isPriorityTrack: false, currentRequest: null, queue: small },
      { id: 'second-small', type: 'small', isPriorityTrack: false, currentRequest: null, queue: small },
    ],
    planLabel: null, ro: false, loading: false, failed: false, onRetry: vi.fn(), onStart: vi.fn(), onReorder,
  }
}

beforeEach(() => {
  host.active = false
  host.index = 0
  host.slots = []
  host.effects = []
  host.updating = false
  host.refresh.mockReset().mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllGlobals())

describe('client home queue persistence', () => {
  it('saves the whole union once through a real track, outside any state updater', async () => {
    const save = vi.fn<Props['onReorder']>().mockImplementation(async () => { expect(host.updating).toBe(false) })
    const input = props(save)
    await control(view(input), 'Move Small one down').onClick()
    expect(save).toHaveBeenCalledExactlyOnceWith('real-small', ['l1', 's1', 's2'])
    expect(titles(view(input))).toEqual(['Large one', 'Small one', 'Small two'])
  })

  it('locks overlapping moves and explicitly rolls back a rejected save with unchanged incoming IDs', async () => {
    let rejectSave!: (reason: Error) => void
    const save = vi.fn<Props['onReorder']>().mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectSave = reject }))
    const input = props(save)
    const before = view(input)
    const staleControl = control(before, 'Move Small two up')
    const saving = control(before, 'Move Small one down').onClick()
    await staleControl.onClick()
    expect(save).toHaveBeenCalledTimes(1)
    const pending = view(input)
    expect(titles(pending)).toEqual(['Large one', 'Small one', 'Small two'])
    expect(control(pending, 'Move Small two up').disabled).toBe(true)
    rejectSave(new Error('HTTP 403 or network failure'))
    await saving
    const restored = view(input)
    expect(titles(restored)).toEqual(['Small one', 'Large one', 'Small two'])
    expect(renderToStaticMarkup(restored)).toContain('Showing the previous order.')
    expect(renderToStaticMarkup(restored)).toContain('role="alert"')
    save.mockResolvedValue(undefined)
    await control(restored, 'Move Small two up').onClick()
    expect(titles(view(input))).toEqual(['Small one', 'Small two', 'Large one'])
  })

  it('accepts incoming order changes even when the queue ID sequence is unchanged', async () => {
    const input = props()
    await control(view(input), 'Move Small one down').onClick()
    const updated = { ...input, tracks: input.tracks.map(track => ({ ...track, queue: track.queue.map(r => ({ ...r, queueOrder: r.id === 's2' ? 0 : r.id === 'l1' ? 1 : 2 })) })) }
    expect(titles(view(updated))).toEqual(['Small two', 'Large one', 'Small one'])
  })

  it('hides controls for read-only and synthetic-only boards and identifies setup lanes', () => {
    const readOnly = props()
    readOnly.ro = true
    expect(nodes(view(readOnly)).some(node => String(node.props['aria-label'] ?? '').startsWith('Move '))).toBe(false)
    const synthetic = props()
    synthetic.tracks = synthetic.tracks.slice(0, 1)
    const tree = view(synthetic)
    expect(nodes(tree).some(node => String(node.props['aria-label'] ?? '').startsWith('Move '))).toBe(false)
    expect(renderToStaticMarkup(tree)).toContain('On your plan, not live yet.')
    expect(renderToStaticMarkup(tree)).not.toContain('Ready for your next request')
  })
})

function pageReorder(ro = false): Props['onReorder'] {
  host.active = true
  host.index = 0
  let page: ReactNode
  try {
    page = ClientHome({ ctx: { audience: 'client', isReadOnly: ro, go: vi.fn() } })
  } finally { host.active = false }
  const board = nodes(page).find(node => node.type === TrackBoard)
  if (!board) throw new Error('Missing track board')
  return board.props.onReorder as Props['onReorder']
}

describe('client home queue HTTP boundary', () => {
  it('rejects unsuccessful HTTP responses so the board can roll back', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetcher)
    await expect(pageReorder()('real', ['small', 'large'])).rejects.toThrow('Queue reorder failed')
    expect(fetcher).toHaveBeenCalledWith('/api/portal/tracks/real/reorder', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestIds: ['small', 'large'] }),
    })
    expect(host.refresh).not.toHaveBeenCalled()
  })

  it('keeps an acknowledged write successful when only its refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    host.refresh.mockRejectedValue(new Error('Refresh offline'))
    await expect(pageReorder()('real', ['small', 'large'])).resolves.toBeUndefined()
    expect(host.refresh).toHaveBeenCalledOnce()
  })

  it('refuses read-only writes before fetching', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(pageReorder(true)('real', ['small'])).rejects.toThrow('Queue reorder is unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
