'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import type { QaBrowserKey, QaComment, QaElementContext, QaPin, QaViewportKey } from '@/lib/qa/types'
import { isStaleLoad, mergeLoadedComments, numberComments, pinsFor, type NumberedComment } from './comments-helpers'

export interface AddCommentInput {
  viewport: QaViewportKey
  /** Defaults to the browser the hook was given. */
  browser?: QaBrowserKey
  selector: string
  ox: number
  oy: number
  elementTag?: string
  elementText?: string
  elementContext?: QaElementContext
  body: string
}

export interface UpdateCommentPatch {
  body?: string
  status?: 'open' | 'resolved'
  requestId?: string
}

export interface UseCommentsResult {
  comments: NumberedComment[]
  loading: boolean
  error: string | null
  /** Refetches this page's comments. Resolves true when they loaded. Optimistic edits still in flight are kept. */
  refresh: () => Promise<boolean>
  /** Creates a comment. Rejects with a readable message on failure so the composer can stay open. */
  add: (input: AddCommentInput) => Promise<QaComment>
  /** Applies a patch optimistically. On failure it rolls back, toasts once and rejects so a caller can keep its form open. */
  update: (id: string, patch: UpdateCommentPatch) => Promise<void>
  /** Deletes a comment. Rejects with a readable message on failure after toasting. */
  remove: (id: string) => Promise<void>
  /** Adds a note to a comment thread; resolve also resolves the comment. Rejects with a readable message after toasting. */
  addNote: (commentId: string, body: string, resolve?: boolean) => Promise<void>
  /** Deletes one note from a thread. Rejects with a readable message after toasting. */
  removeNote: (commentId: string, noteId: string) => Promise<void>
  /** When the comments were last loaded from the server, or null before the first load. */
  loadedAt: number | null
  pinsFor: (viewport: QaViewportKey) => QaPin[]
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`
}

function sameIdentity(a: QaComment, b: QaComment): boolean {
  return a.id === b.id
}

/**
 * Loads the element comments for one round page and keeps them in sync with
 * the API. Pin numbers are computed here so the list and the pins agree.
 * Responses for a previous round page are ignored. Comments are loaded for every browser;
 * new comments and the pins pinsFor returns belong to the browser being tested.
 */
export function useComments(roundPageId: string | null, readOnly: boolean, browser: QaBrowserKey): UseCommentsResult {
  const { showToast } = useToast()
  const [comments, setComments] = useState<QaComment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  // Comments with a PATCH still in flight, keyed by id. A refresh keeps their optimistic value.
  const inFlightRef = useRef<Map<string, QaComment>>(new Map())
  // Bumped by every local write; a load that started before the latest bump is stale.
  const writeSeqRef = useRef(0)
  // The round page the hook is showing now. Responses for any other id are stale.
  const latestIdRef = useRef<string | null>(roundPageId)
  latestIdRef.current = roundPageId
  // Latest list, read by optimistic writes so rollback never depends on a state updater running.
  const commentsRef = useRef<QaComment[]>([])
  commentsRef.current = comments
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly
  const browserRef = useRef(browser)
  browserRef.current = browser

  const load = useCallback(async (id: string, retries = 1): Promise<boolean> => {
    setLoading(true)
    const startedAtSeq = writeSeqRef.current
    try {
      const res = await fetch(apiPath(`/api/admin/qa/round-pages/${encodeURIComponent(id)}/comments`))
      if (!res.ok) throw new Error(await readError(res))
      const json = (await res.json()) as { comments?: QaComment[] }
      if (latestIdRef.current !== id) return false
      // A local write landed while this was loading: its response is older than what is on screen. Try once more.
      if (isStaleLoad(startedAtSeq, writeSeqRef.current)) {
        if (retries > 0) return await load(id, retries - 1)
        // Still behind a newer local write: nothing was pulled in, so do not report a refresh.
        return false
      }
      setComments(mergeLoadedComments(json.comments ?? [], inFlightRef.current))
      setError(null)
      setLoadedAt(Date.now())
      return true
    } catch (err) {
      if (latestIdRef.current !== id) return false
      // A failed refresh keeps the list on screen; the caller reports it.
      if (commentsRef.current.length === 0) setError(err instanceof Error ? err.message : 'Could not load comments.')
      return false
    } finally {
      if (latestIdRef.current === id) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setComments([])
    setError(null)
    setLoadedAt(null)
    inFlightRef.current.clear()
    if (!roundPageId) {
      setLoading(false)
      return
    }
    void load(roundPageId)
  }, [roundPageId, load])

  const refresh = useCallback(async (): Promise<boolean> => {
    const id = latestIdRef.current
    if (!id) return false
    return load(id)
  }, [load])

  const add = useCallback(async (input: AddCommentInput): Promise<QaComment> => {
    const id = latestIdRef.current
    if (!id) throw new Error('No round page selected.')
    if (readOnlyRef.current) throw new Error('This round is closed.')
    const res = await fetch(apiPath(`/api/admin/qa/round-pages/${encodeURIComponent(id)}/comments`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, browser: input.browser ?? browserRef.current }),
    })
    if (!res.ok) throw new Error(await readError(res))
    const json = (await res.json()) as { comment: QaComment }
    if (latestIdRef.current === id) {
      writeSeqRef.current += 1
      setComments(prev => [...prev.filter(c => !sameIdentity(c, json.comment)), json.comment])
    }
    return json.comment
  }, [])

  const update = useCallback(async (commentId: string, patch: UpdateCommentPatch) => {
    if (readOnlyRef.current) {
      showToast('This round is closed.', 'error')
      throw new Error('This round is closed.')
    }
    const previous = commentsRef.current.find(c => c.id === commentId)
    if (!previous) return
    const optimistic = applyOptimistic(previous, patch)
    inFlightRef.current.set(commentId, optimistic)
    writeSeqRef.current += 1
    setComments(prev => prev.map(c => (c.id === commentId ? applyOptimistic(c, patch) : c)))
    try {
      const res = await fetch(apiPath(`/api/admin/qa/comments/${encodeURIComponent(commentId)}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(await readError(res))
      const json = (await res.json()) as { comment: QaComment }
      writeSeqRef.current += 1
      setComments(prev => prev.map(c => (c.id === commentId ? json.comment : c)))
    } catch (err) {
      writeSeqRef.current += 1
      setComments(prev => prev.map(c => (c.id === commentId ? previous : c)))
      const message = err instanceof Error ? err.message : 'Could not save that change.'
      showToast(message, 'error')
      throw new Error(message)
    } finally {
      inFlightRef.current.delete(commentId)
    }
  }, [showToast])

  const remove = useCallback(async (commentId: string) => {
    if (readOnlyRef.current) {
      showToast('This round is closed.', 'error')
      throw new Error('This round is closed.')
    }
    try {
      const res = await fetch(apiPath(`/api/admin/qa/comments/${encodeURIComponent(commentId)}`), { method: 'DELETE' })
      if (!res.ok) throw new Error(await readError(res))
      writeSeqRef.current += 1
      setComments(prev => prev.filter(c => c.id !== commentId))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not delete the comment.'
      showToast(message, 'error')
      throw new Error(message)
    }
  }, [showToast])

  const addNote = useCallback(async (commentId: string, body: string, resolve = false) => {
    if (readOnlyRef.current) {
      showToast('This round is closed.', 'error')
      throw new Error('This round is closed.')
    }
    try {
      const res = await fetch(apiPath(`/api/admin/qa/comments/${encodeURIComponent(commentId)}/notes`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(resolve ? { body, resolve: true } : { body }),
      })
      if (!res.ok) throw new Error(await readError(res))
      const json = (await res.json()) as { comment: QaComment }
      writeSeqRef.current += 1
      setComments(prev => prev.map(c => (c.id === commentId ? json.comment : c)))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not add the note.'
      showToast(message, 'error')
      throw new Error(message)
    }
  }, [showToast])

  const removeNote = useCallback(async (commentId: string, noteId: string) => {
    if (readOnlyRef.current) {
      showToast('This round is closed.', 'error')
      throw new Error('This round is closed.')
    }
    try {
      const res = await fetch(apiPath(`/api/admin/qa/comments/${encodeURIComponent(commentId)}/notes/${encodeURIComponent(noteId)}`), { method: 'DELETE' })
      if (!res.ok) throw new Error(await readError(res))
      writeSeqRef.current += 1
      setComments(prev => prev.map(c => {
        if (c.id !== commentId) return c
        const notes = c.notes.filter(n => n.id !== noteId)
        return { ...c, notes, noteCount: notes.length }
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not delete the note.'
      showToast(message, 'error')
      throw new Error(message)
    }
  }, [showToast])

  const numbered = useMemo(() => numberComments(comments), [comments])

  const pinsForViewport = useCallback(
    (viewport: QaViewportKey) => pinsFor(numbered, viewport, browser),
    [numbered, browser],
  )

  return {
    comments: numbered,
    loading,
    error,
    refresh,
    add,
    update,
    remove,
    addNote,
    removeNote,
    loadedAt,
    pinsFor: pinsForViewport,
  }
}

/** Mirrors the server fields a PATCH can change, so the list updates before the response. */
function applyOptimistic(comment: QaComment, patch: UpdateCommentPatch): QaComment {
  const next: QaComment = { ...comment }
  if (patch.body !== undefined) next.body = patch.body
  if (patch.requestId !== undefined) next.requestId = patch.requestId
  if (patch.status !== undefined) {
    next.status = patch.status
    next.resolvedAt = patch.status === 'resolved' ? new Date().toISOString() : null
  }
  return next
}
