'use client'

/**
 * ModulesSection - turn whole modules on or off for the workspace, a role, or a
 * single client.
 *
 * Workspace scope persists to /api/admin/settings under `module_<key>_enabled`
 * ('true' | 'false', default enabled when unset); the dashboard layout folds
 * those rows through applyModuleGates (lib/permissions.ts) into the sidebar
 * feature map.
 *
 * Role and client scopes persist as feature_visibility overrides via
 * /api/admin/permissions/feature-visibility: switching a module OFF writes an
 * explicit 'deny' for each mapped feature key, switching it back ON clears the
 * override ('inherit', back to the subject's default). resolvePermissions
 * already consumes those overrides for team roles and client orgs, so the
 * sidebar hides per target with no extra backend. Super admins bypass every
 * gate (so they can always switch a module back on), which is why the role
 * picker omits super_admin.
 */

import { useEffect, useMemo, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Seg, Toggle } from '@/components/tahi/settings/primitives'

interface ModuleDef {
  key: string
  name: string
  /** FEATURE_TREE keys this module gates. Mirrors MODULE_FEATURE_MAP in
   *  lib/permissions.ts (that file is server-side, so the map is duplicated
   *  here; keep the two in sync). */
  features: string[]
}

const MODULES: ModuleDef[] = [
  { key: 'requests', name: 'Requests', features: ['requests'] },
  { key: 'messaging', name: 'Messaging', features: ['messages'] },
  { key: 'billing', name: 'Billing', features: ['billing'] },
  { key: 'time_tracking', name: 'Time tracking', features: ['time'] },
  { key: 'reports', name: 'Reports', features: ['reports'] },
  { key: 'files', name: 'Files', features: ['files'] },
  { key: 'services', name: 'Services', features: ['services'] },
]

type Target = 'workspace' | 'role' | 'client'

interface SettingsResponse {
  settings: Record<string, string | null>
}

interface ClientsResponse {
  organisations: Array<{ id: string; name: string }>
}

interface SubjectsResponse {
  roles: Array<{ id: string; name: string; description: string | null; isSystem: boolean }>
}

interface OverridesResponse {
  overrides: Array<{ id: string; featureKey: string; effect: string; reason: string | null }>
}

function settingKey(moduleKey: string): string {
  return `module_${moduleKey}_enabled`
}

