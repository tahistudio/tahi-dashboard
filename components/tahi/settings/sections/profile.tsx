'use client'

import { useEffect, useState } from 'react'
import { SectionShell } from '@/components/tahi/settings/primitives'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'

interface ContactProfile {
  id: string
  name: string
  email: string
  role: string | null
  isPrimary: boolean | null
}

/**
 * Client-editable profile. Name and role are stored on the contact record and
 * saved through PATCH /api/portal/profile; email is managed by the login
 * provider (Clerk) and stays read-only for both team and clients.
 */
export function ProfileSection({ isAdmin: _isAdmin }: { isAdmin?: boolean } = {}) {
  const { data, isLoading, mutate } = useResource<{ contact: ContactProfile | null }>(
    '/api/portal/profile',
  )
  const profile = data?.contact ?? null

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Seed the editable fields whenever the profile loads or refreshes.
  useEffect(() => {
    if (data?.contact) {
      setName(data.contact.name)
      setRole(data.contact.role ?? '')
    }
  }, [data])

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(apiPath('/api/portal/profile'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), role: role.trim() }),
      })
      if (res.ok) {
        setSaved(true)
        await mutate()
        setTimeout(() => setSaved(false), 3000)
      }
    } catch {
      // Save failed; leave the form as-is so the user can retry.
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <SectionShell title="Profile" lede="Your name and role, shown across the studio.">
        <div className="set-card">
          <div className="set-grid2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="set-field">
                <div
                  style={{
                    height: 14,
                    width: '40%',
                    borderRadius: 6,
                    marginBottom: 8,
                    background: 'var(--color-bg-tertiary)',
                  }}
                />
                <div
                  style={{
                    height: 40,
                    borderRadius: 9,
                    background: 'var(--color-bg-tertiary)',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </SectionShell>
    )
  }

  if (!profile) {
    return (
      <SectionShell title="Profile" lede="Your name and role, shown across the studio.">
        <div className="set-card">
          <p className="set-lede" style={{ margin: 0 }}>
            No profile record found. Please contact the Tahi team if you need help setting up your
            account.
          </p>
        </div>
      </SectionShell>
    )
  }

  return (
    <SectionShell title="Profile" lede="Your name and role, shown across the studio.">
      <div className="set-card">
        <div className="set-grid2">
          <div className="set-field">
            <label htmlFor="profile-name">Full name</label>
            <input
              id="profile-name"
              className="set-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="set-field">
            <label htmlFor="profile-email">Email</label>
            <input id="profile-email" className="set-input" value={profile.email} disabled />
          </div>
          <div className="set-field">
            <label htmlFor="profile-role">Role / title</label>
            <input
              id="profile-role"
              className="set-input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Marketing Manager"
            />
          </div>
        </div>
        <div
          className="set-row"
          style={{
            justifyContent: 'flex-end',
            gap: 14,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {saved && (
            <span style={{ font: '500 12.5px Manrope,sans-serif', color: 'var(--brand-strong)' }}>
              Profile updated
            </span>
          )}
          <button
            type="button"
            className="btn1"
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </div>
      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        Email is managed through your login provider.
      </p>
    </SectionShell>
  )
}
