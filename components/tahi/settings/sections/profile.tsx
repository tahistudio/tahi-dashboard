'use client'

/**
 * Profile section. Always shows the signed-in person's identity from Clerk
 * (name, email, photo) so the tab is never empty. Clients can edit their name +
 * role, saved to the contact record via PATCH /api/portal/profile; team members
 * and admins are Clerk-managed, so their fields are read-only. Email is always
 * managed by the login provider.
 */

import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
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

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function ProfileSection({ isAdmin = false }: { isAdmin?: boolean } = {}) {
  const { user, isLoaded } = useUser()
  // Only clients have an editable contact record; skip the portal fetch for
  // team/admin (they are Clerk-managed and the endpoint would 403 / return null).
  const { data, isLoading, mutate } = useResource<{ contact: ContactProfile | null }>(
    isAdmin ? null : '/api/portal/profile',
  )
  const contact = data?.contact ?? null

  const clerkName = user?.fullName || user?.firstName || user?.username || ''
  const clerkEmail = user?.primaryEmailAddress?.emailAddress ?? ''
  const imageUrl = user?.imageUrl

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Seed editable fields: contact record for clients, Clerk identity otherwise.
  useEffect(() => {
    if (contact) {
      setName(contact.name)
      setRole(contact.role ?? '')
    } else if (clerkName) {
      setName(clerkName)
    }
  }, [contact, clerkName])

  const editable = !isAdmin
  const email = (isAdmin ? clerkEmail : contact?.email) || clerkEmail
  const displayName = name || clerkName

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

  if (!isLoaded || (!isAdmin && isLoading && !contact)) {
    return (
      <SectionShell title="Profile" lede="Your name and role, shown across the studio.">
        <div className="set-card">
          <div className="set-grid2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="set-field">
                <div style={{ height: 14, width: '40%', borderRadius: 6, marginBottom: 8, background: 'var(--color-bg-tertiary)' }} />
                <div style={{ height: 40, borderRadius: 9, background: 'var(--color-bg-tertiary)' }} />
              </div>
            ))}
          </div>
        </div>
      </SectionShell>
    )
  }

  return (
    <SectionShell title="Profile" lede="Your name and role, shown across the studio.">
      <div className="set-card">
        <div className="av-row">
          <span className="subj-av" style={{ width: 56, height: 56, fontSize: 18 }}>
            {imageUrl ? <img src={imageUrl} alt="" /> : initialsOf(displayName || '?')}
          </span>
          <div className="av-row-t">
            <b>{displayName || 'Your account'}</b>
            <small>{email}</small>
          </div>
        </div>
        <div className="set-grid2 av-fields">
          <div className="set-field">
            <label htmlFor="profile-name">Full name</label>
            <input
              id="profile-name"
              className="set-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!editable}
            />
          </div>
          <div className="set-field">
            <label htmlFor="profile-email">Email</label>
            <input id="profile-email" className="set-input" value={email} disabled />
          </div>
          {editable && (
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
          )}
        </div>
        {editable && (
          <div className="set-row" style={{ justifyContent: 'flex-end', gap: 14, borderTop: '1px solid var(--border-subtle)' }}>
            {saved && (
              <span style={{ font: '500 12.5px Manrope,sans-serif', color: 'var(--brand-strong)' }}>Profile updated</span>
            )}
            <button type="button" className="btn1" onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? 'Saving...' : 'Save profile'}
            </button>
          </div>
        )}
      </div>
      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        {editable
          ? 'Email is managed through your login provider.'
          : 'Your name and email are managed through your login provider (Clerk).'}
      </p>
    </SectionShell>
  )
}
