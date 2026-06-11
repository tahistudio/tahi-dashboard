'use client'

/**
 * <Reveal>. Fade-up entrance animation that fires exactly once per route
 * per session for a given id.
 *
 * The entrance fires only the first time a given id is seen this session.
 * Subsequent renders of the same id (refetch, filter change, tab switch,
 * pagination) are completely motionless. This is the #1 rule: replayed
 * entrances are the leading cheap-dashboard tell.
 *
 *   <Reveal id="overview-kpis">
 *     <KpiStrip />
 *   </Reveal>
 *
 *   <Reveal id="requests-list" stagger>
 *     {rows.map(r => <RequestCard key={r.id} {...r} />)}
 *   </Reveal>
 *
 * Props:
 *   id        Stable string key for the session-dedup check. Defaults to
 *             the current pathname so every page gets a unique slot for free.
 *             Pass an explicit id when multiple Reveal zones live on one page.
 *   stagger   When true applies `.tahi-stagger` (cascading child delays)
 *             instead of `.tahi-reveal` (single-element fade-up).
 *   as        HTML element to render. Default 'div'.
 *   className, style, children forwarded as-is.
 *
 * Session persistence: a module-level Set<string> tracks seen ids in memory
 * and is mirrored to sessionStorage('tahi-revealed') as a JSON array so the
 * state survives hot-reload in dev but resets on a new browser tab/session.
 * SSR renders with no animation class (avoids hydration mismatch); the
 * animation class is applied via useEffect on mount.
 */

import React, { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

// ── Session-dedup store ──────────────────────────────────────────────────────

const SESSION_KEY = 'tahi-revealed'

/** In-memory set for the current JS context. Populated from sessionStorage on
 *  first access so hot-reload in dev preserves the seen state. */
const seenIds: Set<string> = (() => {
  try {
    const raw = typeof sessionStorage !== 'undefined'
      ? sessionStorage.getItem(SESSION_KEY)
      : null
    if (raw) return new Set<string>(JSON.parse(raw) as string[])
  } catch {
    // sessionStorage unavailable (SSR, sandboxed iframe, etc.) - start empty.
  }
  return new Set<string>()
})()

function markSeen(id: string): void {
  seenIds.add(id)
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify([...seenIds]))
    }
  } catch {
    // Ignore write failures (storage full, etc.)
  }
}

function hasBeenSeen(id: string): boolean {
  return seenIds.has(id)
}

// ── Types ────────────────────────────────────────────────────────────────────

type ValidTag = 'div' | 'section' | 'article' | 'ul' | 'ol' | 'nav' | 'main'

interface RevealProps {
  /** Stable key for the session-dedup check. Defaults to current pathname. */
  id?: string
  /** Use .tahi-stagger (cascading children) instead of .tahi-reveal. */
  stagger?: boolean
  /** HTML tag to render. Default 'div'. */
  as?: ValidTag
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}

// ── Component ────────────────────────────────────────────────────────────────

export function Reveal({
  id: idProp,
  stagger = false,
  as: Tag = 'div',
  className,
  style,
  children,
}: RevealProps) {
  const pathname = usePathname()
  const id = idProp ?? pathname

  // SSR: start with no animation class to avoid hydration mismatch.
  // The ref tracks whether we have applied the class yet so the effect
  // only fires once even in React StrictMode's double-invoke.
  const [animClass, setAnimClass] = useState<string>('')
  const applied = useRef(false)

  useEffect(() => {
    if (applied.current) return
    applied.current = true

    if (hasBeenSeen(id)) {
      // Already played this session - render immediately visible, no class.
      setAnimClass('')
      return
    }

    // First render for this id this session: apply the entrance class.
    markSeen(id)
    setAnimClass(stagger ? 'tahi-stagger' : 'tahi-reveal')
  }, [id, stagger])

  const combinedClass = [animClass, className].filter(Boolean).join(' ') || undefined

  return (
    <Tag className={combinedClass} style={style}>
      {children}
    </Tag>
  )
}
