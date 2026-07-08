'use client'

/**
 * ModulesSection - turn whole modules on or off for the workspace, a role, or a
 * single client. Workspace toggles persist to /api/admin/settings under the key
 * `module_<key>_enabled` (value 'true' | 'false', default enabled when unset).
 * Role and client scoping is UI-only scaffold for now: those toggles hold local
 * state and are not persisted until the access model lands.
 */

import { useState } from 'react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { SectionShell, Seg, Toggle } from '@/components/tahi/settings/primitives'

interface ModuleDef {
  key: string
  name: string
}

// Keys map to `module_<key>_enabled` settings rows. The first five back real
// sidebar modules; files and services round out the client-facing set.
const MODULES: ModuleDef[] = [
  { key: 'requests', name: 'Requests' },
  { key: 'messaging', name: 'Messaging' },
  { key: 'billing', name: 'Billing' },
  { key: 'time_tracking', name: 'Time tracking' },
  { key: 'reports', name: 'Reports' },
  { key: 'files', name: 'Files' },
  { key: 'services', name: 'Services' },
]

type Target = 'workspace' | 'role' | 'client'

interface SettingsResponse {
  settings: Record<string, string | null>
}

interface ClientsResponse {
  organisations: Array<{ id: string; name: string }>
}

function settingKey(moduleKey: string): string {
  return `module_${moduleKey}_enabled`
}

export function ModulesSection(_props: { isAdmin?: boolean } = {}) {
  const [target, setTarget] = useState<Target>('workspace')
  const [role, setRole] = useState('task_handler')
  const [client, setClient] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // Scaffold-only state for role/client scoping. Keyed by module key, defaults
  // to enabled. Not persisted until the access model lands.
  const [scaffold, setScaffold] = useState<Record<string, boolean>>({})

  const { data, isLoading, mutate } = useResource<SettingsResponse>('/api/admin/settings')
  const settings = data?.settings ?? {}

  const { data: clientsData } = useResource<ClientsResponse>(
    target === 'client' ? '/api/admin/clients' : null,
  )
  const clients = clientsData?.organisations ?? []

  function isWorkspaceEnabled(moduleKey: string): boolean {
    return settings[settingKey(moduleKey)] !== 'false'
  }

  function isEnabled(moduleKey: string): boolean {
    if (target === 'workspace') return isWorkspaceEnabled(moduleKey)
    const scoped = scaffold[moduleKey]
    return scoped === undefined ? true : scoped
  }

  async function persistWorkspace(moduleKey: string, next: boolean) {
    const key = settingKey(moduleKey)
    setSavingKey(key)
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

  function toggle(moduleKey: string) {
    const next = !isEnabled(moduleKey)
    if (target === 'workspace') {
      void persistWorkspace(moduleKey, next)
    } else {
      setScaffold(s => ({ ...s, [moduleKey]: next }))
    }
  }

  const controlLede =
    target === 'workspace'
      ? 'Everyone in the workspace.'
      : target === 'role'
        ? 'Everyone assigned this role.'
        : "Just this client's portal."

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
                value={role}
                onChange={e => setRole(e.target.value)}
                aria-label="Role"
              >
                <option value="admin">Admin</option>
                <option value="project_manager">Project manager</option>
                <option value="task_handler">Task handler</option>
                <option value="viewer">Viewer</option>
              </select>
            )}
            {target === 'client' && (
              <select
                className="set-input"
                style={{ maxWidth: 240 }}
                value={client}
                onChange={e => setClient(e.target.value)}
                aria-label="Client"
                disabled={clients.length === 0}
              >
                {clients.length === 0 ? (
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
        {isLoading && target === 'workspace'
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
                  className="sw"
                  style={{ opacity: 0.4 }}
                  aria-hidden="true"
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
                  on={isEnabled(m.key)}
                  onClick={() => {
                    if (savingKey === settingKey(m.key)) return
                    toggle(m.key)
                  }}
                  ariaLabel={`Toggle ${m.name}`}
                />
              </div>
            ))}
      </div>
    </SectionShell>
  )
}
