'use client'

/**
 * The offline fallback the service worker serves for a failed navigation.
 *
 * Ported from the Claude Design module portal-account.jsx (Offline). The live
 * page was a terminal screen whose only exit was a browser reload; this one has
 * a retry, an honest "still nothing" follow-up, a back-online state, and two
 * lines of reassurance that submitted work is safe.
 */

import { useState, useEffect, useCallback } from 'react'
import { apiPath } from '@/lib/api'

type State = 'offline' | 'checking' | 'still' | 'back'

/** Icon paths from the design's own set (portal-account-kit.jsx). */
const PATHS = {
  wifioff: 'M2 2l20 20 M8.6 16.6a4.8 4.8 0 0 1 6.8 0 M5.2 13.2a9.6 9.6 0 0 1 3-2 M18.9 13.2a9.6 9.6 0 0 0-4.4-2.4 M1.6 9.6a14.6 14.6 0 0 1 4.8-3 M22.4 9.6a14.6 14.6 0 0 0-10.6-3.6 M12 20h.01',
  check: 'M20 6L9 17l-5-5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7.5V12l3 1.8',
  refresh: 'M20.5 12a8.5 8.5 0 1 1-2.6-6.1 M20.5 2.5v5h-5',
  leaf: 'M20 4c-8 0-14 4-15 12 0 3 1 4 3 4 8-1 12-7 12-16z',
  leafVein: 'M5 20c3-6 7-9 11-11',
} as const

function Ic({ d, s = 16, sw = 2 }: { d: string; s?: number; sw?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((seg, i) => <path key={i} d={(i ? 'M' : '') + seg} />)}
    </svg>
  )
}

export function OfflineContent() {
  const [state, setState] = useState<State>('offline')

  // A real round trip, not navigator.onLine: "connected to a router" is not
  // the same as "can reach the dashboard".
  const probe = useCallback(async () => {
    try {
      const res = await fetch(apiPath('/manifest.json'), { cache: 'no-store' })
      return res.ok
    } catch {
      return false
    }
  }, [])

  // The browser tells us the moment the radio comes back; the retry button is
  // for the case where it is lying (captive portal, flaky uplink).
  useEffect(() => {
    const onOnline = () => setState('back')
    const onOffline = () => setState('offline')
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // The worker only serves this page when fetch() REJECTS, and navigator.onLine
  // is still true for nearly every one of those failures (DNS down, connection
  // refused, wifi up but no WAN). Trusting it on mount made the page announce
  // "you are back online" the instant it appeared, which is the one thing it
  // knows to be untrue. So the mount check is the same round trip the button
  // makes, and it only ever promotes to "back": a failed probe leaves the page
  // saying exactly what it already said.
  useEffect(() => {
    let live = true
    probe().then(ok => { if (live && ok) setState('back') }).catch(() => {})
    return () => { live = false }
  }, [probe])

  const retry = useCallback(async () => {
    setState('checking')
    const ok = await probe()
    setState(ok ? 'back' : 'still')
  }, [probe])

  const back = state === 'back'

  return (
    <div className="pa-offline" data-state={state}>
      <div className="pa-off-card">
        <span className={'pa-off-tile' + (back ? ' ok' : '')} aria-hidden="true">
          <Ic d={back ? PATHS.check : PATHS.wifioff} s={26} sw={1.9} />
        </span>
        <h1>{back ? 'You are back online.' : 'You are offline'}</h1>
        <p>
          {back
            ? 'The connection is steady again. Reload and pick up where you left off.'
            : 'Your connection dropped, and the dashboard needs one to load. Nothing you had typed is lost.'}
        </p>

        {state === 'still' && (
          <p className="pa-off-still" role="status">
            <Ic d={PATHS.refresh} s={14} />
            Still nothing. Check your wifi or mobile data, then try again.
          </p>
        )}

        {/* A form, not a bare button: the worker precaches this document but
            not its JS chunk, so on a cold HTTP cache the page can render
            without ever hydrating. Unhydrated, the submit is a plain GET at
            the dashboard root, which is the very thing the button is for.
            Hydrated, onSubmit takes over and does the round trip in place. */}
        <form
          className="pa-off-actions"
          action={apiPath('/')}
          onSubmit={(e) => {
            e.preventDefault()
            if (back) { window.location.reload(); return }
            retry().catch(() => setState('still'))
          }}
        >
          <button type="submit" className="pa-off-btn" disabled={state === 'checking'}>
            <Ic d={PATHS.refresh} s={15} />
            {back
              ? 'Reload the dashboard'
              : state === 'checking' ? 'Checking' : 'Try again'}
          </button>
        </form>

        <ul className="pa-off-list">
          <li><Ic d={PATHS.check} s={14} />Anything you already sent is with the studio.</li>
          <li><Ic d={PATHS.clock} s={14} />Requests, files and invoices come back the moment you reconnect.</li>
        </ul>

        <p className="pa-off-foot">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={PATHS.leaf} />
            <path d={PATHS.leafVein} />
          </svg>
          Tahi Studio &middot; portal.tahi.studio
        </p>
      </div>
    </div>
  )
}
