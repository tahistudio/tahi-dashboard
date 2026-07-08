'use client'

/**
 * FeatureSlideOver - per-subject feature access editor.
 *
 * The design's right-hand slide-over: every feature for the subject's
 * audience, grouped, each with a three-way Inherit/Allow/Deny control and a
 * reason input when overridden. Children render indented under their parent
 * and lock (shown as denied) while the parent has an explicit deny override,
 * mirroring the server's ancestry cascade in lib/permissions.ts.
 *
 * Writes go through PUT /api/admin/permissions/feature-visibility, optimistic
 * with revert on failure. 'inherit' clears the override server-side.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { SlidersHorizontal } from 'lucide-react'
import { apiPath } from '@/lib/api'
import type { FeatureAudience, FeatureNode } from '@/lib/feature-tree'
import { SlideOverShell, Tri, type TriValue } from '@/components/tahi/settings/primitives'
import { groupsFor, childrenFor } from './groups'
import { type Effect, type Override } from './shared'

export type OverrideSubjectType = 'team_member' | 'organisation' | 'role'

export interface OverrideSubject {
  type: OverrideSubjectType
  id: string
  name: string
  audience: FeatureAudience
}

export type ToastFn = (msg: string, type?: 'ok' | 'err') => void

export function overridesKey(subject: OverrideSubject): string {
  return (
    '/api/admin/permissions/feature-visibility?subjectType=' +
    encodeURIComponent(subject.type) +
    '&subjectId=' +
    encodeURIComponent(subject.id)
  )
}

export function FeatureSlideOver({
  subject,
  onClose,
  toast,
  onChanged,
}: {
  subject: OverrideSubject
  onClose: () => void
  toast: ToastFn
  /** Called after any successful write so the detail card can refresh. */
  onChanged?: () => void
}) {
  const { data, isLoading, mutate } = useSWR<{ overrides: Override[] }>(overridesKey(subject), {
    keepPreviousData: false,
  })

  // Editable working copies, seeded from the fetch and patched optimistically.
  const [effects, setEffects] = useState<Map<string, Effect>>(new Map())
  const [reasons, setReasons] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!data) return
    const nextEffects = new Map<string, Effect>()
    const nextReasons = new Map<string, string>()
    for (const o of data.overrides ?? []) {
      nextEffects.set(o.featureKey, o.effect)
      if (o.reason) nextReasons.set(o.featureKey, o.reason)
    }
    setEffects(nextEffects)
    setReasons(nextReasons)
  }, [data])

  const groups = useMemo(() => groupsFor(subject.audience), [subject.audience])
  const featureCount = useMemo(() => groups.reduce((a, g) => a + g.nodes.length, 0), [groups])

  const subjectTypeLabel =
    subject.type === 'team_member' ? 'Team member' : subject.type === 'organisation' ? 'Client' : 'Role'

  const persist = useCallback(
    async (featureKey: string, effect: TriValue, reason: string | null) => {
      const res = await fetch(apiPath('/api/admin/permissions/feature-visibility'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subjectType: subject.type,
          subjectId: subject.id,
          featureKey,
          effect,
          reason,
        }),
      })
      if (!res.ok) throw new Error('Failed')
    },
    [subject],
  )

  const setEffect = useCallback(
    async (featureKey: string, next: TriValue) => {
      const prev = effects.get(featureKey)
      setEffects((m) => {
        const copy = new Map(m)
        if (next === 'inherit') copy.delete(featureKey)
        else copy.set(featureKey, next)
        return copy
      })
      if (next === 'inherit') {
        setReasons((m) => {
          const copy = new Map(m)
          copy.delete(featureKey)
          return copy
        })
      }
      try {
        await persist(featureKey, next, next === 'inherit' ? null : reasons.get(featureKey)?.trim() || null)
        toast(
          next === 'inherit' ? 'Saved: inheriting default' : next === 'allow' ? 'Saved: allowed' : 'Saved: denied',
          'ok',
        )
        void mutate()
        onChanged?.()
      } catch {
        toast('Could not save change', 'err')
        setEffects((m) => {
          const copy = new Map(m)
          if (prev) copy.set(featureKey, prev)
          else copy.delete(featureKey)
          return copy
        })
      }
    },
    [effects, reasons, persist, toast, mutate, onChanged],
  )

  const commitReason = useCallback(
    async (featureKey: string) => {
      const effect = effects.get(featureKey)
      if (!effect) return
      try {
        await persist(featureKey, effect, reasons.get(featureKey)?.trim() || null)
        toast('Reason saved', 'ok')
        void mutate()
        onChanged?.()
      } catch {
        toast('Could not save reason', 'err')
      }
    },
    [effects, reasons, persist, toast, mutate, onChanged],
  )

  const renderRow = (node: FeatureNode, leaf: boolean, parentDenied: boolean) => {
    const value: TriValue = effects.get(node.key) ?? 'inherit'
    const locked = parentDenied
    return (
      <div key={node.key} className={'frow' + (leaf ? ' leaf' : ' frow-group')}>
        <div className="frow-main">
          <div className="frow-t">
            <b>{node.label}</b>
            <small>{node.description}</small>
            {locked && <div className="frow-locknote">Denied by a parent feature.</div>}
          </div>
          <Tri
            value={locked ? 'deny' : value}
            onChange={(v) => void setEffect(node.key, v)}
            locked={locked}
            label={node.label}
          />
        </div>
        {!locked && value !== 'inherit' && (
          <div className="freason">
            <input
              value={reasons.get(node.key) ?? ''}
              placeholder="Why? (shown in the change history)"
              aria-label={'Reason for ' + node.label + ' override'}
              onChange={(e) => {
                const v = e.target.value
                setReasons((m) => new Map(m).set(node.key, v))
              }}
              onBlur={() => void commitReason(node.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <SlideOverShell
      icon={<SlidersHorizontal size={18} aria-hidden="true" />}
      title={subject.name}
      sub={subjectTypeLabel + ' - ' + featureCount + ' features'}
      onClose={onClose}
      ariaLabel={subject.name + ' access'}
    >
      <div className="so-legend" style={{ margin: '14px 0 4px' }}>
        <b>Inherit uses the default for this level</b>
        <small>
          Set Allow or Deny to override the default just for this {subjectTypeLabel.toLowerCase()}. Denying a
          parent also hides its sub-features.
        </small>
      </div>
      {isLoading ? (
        <SlideOverSkeleton />
      ) : (
        groups.map((g) => (
          <div key={g.label}>
            <div className="led" style={{ padding: '14px 0 2px', display: 'block' }}>
              {g.label}
            </div>
            {g.nodes.map((node) => {
              const parentDenied = effects.get(node.key) === 'deny'
              return (
                <div key={node.key}>
                  {renderRow(node, false, false)}
                  {childrenFor(node, subject.audience).map((c) => renderRow(c, true, parentDenied))}
                </div>
              )
            })}
          </div>
        ))
      )}
    </SlideOverShell>
  )
}

function SlideOverSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 14 }}>
      <span className="sr-only">Loading...</span>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="animate-pulse" style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ height: 12, width: '35%', borderRadius: 6, background: 'var(--bg-tertiary)' }} />
            <div style={{ height: 10, width: '70%', borderRadius: 6, background: 'var(--bg-secondary)' }} />
          </div>
          <div style={{ height: 32, width: 170, borderRadius: 9, background: 'var(--bg-tertiary)' }} />
        </div>
      ))}
    </div>
  )
}
