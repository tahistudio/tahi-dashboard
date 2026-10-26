'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import type { QaComment, QaPin, QaViewportKey } from '@/lib/qa/types'
import { numberComments, pinsFor, type NumberedComment } from './comments-helpers'

export interface AddCommentInput {
  viewport: QaViewportKey
  selector: string
  ox: number
  oy: number
  elementTag?: string
  elementText?: string
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
  refresh: () => Promise<void>
  /** Creates a comment. Rejects with a readable message on failure so the composer can stay open. */
  add: (input: AddCommentInput) => Promise<QaComment>
  /** Applies a patch optimistically. On failure it rolls back, toasts once and rejects so a caller can keep its form open. */
  update: (id: string, patch: UpdateCommentPatch) => Promise<void>
  /** Deletes a comment. Rejects with a readable message on failure after toasting. */
  remove: (id: string) => Promise<void>
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
 * Responses for a previous round page are ignored.
 */
export function useComments(roundPageId: string | null, readOnly: boolean): UseCommentsResult {
  const { showToast } = useToast()
  const [comments, setComments] = useState<QaComment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The round page the hook is showing now. Responses for any other id are stale.
  const latestIdRef = useRef<string | null>(roundPageId)
  latestIdRef.current = roundPageId
  // Latest list, read by optimistic writes so rollback never depends on a state updater running.
  const commentsRef = useRef<QaComment[]>([])
  commentsRef.current = comments
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  const load = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/qa/round-pages/${encodeURIComponent(id)}/comments`))
      if (!res.ok) throw new Error(await readError(res))
      const json = (await res.json()) as { comments?: QaComment[] }
      if (latestIdRef.current !== id) return
      setComments(json.comments ?? [])
      setError(null)
    } catch (err) {
      if (latestIdRef.current !== id) return
      setError(err instanceof Error ? err.message : 'Could not load comments.')
    } finally {
      if (latestIdRef.current === id) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setComments([])
    setError(null)
    if (!roundPageId) {
      setLoading(false)
      return
    }
    void load(roundPageId)
  }, [roundPageId, load])

  const refresh = useCallback(async () => {
    const id = latestIdRef.current
    if (!id) return
    await load(id)
  }, [load])

  const add = useCallback(async (input: AddCommentInput): Promise<QaComment> => {
    const id = latestIdRef.current
    if (!id) throw new Error('No round page selected.')
    if (readOnlyRef.current) throw new Error('This round is closed.')
    const res = await fetch(apiPath(`/api/admin/qa/round-pages/${encodeURIComponent(id)}/comments`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) throw new Error(await readError(res))
    const json = (await res.json()) as { comment: QaComment }
    if (latestIdRef.current === id) {
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
    setComments(prev => prev.map(c => (c.id === commentId ? applyOptimistic(c, patch) : c)))
    try {
      const res = await fetch(apiPath(`/api/admin/qa/comments/${encodeURIComponent(commentId)}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(await readError(res))
      const json = (await res.json()) as { comment: QaComment }
      setComments(prev => prev.map(c => (c.id === commentId ? json.comment : c)))
    } catch (err) {
      setComments(prev => prev.map(c => (c.id === commentId ? previous : c)))
      const message = err instanceof Error ? err.message : 'Could not save that change.'
      showToast(message, 'error')
      throw new Error(message)
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
      setComments(prev => prev.filter(c => c.id !== commentId))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not delete the comment.'
      showToast(message, 'error')
      throw new Error(message)
    }
  }, [showToast])

  const numbered = useMemo(() => numberComments(comments), [comments])

  const pinsForViewport = useCallback(
    (viewport: QaViewportKey) => pinsFor(numbered, viewport),
    [numbered],
  )

  return {
    comments: numbered,
    loading,
    error,
    refresh,
    add,
    update,
    remove,
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