function roleLabel(name: string): string {
  const words = name.replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function ModulesSection() {
  const [target, setTarget] = useState<Target>('workspace')
  const [roleId, setRoleId] = useState('')
  const [clientId, setClientId] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)

  const { data, isLoading, mutate } = useResource<SettingsResponse>('/api/admin/settings')
  const settings = data?.settings ?? {}

  const { data: clientsData } = useResource<ClientsResponse>(
    target === 'client' ? '/api/admin/clients' : null,
  )
  const clients = useMemo(() => clientsData?.organisations ?? [], [clientsData])
  const clientsLoading = target === 'client' && clientsData === undefined

  const { data: subjectsData } = useResource<SubjectsResponse>(
    target === 'role' ? '/api/admin/permissions/subjects' : null,
  )
  // Super admins bypass all feature gates, so a super_admin override would lie.
  const roles = useMemo(
    () => (subjectsData?.roles ?? []).filter(r => r.name !== 'super_admin'),
    [subjectsData],
  )
  const rolesLoading = target === 'role' && subjectsData === undefined

  // Default each scoped picker to its first real subject once loaded, so the
  // controlled value always matches an option and writes target a real subject.
  useEffect(() => {
    if (target === 'role' && !roleId && roles.length) setRoleId(roles[0].id)
  }, [target, roleId, roles])
  useEffect(() => {
    if (target === 'client' && !clientId && clients.length) setClientId(clients[0].id)
  }, [target, clientId, clients])

  const subjectType = target === 'role' ? 'role' : target === 'client' ? 'organisation' : null
  const subjectId = target === 'role' ? roleId : target === 'client' ? clientId : ''

  const overridesUrl =
    subjectType && subjectId
      ? `/api/admin/permissions/feature-visibility?subjectType=${subjectType}&subjectId=${encodeURIComponent(subjectId)}`
      : null
  const {
    data: overridesData,
    isLoading: overridesLoading,
    mutate: mutateOverrides,
  } = useResource<OverridesResponse>(overridesUrl)

  const denied = new Set(
    (overridesData?.overrides ?? [])
      .filter(o => o.effect === 'deny')
      .map(o => o.featureKey),
  )

  function isWorkspaceEnabled(moduleKey: string): boolean {
    return settings[settingKey(moduleKey)] !== 'false'
  }

  function isEnabled(mod: ModuleDef): boolean {
    if (target === 'workspace') return isWorkspaceEnabled(mod.key)
    // A module is off for this subject when every mapped feature is denied.
    return !mod.features.every(fk => denied.has(fk))
  }

  async function persistWorkspace(moduleKey: string, next: boolean) {
    const key = settingKey(moduleKey)
    setSavingKey(moduleKey)
    try {
      const res = await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: next ? 'true' : 'false' }),
      })
      if (!res.ok) throw new Error('Failed to save')
      await mutate()
    } catch {
      // Leave prior state in place; revalidation keeps the UI truthful.
      await mutate()
    } finally {
      setSavingKey(null)
    }
  }

  async function persistScoped(mod: ModuleDef, next: boolean) {
    if (!subjectType || !subjectId) return
    setSavingKey(mod.key)
    try {
      for (const featureKey of mod.features) {
        const res = await fetch(apiPath('/api/admin/permissions/feature-visibility'), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subjectType,
            subjectId,
            featureKey,
            // OFF = explicit deny. ON = clear the override, back to default.
            effect: next ? 'inherit' : 'deny',
            reason: next ? null : 'Module switched off in Settings, Modules',
          }),
        })
        if (!res.ok) throw new Error('Failed to save')
      }
      await mutateOverrides()
    } catch {
      await mutateOverrides()
    } finally {
      setSavingKey(null)
    }
  }

  function toggle(mod: ModuleDef) {
    const next = !isEnabled(mod)
    if (target === 'workspace') void persistWorkspace(mod.key, next)
    else void persistScoped(mod, next)
  }

  const controlLede =
    target === 'workspace'
      ? 'Everyone in the workspace.'
      : target === 'role'
        ? 'Everyone assigned this role.'
        : "Just this client's portal."

  const listLoading =
    target === 'workspace'
      ? isLoading
      : !subjectId || overridesLoading

  return (
    <SectionShell
      title="Modules"
      lede="Turn whole modules on or off. You control this for the workspace, a role, or a single client."
    >
      <div className="set-card" style={{ marginBottom: 16 }}>
        <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <div className="sr-t">
            <b>Control for</b>
            <small>{controlLede}</small>
          </div>
          <div className="ctl-line">
            <Seg
              aria="Target"
              value={target}
              onChange={v => setTarget(v as Target)}
              opts={[
                ['workspace', 'Workspace'],
                ['role', 'By role'],
                ['client', 'By client'],
              ]}
            />
            {target === 'role' && (
              <select
                className="set-input"
                style={{ maxWidth: 200 }}
                value={roleId}
                onChange={e => setRoleId(e.target.value)}
                aria-label="Role"
                disabled={rolesLoading || roles.length === 0}
              >
                {rolesLoading ? (
                  <option value="">Loading roles...</option>
                ) : roles.length === 0 ? (
                  <option value="">No roles yet</option>
                ) : (
                  roles.map(r => (
                    <option key={r.id} value={r.id}>
                      {roleLabel(r.name)}
                    </option>
                  ))
                )}
              </select>
            )}
            {target === 'client' && (
              <select
                className="set-input"
                style={{ maxWidth: 240 }}
                value={clientId}
                onChange={e => setClientId(e.target.value)}
                aria-label="Client"
                disabled={clientsLoading || clients.length === 0}
              >
                {clientsLoading ? (
                  <option value="">Loading clients...</option>
                ) : clients.length === 0 ? (
                  <option value="">No clients yet</option>
                ) : (
                  clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="set-card">
        {listLoading
          ? MODULES.map((m, i) => (
              <div
                key={m.key}
                className="set-row"
                style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
              >
                <div className="sr-t">
                  <b>{m.name}</b>
                  <small>Hidden from the sidebar when off.</small>
                </div>
                <span
                  className="animate-pulse"
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: 42,
                    height: 24,
                    borderRadius: 999,
                    background: 'var(--bg-tertiary)',
                    flexShrink: 0,
                  }}
                />
              </div>
            ))
          : MODULES.map((m, i) => (
              <div
                key={m.key}
                className="set-row"
                style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
              >
                <div className="sr-t">
                  <b>{m.name}</b>
                  <small>Hidden from the sidebar when off.</small>
                </div>
                <Toggle
                  on={isEnabled(m)}
                  onClick={() => {
                    if (savingKey === m.key) return
                    toggle(m)
                  }}
                  ariaLabel={`Toggle ${m.name}`}
                />
              </div>
            ))}
      </div>
    </SectionShell>
  )
}
