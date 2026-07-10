'use client'

/**
 * Profile section (design parity: settings-app.jsx Profile).
 *
 * One card for every audience: AvatarUpload (78px circle, camera badge,
 * Upload / Replace / Remove), then Full name, Email (disabled), Role / title,
 * Phone, then a Save row.
 *
 * Persistence is real for every audience:
 *   - Photo: Clerk user.setProfileImage (keeps the top-nav avatar in sync);
 *     admins also mirror the URL to their teamMembers.avatarUrl row.
 *   - Admin/team fields: GET/PATCH /api/admin/profile (caller's teamMembers
 *     row matched by clerkUserId), plus best-effort Clerk first/last name sync.
 *   - Client fields: GET/PATCH /api/portal/profile (caller's contact row),
 *     plus the same best-effort Clerk name sync.
 */

import { useEffect, useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { AvatarUpload, SectionShell, Toasts, useToasts } from '@/components/tahi/settings/primitives'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'

interface ContactProfile {
  id: string
  name: string
  email: string
  role: string | null
  phone: string | null
  isPrimary: boolean | null
  portalRole: string | null
}

interface TeamMemberProfile {
  id: string
  name: string
  email: string
  title: string | null
  phone: string | null
  avatarUrl: string | null
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase()
}

function ProfileSkeleton() {
  return (
    <SectionShell title="Profile" lede="Your name, photo and role - shown across the workspace.">
      <div className="set-card">
        <div className="av-row animate-pulse">
          <div style={{ width: 78, height: 78, borderRadius: '50%', background: 'var(--bg-tertiary)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ height: 14, width: '30%', borderRadius: 6, background: 'var(--bg-tertiary)' }} />
            <div style={{ height: 12, width: '55%', borderRadius: 6, marginTop: 8, background: 'var(--bg-tertiary)' }} />
          </div>
        </div>
        <div className="set-grid2 av-fields animate-pulse">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="set-field">
              <div style={{ height: 14, width: '40%', borderRadius: 6, marginBottom: 8, background: 'var(--bg-tertiary)' }} />
              <div style={{ height: 40, borderRadius: 9, background: 'var(--bg-tertiary)' }} />
            </div>
          ))}
        </div>
      </div>
    </SectionShell>
  )
}

export function ProfileSection({ isAdmin = false }: { isAdmin?: boolean } = {}) {
  const { user, isLoaded } = useUser()
  const { toasts, toast } = useToasts()

  // Each audience edits its own record: admins/team the teamMembers row,
  // clients the contact row. The other fetch is skipped via a null key.
  const { data: adminData, isLoading: adminLoading, mutate: mutateAdmin } = useResource<{
    member: TeamMemberProfile | null
  }>(isAdmin ? '/api/admin/profile' : null)
  const { data: portalData, isLoading: portalLoading, mutate: mutatePortal } = useResource<{
    contact: ContactProfile | null
  }>(isAdmin ? null : '/api/portal/profile')

  const member = adminData?.member ?? null
  const contact = portalData?.contact ?? null
  const record = isAdmin ? member : contact
  const isLoading = isAdmin ? adminLoading : portalLoading

  const clerkName = user?.fullName || user?.firstName || user?.username || ''
  const clerkEmail = user?.primaryEmailAddress?.emailAddress ?? ''

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)

  // Seed editable fields from the workspace record, falling back to Clerk.
  useEffect(() => {
    if (isAdmin && member) {
      setName(member.name)
      setRole(member.title ?? '')
      setPhone(member.phone ?? '')
    } else if (!isAdmin && contact) {
      setName(contact.name)
      setRole(contact.role ?? '')
      setPhone(contact.phone ?? '')
    } else if (clerkName) {
      setName((prev) => prev || clerkName)
    }
  }, [isAdmin, member, contact, clerkName])

  const email = (isAdmin ? member?.email : contact?.email) || clerkEmail
  const displayName = name || clerkName
  const avatarValue = user?.hasImage ? user.imageUrl : ''

  async function syncClerkName(fullName: string) {
    if (!user) return
    const parts = fullName.trim().split(/\s+/).filter(Boolean)
    if (!parts.length) return
    try {
      await user.update({ firstName: parts[0], lastName: parts.slice(1).join(' ') })
    } catch {
      // Clerk name sync is best-effort; the workspace record is the save target.
    }
  }

  async function handleSave() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await syncClerkName(name)
      let ok = true
      if (isAdmin) {
        if (member) {
          const res = await fetch(apiPath('/api/admin/profile'), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), title: role.trim(), phone: phone.trim() }),
          })
          ok = res.ok
          if (ok) await mutateAdmin()
        }
      } else if (contact) {
        const res = await fetch(apiPath('/api/portal/profile'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), role: role.trim(), phone: phone.trim() }),
        })
        ok = res.ok
        if (ok) await mutatePortal()
      }
      if (ok) toast('Profile saved')
      else toast('Could not save your profile', 'err')
    } catch {
      toast('Could not save your profile', 'err')
    } finally {
      setSaving(false)
    }
  }

  async function persistAvatarUrl(url: string | null) {
    // Only team members have a workspace avatar column today; the portal
    // avatar renders straight from Clerk.
    if (!isAdmin || !member) return
    try {
      await fetch(apiPath('/api/admin/profile'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: url }),
      })
      await mutateAdmin()
    } catch {
      // Clerk already holds the image; the mirror column can lag one save.
    }
  }

  async function handleAvatarFile(file: File) {
    if (!user || avatarBusy) return
    setAvatarBusy(true)
    try {
      const img = await user.setProfileImage({ file })
      await persistAvatarUrl(img?.publicUrl ?? user.imageUrl ?? null)
      toast('Profile photo updated')
    } catch {
      toast('Could not upload that image', 'err')
    } finally {
      setAvatarBusy(false)
    }
  }

  async function handleAvatarRemove() {
    if (!user || avatarBusy) return
    setAvatarBusy(true)
    try {
      await user.setProfileImage({ file: null })
      await persistAvatarUrl(null)
      toast('Profile photo removed')
    } catch {
      toast('Could not remove the photo', 'err')
    } finally {
      setAvatarBusy(false)
    }
  }

  if (!isLoaded || (isLoading && !record)) {
    return <ProfileSkeleton />
  }

  return (
    <SectionShell title="Profile" lede="Your name, photo and role - shown across the workspace.">
      <div className="set-card">
        <div className="av-row">
          <AvatarUpload
            value={avatarValue}
            initials={initialsOf(displayName || '?')}
            onFile={handleAvatarFile}
            onRemove={handleAvatarRemove}
            size={78}
            shape="circle"
            busy={avatarBusy}
            ariaLabel="Upload profile photo"
          />
          <div className="av-row-t">
            <b>Profile photo</b>
            <small>PNG or JPG, at least 200&times;200px. Shown on your messages, comments and activity.</small>
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
            />
          </div>
          <div className="set-field">
            <label htmlFor="profile-email">Email</label>
            <input id="profile-email" className="set-input" value={email} disabled />
          </div>
          <div className="set-field">
            <label htmlFor="profile-role">Role / title</label>
            <input
              id="profile-role"
              className="set-input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </div>
          <div className="set-field">
            <label htmlFor="profile-phone">Phone</label>
            <input
              id="profile-phone"
              className="set-input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>
        <div className="set-row" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)' }}>
          <button type="button" className="btn1" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </div>
      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        Email is managed through your login provider.
      </p>
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
