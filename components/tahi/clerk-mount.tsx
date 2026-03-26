'use client'

import { useEffect, useRef, useState } from 'react'
import { useClerk } from '@clerk/nextjs'
import { Loader2 } from 'lucide-react'

interface AppearanceElements {
  rootBox?: string
  card?: string
  headerTitle?: string
  headerSubtitle?: string
}

interface ClerkMountProps {
  appearance?: { elements?: AppearanceElements }
}

// ── ClerkSignIn ────────────────────────────────────────────────────────────────
// Explicit mount wrapper — avoids relying on @clerk/nextjs server component
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
    if (!ready || !ref.current) return
    clerk.mountSignIn(ref.current, { appearance })
    return () => {
      if (ref.current) clerk.unmountSignIn(ref.current)
    }
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
    if (!ready || !ref.current) return
    clerk.mountSignUp(ref.current, { appearance })
    return () => {
      if (ref.current) clerk.unmountSignUp(ref.current)
    }
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
