'use client'

import { useEffect, useRef, useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { Loader2 } from 'lucide-react'

interface ClerkMountProps {
  /** Clerk appearance config. Loosely typed because the underlying
   *  Clerk Appearance type is large and version-specific; we pass it
   *  through verbatim to clerk.mountSignIn / mountSignUp. */
  appearance?: Record<string, unknown>
}

// ── ClerkSignIn ────────────────────────────────────────────────────────────────
// Explicit mount wrapper; avoids relying on @clerk/nextjs server component
// auto-detection, which can fail in Webflow Cloud / edge-runtime environments.

export function ClerkSignIn({ appearance }: ClerkMountProps) {
  const clerk = useClerk()
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  // Poll until Clerk is ready (usually instant after initial load)
  useEffect(() => {
    if (clerk.loaded) { setReady(true); return }
    const timer = setInterval(() => {
      if (clerk.loaded) { setReady(true); clearInterval(timer) }
    }, 100)
    return () => clearInterval(timer)
  }, [clerk.loaded])

  useEffect(() => {
    const node = ref.current
    if (!ready || !node) return
    // Explicit path routing so the multi-step flow (e.g. email-code verify)
    // navigates within the [[...sign-in]] catch-all instead of falling through
    // to the default redirect (which the middleware bounces to /sign-in).
    clerk.mountSignIn(node, { appearance, routing: 'path', path: '/sign-in' })
    return () => clerk.unmountSignIn(node)
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-brand)]" />
      </div>
    )
  }

  return <div ref={ref} className="w-full" />
}

// ── ClerkSignUp ────────────────────────────────────────────────────────────────

export function ClerkSignUp({ appearance }: ClerkMountProps) {
  const clerk = useClerk()
  const ref = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (clerk.loaded) { setReady(true); return }
    const timer = setInterval(() => {
      if (clerk.loaded) { setReady(true); clearInterval(timer) }
    }, 100)
    return () => clearInterval(timer)
  }, [clerk.loaded])

  useEffect(() => {
    const node = ref.current
    if (!ready || !node) return
    // Explicit path routing so the email-code verification step renders on
    // /sign-up/verify-email-address instead of redirecting to the default URL
    // (which lands an unverified, session-less user back on /sign-in).
    clerk.mountSignUp(node, { appearance, routing: 'path', path: '/sign-up' })
    return () => clerk.unmountSignUp(node)
  }, [ready]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--color-brand)]" />
      </div>
    )
  }

  return <div ref={ref} className="w-full" />
}
