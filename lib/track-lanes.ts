/**
 * lib/track-lanes.ts — bucket an org's capacity (tracks + queue + recently-
 * delivered) into per-track kanban lanes. Shared by the client /tracks page and
 * the admin client-detail Track tab so there is one source of truth.
 *
 * Pure data transform (no DB / React).
 */

import { trackCanHandle } from '@/lib/plan-utils'
import { trackDeliveredStats } from '@/lib/track-stats'
import type { TrackLanes, TrackLaneItem } from '@/components/tahi/track-queue-view'

export interface CapTrack {
  id: string
  type: 'small' | 'large'
  isPriorityTrack: number | boolean | null
  currentRequestId: string | null
  currentRequest: CapRequest | null
}
export interface CapRequest {
  id: string
  title: string
  type: string
  status: string
  priority: string
  trackId?: string | null
  queueOrder?: number | null
  dueDate?: string | null
  assigneeName?: string | null
  createdAt?: string | null
  deliveredAt?: string | null
}
export interface CapacityResponse {
  subscription?: { planType: string | null; hasPrioritySupport: boolean | null } | null
  tracks: CapTrack[]
  queue: CapRequest[]
  delivered?: CapRequest[]
  /** Per-client override (added in the override slice). */
  tracksMode?: 'auto' | 'custom' | 'off'
}

const UP_NEXT = new Set(['submitted', 'queued'])
const IN_PROGRESS = new Set(['in_progress', 'in_review'])
const REVIEW = new Set(['client_review'])

function toLaneItem(r: CapRequest): TrackLaneItem {
  return {
    id: r.id, title: r.title, type: r.type, status: r.status, priority: r.priority,
    queueOrder: r.queueOrder ?? null, dueDate: r.dueDate ?? null,
    assigneeName: r.assigneeName ?? null, deliveredAt: r.deliveredAt ?? null,
  }
}

/** Bucket into per-track lanes (Up next / In progress / Review / Delivered),
 *  distributing untracked work to the first eligible track. */
export function bucketTracks(data: CapacityResponse): TrackLanes[] {
  const capTracks = data.tracks ?? []
  const queue = data.queue ?? []
  const delivered = data.delivered ?? []

  const eligibleTrackId = (reqType: string): string | null =>
    capTracks.find(tk => trackCanHandle(tk.type, reqType))?.id ?? null

  const byTrack = new Map<string, TrackLanes>()
  for (const t of capTracks) {
    byTrack.set(t.id, {
      id: t.id, type: t.type,
      isPriorityTrack: t.isPriorityTrack === 1 || t.isPriorityTrack === true,
      upNext: [], inProgress: [], review: [], delivered: [],
      deliveredCount: 0, avgTurnaroundDays: null,
    })
  }

  const place = (r: CapRequest, lane: 'upNext' | 'inProgress' | 'review' | 'delivered') => {
    const tid = (r.trackId && byTrack.has(r.trackId)) ? r.trackId : eligibleTrackId(r.type)
    if (!tid) return
    byTrack.get(tid)![lane].push(toLaneItem(r))
  }

  for (const t of capTracks) {
    const cur = t.currentRequest
    if (!cur) continue
    const lane = IN_PROGRESS.has(cur.status) ? 'inProgress'
      : REVIEW.has(cur.status) ? 'review'
      : UP_NEXT.has(cur.status) ? 'upNext' : null
    if (lane) byTrack.get(t.id)![lane].push(toLaneItem({ ...cur, trackId: t.id }))
  }
  for (const r of queue) {
    if (UP_NEXT.has(r.status)) place(r, 'upNext')
    else if (IN_PROGRESS.has(r.status)) place(r, 'inProgress')
    else if (REVIEW.has(r.status)) place(r, 'review')
  }

  const deliveredRaw = new Map<string, CapRequest[]>()
  for (const r of delivered) {
    const tid = (r.trackId && byTrack.has(r.trackId)) ? r.trackId : eligibleTrackId(r.type)
    if (!tid) continue
    byTrack.get(tid)!.delivered.push(toLaneItem(r))
    const arr = deliveredRaw.get(tid) ?? []
    arr.push(r); deliveredRaw.set(tid, arr)
  }

  const now = new Date().toISOString()
  for (const [tid, lanes] of byTrack) {
    lanes.upNext.sort((a, b) => (a.queueOrder ?? 9999) - (b.queueOrder ?? 9999))
    const stats = trackDeliveredStats(deliveredRaw.get(tid) ?? [], now, 30)
    lanes.deliveredCount = stats.count
    lanes.avgTurnaroundDays = stats.avgTurnaroundDays
  }

  return [...byTrack.values()].sort((a, b) =>
    (a.type === 'large' && b.type === 'small') ? -1
      : (a.type === 'small' && b.type === 'large') ? 1 : 0)
}

/** Unified view (tracks off): one board holding ALL the org's work in lanes. */
export function bucketUnified(data: CapacityResponse): TrackLanes {
  const all: CapRequest[] = [
    ...(data.tracks ?? []).map(t => t.currentRequest).filter((r): r is CapRequest => !!r),
    ...(data.queue ?? []),
  ]
  const lanes: TrackLanes = {
    id: 'unified', type: 'large', isPriorityTrack: false,
    upNext: [], inProgress: [], review: [], delivered: [],
    deliveredCount: 0, avgTurnaroundDays: null,
  }
  const seen = new Set<string>()
  for (const r of all) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    if (UP_NEXT.has(r.status)) lanes.upNext.push(toLaneItem(r))
    else if (IN_PROGRESS.has(r.status)) lanes.inProgress.push(toLaneItem(r))
    else if (REVIEW.has(r.status)) lanes.review.push(toLaneItem(r))
  }
  const delivered = data.delivered ?? []
  for (const r of delivered) lanes.delivered.push(toLaneItem(r))
  lanes.upNext.sort((a, b) => (a.queueOrder ?? 9999) - (b.queueOrder ?? 9999))
  const stats = trackDeliveredStats(delivered, new Date().toISOString(), 30)
  lanes.deliveredCount = stats.count
  lanes.avgTurnaroundDays = stats.avgTurnaroundDays
  return lanes
}
