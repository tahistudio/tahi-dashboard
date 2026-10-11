/** The queue is shared by lanes of the same size, rather than owned by a lane. */
export interface QueueRequest {
  id: string
  type: string
  queueOrder: number | null
  createdAt: string
}

interface QueueTrack<T extends QueueRequest> {
  id: string
  synthetic?: boolean
  queue: readonly T[]
}

export function unifiedQueue<T extends QueueRequest>(tracks: readonly QueueTrack<T>[]): T[] {
  const unique = new Map<string, T>()
  for (const track of tracks) {
    for (const request of track.queue) {
      if (!unique.has(request.id)) unique.set(request.id, request)
    }
  }
  return [...unique.values()].sort((a, b) => {
    const position = (a.queueOrder ?? Infinity) - (b.queueOrder ?? Infinity)
    if (position && !Number.isNaN(position)) return position
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  })
}

export function reorderTrackId(tracks: readonly { id: string; synthetic?: boolean }[]): string | null {
  return tracks.find(track => !track.synthetic && !track.id.startsWith('synthetic-'))?.id ?? null
}

export function nextUpIds(queue: readonly QueueRequest[]): Set<string> {
  const types = new Set<string>()
  const ids = new Set<string>()
  for (const request of queue) {
    if (!types.has(request.type)) {
      types.add(request.type)
      ids.add(request.id)
    }
  }
  return ids
}

/** Returns a new order, or null when there is no adjacent item to swap. */
export function moveQueueItem<T>(queue: readonly T[], index: number, direction: -1 | 1): T[] | null {
  const target = index + direction
  if (index < 0 || index >= queue.length || target < 0 || target >= queue.length) return null
  const moved = [...queue]
  ;[moved[index], moved[target]] = [moved[target], moved[index]]
  return moved
}
