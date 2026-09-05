import { describe, it, expect } from 'vitest'
import { mapLimit } from '../concurrency'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}

describe('mapLimit', () => {
  it('keeps the input order whatever order the work settles in', async () => {
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async n => {
      await new Promise(r => setTimeout(r, (6 - n) * 2))
      return n * 10
    })
    expect(out).toEqual([10, 20, 30, 40, 50])
  })

  it('never runs more than the limit at once', async () => {
    let inFlight = 0
    let peak = 0
    await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight -= 1
      return null
    })
    expect(peak).toBe(3)
  })

  it('starts the next item as soon as a slot frees, not in lockstep batches', async () => {
    const gates = [deferred(), deferred(), deferred()]
    const started: number[] = []
    const run = mapLimit([0, 1, 2], 2, async i => {
      started.push(i)
      await gates[i].promise
      return i
    })
    await Promise.resolve()
    expect(started).toEqual([0, 1])
    gates[0].resolve()
    await new Promise(r => setTimeout(r, 0))
    expect(started).toEqual([0, 1, 2])
    gates[1].resolve()
    gates[2].resolve()
    expect(await run).toEqual([0, 1, 2])
  })

  it('handles an empty list and a silly limit', async () => {
    expect(await mapLimit([], 5, async () => 1)).toEqual([])
    expect(await mapLimit([1, 2], 0, async n => n)).toEqual([1, 2])
  })

  it('rejects when the work rejects, exactly as Promise.all does', async () => {
    await expect(mapLimit([1, 2, 3], 2, async n => {
      if (n === 2) throw new Error('nope')
      return n
    })).rejects.toThrow('nope')
  })
})
