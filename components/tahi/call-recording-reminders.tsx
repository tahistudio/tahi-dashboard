'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useImpersonation } from '@/components/tahi/impersonation-banner'
import { useToast } from '@/components/tahi/toast'
import { apiPath } from '@/lib/api'
import {
  callReminderKey, claimCallReminder, dueRecordingReminders, recordingReminderHref, reminderWithName,
  type CallReminderIdentity, type ReminderCall,
} from '@/lib/call-recording-reminders'

interface ScheduledReminderCall extends Omit<ReminderCall, 'kind'> { status: string }
type DiscoveryReminderCall = Omit<ReminderCall, 'kind'>

async function fetchCalls<T>(path: string, signal: AbortSignal): Promise<T[]> {
  const response = await fetch(apiPath(path), { cache: 'no-store', signal })
  if (!response.ok) throw new Error('Call reminders could not be checked.')
  const result = await response.json() as { calls?: T[] }
  if (!Array.isArray(result.calls)) throw new Error('Call reminders could not be checked.')
  return result.calls
}

/** Only prompts. Capture still requires Record call and browser permissions. */
export function CallRecordingReminders({ identity }: { identity: CallReminderIdentity | null }) {
  const pathname = usePathname()
  const recorderPage = pathname.replace(/\/$/, '').endsWith('/calls/record')
  const { isImpersonatingClient } = useImpersonation()
  const { showToast } = useToast()
  const localClaims = useRef(new Set<string>())

  useEffect(() => {
    if (!identity || isImpersonatingClient) return
    const standalone = window.matchMedia('(display-mode: standalone)')
    let cancelled = false
    let checking = false
    let hadError = false
    let controller: AbortController | null = null

    const notify = async (call: ReminderCall) => {
      const key = callReminderKey(call, identity)
      const localKey = `${identity.userId}:${key}`
      if (cancelled || localClaims.current.has(localKey)) return
      const claim = () => {
        if (cancelled) return
        let claimed = false
        try { claimed = claimCallReminder(window.localStorage, identity.userId, key, Date.now()) }
        catch { claimed = !localClaims.current.has(localKey) }
        if (!claimed) return
        localClaims.current.add(localKey)
        showToast(`Your call with ${reminderWithName(call, identity)} is starting. Record it?`, 'info', {
          duration: 120_000,
          action: {
            label: 'Record call',
            // Native navigation goes through the recorder's save-before-leave guard.
            onClick: () => {
              const link = document.createElement('a')
              link.href = apiPath(recordingReminderHref(call))
              document.body.appendChild(link)
              link.click()
              link.remove()
            },
          },
        })
      }
      if (navigator.locks) {
        try { await navigator.locks.request(`tahi:call-reminders:${identity.userId}`, claim) }
        catch { claim() }
      } else claim()
    }

    const check = async () => {
      if (cancelled || checking || (!recorderPage && !standalone.matches) || !navigator.onLine) return
      checking = true
      controller = new AbortController()
      const timeout = setTimeout(() => controller?.abort(), 20_000)
      try {
        const nowMs = Date.now()
        const since = new Date(nowMs).toISOString()
        const until = new Date(nowMs + 120_000).toISOString()
        const results = await Promise.allSettled([
          fetchCalls<ScheduledReminderCall>(`/api/admin/calls?status=scheduled&limit=100&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`, controller.signal),
          fetchCalls<DiscoveryReminderCall>('/api/admin/discovery-calls/upcoming?limit=50', controller.signal),
        ])
        if (cancelled) return
        const calls: ReminderCall[] = []
        if (results[0].status === 'fulfilled') calls.push(...results[0].value.map(call => ({ ...call, kind: 'scheduled' as const })))
        if (results[1].status === 'fulfilled') calls.push(...results[1].value.map(call => ({ ...call, kind: 'discovery' as const })))
        const failed = results.some(result => result.status === 'rejected')
        if (failed && !hadError) {
          showToast('Some call reminders could not be checked. Retrying while this app is open.', 'warning', { duration: 8_000 })
        }
        hadError = failed
        for (const call of dueRecordingReminders(calls, identity, Date.now())) await notify(call)
      } finally {
        clearTimeout(timeout)
        checking = false
        controller = null
      }
    }
    const refresh = () => { void check().catch(() => {}) }
    refresh()
    const timer = setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    standalone.addEventListener('change', refresh)
    return () => {
      cancelled = true
      controller?.abort()
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
      standalone.removeEventListener('change', refresh)
    }
  }, [identity, isImpersonatingClient, recorderPage, showToast])

  return null
}
