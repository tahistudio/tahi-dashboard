'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, Sun, Moon,
  CreditCard, Link2, Bell, Building2,
  FileText, Plus, Trash2, GripVertical, ChevronDown, ChevronUp,
  Webhook, Loader2, User, Palette, ToggleLeft,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { apiPath } from '@/lib/api'

// -- Types --

interface IntegrationCard {
  key: string
  name: string
  description: string
  icon: React.ReactNode
}

const INTEGRATIONS: IntegrationCard[] = [
  {
    key: 'stripe',
    name: 'Stripe',
    description: 'Payment processing and subscription billing',
    icon: <CreditCard className="w-5 h-5" />,
  },
  {
    key: 'xero',
    name: 'Xero',
    description: 'Invoice sync and payment reconciliation',
    icon: <CreditCard className="w-5 h-5" />,
  },
  {
    key: 'slack',
    name: 'Slack',
    description: 'Team notifications for requests and status changes',
    icon: <Link2 className="w-5 h-5" />,
  },
  {
    key: 'hubspot',
    name: 'HubSpot',
    description: 'CRM sync for contacts and companies',
    icon: <Link2 className="w-5 h-5" />,
  },
  {
    key: 'mailerlite',
    name: 'MailerLite',
    description: 'Email marketing and onboarding sequences',
    icon: <Link2 className="w-5 h-5" />,
  },
]

// -- Main Component --

export function SettingsContent({ isAdmin }: { isAdmin: boolean }) {
  const [settings, setSettings] = useState<Record<string, string | null>>({})
  const [integrationStatus, setIntegrationStatus] = useState<Record<string, { configured: boolean }>>({})
  const [loading, setLoading] = useState(true)
  const [darkMode, setDarkMode] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedToast, setSavedToast] = useState(false)

  // Notification toggles
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [slackNotifications, setSlackNotifications] = useState(false)

  const fetchSettings = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [settingsRes, intStatusRes] = await Promise.all([
        fetch(apiPath('/api/admin/settings')),
        fetch(apiPath('/api/admin/integrations/status')),
      ])

      if (settingsRes.ok) {
        const data = await settingsRes.json() as { settings: Record<string, string | null> }
        setSettings(data.settings ?? {})
        setEmailNotifications(data.settings?.['notifications.email'] !== 'false')
        setSlackNotifications(data.settings?.['notifications.slack'] === 'true')
      }

      if (intStatusRes.ok) {
        const statusData = await intStatusRes.json() as Record<string, { configured: boolean }>
        setIntegrationStatus(statusData)
      }
    } catch {
      // Settings load failed, keep defaults
    } finally {
      setLoading(false)
    }
  }, [isAdmin])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  // Dark mode init
  useEffect(() => {
    const stored = localStorage.getItem('tahi-theme')
    setDarkMode(stored === 'dark')
  }, [])

  function toggleDarkMode() {
    const next = !darkMode
    setDarkMode(next)
    if (next) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('tahi-theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('tahi-theme', 'light')
    }
  }

  async function saveSetting(key: string, value: string) {
    setSavingKey(key)
    try {
      await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      setSavedToast(true)
      setTimeout(() => setSavedToast(false), 2000)
    } catch {
      // Silently fail for now
    } finally {
      setSavingKey(null)
    }
  }

  async function handleNotificationToggle(type: 'email' | 'slack', enabled: boolean) {
    const key = `notifications.${type}`
    const value = enabled ? 'true' : 'false'
    if (type === 'email') setEmailNotifications(enabled)
    if (type === 'slack') setSlackNotifications(enabled)
    await saveSetting(key, value)
  }

  function getIntegrationStatus(key: string): string {
    if (integrationStatus[key]?.configured) return 'connected'
    return settings[`integration.${key}.status`] ?? 'disconnected'
  }

  return (
    <div className="space-y-6">
      {/* Saved toast */}
      {savedToast && (
        <div
          className="fixed top-4 right-4 z-[70] flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium animate-in fade-in slide-in-from-top-2"
          style={{
            background: 'var(--color-success-bg, #f0fdf4)',
            color: 'var(--color-success, #4ade80)',
            border: '1px solid var(--color-success, #4ade80)',
          }}
        >
          Saved
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Settings</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            {isAdmin
              ? 'Configure the dashboard, integrations, and notifications.'
              : 'Manage your preferences.'}
          </p>
        </div>
        {isAdmin && (
          <TahiButton variant="secondary" size="sm" onClick={fetchSettings} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
            Refresh
          </TahiButton>
        )}
      </div>

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <div className="space-y-8">
          {/* Profile (client only) */}
          {!isAdmin && <ProfileSection />}

          {/* Dark Mode */}
          <section>
            <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
              {darkMode ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              Appearance
            </h2>
            <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Dark Mode</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    Switch between light and dark themes
                  </p>
                </div>
                <button
                  onClick={toggleDarkMode}
                  className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                  style={{
                    background: darkMode ? 'var(--color-brand)' : 'var(--color-border)',
                  }}
                  role="switch"
                  aria-checked={darkMode}
                  aria-label="Toggle dark mode"
                >
                  <span
                    className="inline-block h-4 w-4 rounded-full bg-white transition-transform"
                    style={{
                      transform: darkMode ? 'translateX(1.375rem)' : 'translateX(0.25rem)',
                    }}
                  />
                </button>
              </div>
            </div>
          </section>

          {/* Integrations (admin only) */}
          {isAdmin && (
            <section>
              <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
                <Link2 className="w-5 h-5" />
                Integrations
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {INTEGRATIONS.map((integration) => {
                  const status = getIntegrationStatus(integration.key)
                  const isConnected = status === 'connected'
                  return (
                    <div
                      key={integration.key}
                      className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5"
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="w-10 h-10 flex items-center justify-center flex-shrink-0"
                          style={{
                            borderRadius: 'var(--radius-leaf-sm)',
                            background: isConnected ? 'var(--color-brand-50)' : 'var(--color-bg-tertiary)',
                            color: isConnected ? 'var(--color-brand)' : 'var(--color-text-muted)',
                          }}
                        >
                          {integration.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold text-[var(--color-text)]">
                              {integration.name}
                            </h3>
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{
                                background: isConnected ? 'var(--color-success-bg)' : 'var(--color-bg-tertiary)',
                                color: isConnected ? 'var(--color-success)' : 'var(--color-text-muted)',
                              }}
                            >
                              {isConnected ? 'Connected' : 'Not Connected'}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                            {integration.description}
                          </p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Notifications */}
          <section>
            <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
              <Bell className="w-5 h-5" />
              Notifications
            </h2>
            <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl divide-y divide-[var(--color-border-subtle)]">
              {/* Email notifications */}
              <div className="flex items-center justify-between p-5">
                <div>
                  <p className="text-sm font-medium text-[var(--color-text)]">Email Notifications</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    Receive email alerts for important updates
                  </p>
                </div>
                <button
                  onClick={() => handleNotificationToggle('email', !emailNotifications)}
                  className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                  style={{
                    background: emailNotifications ? 'var(--color-brand)' : 'var(--color-border)',
                  }}
                  role="switch"
                  aria-checked={emailNotifications}
                  aria-label="Toggle email notifications"
                  disabled={savingKey === 'notifications.email'}
                >
                  <span
                    className="inline-block h-4 w-4 rounded-full bg-white transition-transform"
                    style={{
                      transform: emailNotifications ? 'translateX(1.375rem)' : 'translateX(0.25rem)',
                    }}
                  />
                </button>
              </div>

              {/* Slack notifications (admin only) */}
              {isAdmin && (
                <div className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-sm font-medium text-[var(--color-text)]">Slack Notifications</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      Post updates to your configured Slack channel
                    </p>
                  </div>
                  <button
                    onClick={() => handleNotificationToggle('slack', !slackNotifications)}
                    className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                    style={{
                      background: slackNotifications ? 'var(--color-brand)' : 'var(--color-border)',
                    }}
                    role="switch"
                    aria-checked={slackNotifications}
                    aria-label="Toggle Slack notifications"
                    disabled={savingKey === 'notifications.slack'}
                  >
                    <span
                      className="inline-block h-4 w-4 rounded-full bg-white transition-transform"
                      style={{
                        transform: slackNotifications ? 'translateX(1.375rem)' : 'translateX(0.25rem)',
                      }}
                    />
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Branding (admin only) - T277 */}
          {isAdmin && (
            <BrandingSection
              settings={settings}
              onSave={async (key: string, value: string) => {
                await saveSetting(key, value)
                setSettings(prev => ({ ...prev, [key]: value }))
              }}
              savingKey={savingKey}
            />
          )}

          {/* Modules Toggle (admin only) - T278 */}
          {isAdmin && (
            <ModulesSection
              settings={settings}
              onSave={async (key: string, value: string) => {
                await saveSetting(key, value)
                setSettings(prev => ({ ...prev, [key]: value }))
              }}
              savingKey={savingKey}
            />
          )}

          {/* Request Forms (admin only) */}
          {isAdmin && <FormsSection />}

          {/* Webhooks (admin only) */}
          {isAdmin && <WebhooksSection />}

          {/* Kanban Columns (admin only) */}
          {isAdmin && <KanbanColumnsSection />}

          {/* Google Calendar Booking (admin only) - T87 */}
          {isAdmin && <BookingLinkSection settings={settings} onSave={saveSetting} savingKey={savingKey} />}

          {/* Team Management (admin only) - T169 */}
          {isAdmin && (
            <section>
              <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
                <User className="w-5 h-5" aria-hidden="true" />
                Team
              </h2>
              <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
                <p className="text-sm text-[var(--color-text)]">
                  Manage your team members and their access scoping rules.
                </p>
                <a
                  href="/dashboard/team"
                  className="inline-flex items-center gap-2 mt-3 text-sm font-medium transition-colors hover:opacity-80"
                  style={{ color: 'var(--color-brand)', textDecoration: 'none' }}
                >
                  Go to Team Management
                </a>
              </div>
            </section>
          )}

          {/* Billing (admin only) - T171 */}
          {isAdmin && (
            <section>
              <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
                <CreditCard className="w-5 h-5" aria-hidden="true" />
                Billing
              </h2>
              <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
                <p className="text-sm text-[var(--color-text)] mb-1">
                  Manage your Stripe subscription and billing settings.
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Connect Stripe in the Integrations section to enable subscription billing.
                </p>
              </div>
            </section>
          )}

          {/* Account (admin only) */}
          {isAdmin && (
            <section>
              <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Account
              </h2>
              <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 flex items-center justify-center text-white font-semibold text-sm"
                    style={{
                      background: 'var(--color-brand)',
                      borderRadius: 'var(--radius-leaf-sm)',
                    }}
                  >
                    T
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[var(--color-text)]">Tahi Studio</p>
                    <p className="text-xs text-[var(--color-text-muted)]">Organisation workspace</p>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

// -- Profile Section (client portal) --

interface ContactProfile {
  id: string
  name: string
  email: string
  role: string | null
  isPrimary: boolean | null
}

function ProfileSection() {
  const [profile, setProfile] = useState<ContactProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [editName, setEditName] = useState('')
  const [editRole, setEditRole] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)

  const fetchProfile = useCallback(async () => {
    setLoadingProfile(true)
    try {
      const res = await fetch(apiPath('/api/portal/profile'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { contact: ContactProfile | null }
      if (data.contact) {
        setProfile(data.contact)
        setEditName(data.contact.name)
        setEditRole(data.contact.role ?? '')
      }
    } catch {
      setProfile(null)
    } finally {
      setLoadingProfile(false)
    }
  }, [])

  useEffect(() => { void fetchProfile() }, [fetchProfile])

  async function handleSaveProfile() {
    if (!editName.trim()) return
    setSavingProfile(true)
    setProfileSaved(false)
    try {
      const res = await fetch(apiPath('/api/portal/profile'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), role: editRole.trim() }),
      })
      if (res.ok) {
        setProfileSaved(true)
        await fetchProfile()
        setTimeout(() => setProfileSaved(false), 3000)
      }
    } catch {
      // Failed
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <User className="w-5 h-5" />
        Profile
      </h2>
      {loadingProfile ? (
        <LoadingSkeleton rows={3} />
      ) : !profile ? (
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
          <p className="text-sm text-[var(--color-text-muted)]">
            No profile record found. Please contact the Tahi team if you need help setting up your account.
          </p>
        </div>
      ) : (
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="profile-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Name
              </label>
              <input
                id="profile-name"
                type="text"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              />
            </div>
            <div>
              <label htmlFor="profile-email" className="block text-sm font-medium text-[var(--color-text)] mb-1">
                Email
              </label>
              <input
                id="profile-email"
                type="email"
                value={profile.email}
                disabled
                className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-2 text-[var(--color-text-muted)] cursor-not-allowed"
              />
              <p className="text-xs text-[var(--color-text-subtle)] mt-1">
                Email is managed through your login provider.
              </p>
            </div>
          </div>
          <div>
            <label htmlFor="profile-role" className="block text-sm font-medium text-[var(--color-text)] mb-1">
              Role / Title
            </label>
            <input
              id="profile-role"
              type="text"
              value={editRole}
              onChange={e => setEditRole(e.target.value)}
              placeholder="e.g. Marketing Manager"
              className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            />
          </div>
          <div className="flex items-center gap-3">
            <TahiButton
              size="sm"
              onClick={handleSaveProfile}
              disabled={savingProfile || !editName.trim()}
            >
              {savingProfile ? 'Saving...' : 'Save Profile'}
            </TahiButton>
            {profileSaved && (
              <span className="text-xs text-[var(--color-brand)] font-medium">
                Profile updated
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

// -- Types for Forms --

interface FormQuestion {
  id: string
  type: string
  label: string
  required: boolean
  options?: string[]
}

interface FormTemplate {
  id: string
  name: string
  category: string | null
  orgId: string | null
  questions: FormQuestion[]
  isDefault: number
  createdAt: string
  updatedAt: string
}

const QUESTION_TYPES = [
  { value: 'text', label: 'Short Text' },
  { value: 'textarea', label: 'Long Text' },
  { value: 'url', label: 'URL' },
  { value: 'select', label: 'Dropdown' },
  { value: 'multiselect', label: 'Multi-Select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'file', label: 'File Upload' },
]

const FORM_CATEGORIES = [
  { value: '', label: 'All (global)' },
  { value: 'design', label: 'Design' },
  { value: 'development', label: 'Development' },
  { value: 'content', label: 'Content' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'admin', label: 'Admin' },
  { value: 'bug', label: 'Bug' },
]

// -- Booking Link Section (T87) --

function BookingLinkSection({
  settings,
  onSave,
  savingKey,
}: {
  settings: Record<string, string | null>
  onSave: (key: string, value: string) => Promise<void>
  savingKey: string | null
}) {
  const [url, setUrl] = useState(settings['booking.google_cal_url'] ?? '')

  useEffect(() => {
    setUrl(settings['booking.google_cal_url'] ?? '')
  }, [settings])

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Link2 className="w-5 h-5" aria-hidden="true" />
        Call Scheduling
      </h2>
      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
        <div>
          <label htmlFor="booking-url" className="block text-sm font-medium text-[var(--color-text)] mb-1">
            Google Calendar Booking URL
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            Clients will see a &quot;Schedule a Call&quot; button linking to this URL.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="booking-url"
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/..."
              className="flex-1 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            />
            <TahiButton
              size="sm"
              onClick={() => onSave('booking.google_cal_url', url)}
              disabled={savingKey === 'booking.google_cal_url'}
            >
              {savingKey === 'booking.google_cal_url' ? 'Saving...' : 'Save'}
            </TahiButton>
          </div>
        </div>
      </div>
    </section>
  )
}

// -- Forms Section --

function FormsSection() {
  const [forms, setForms] = useState<FormTemplate[]>([])
  const [loadingForms, setLoadingForms] = useState(true)
  const [editingForm, setEditingForm] = useState<FormTemplate | null>(null)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchForms = useCallback(async () => {
    setLoadingForms(true)
    try {
      const res = await fetch(apiPath('/api/admin/forms'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { forms: FormTemplate[] }
      setForms(data.forms ?? [])
    } catch {
      setForms([])
    } finally {
      setLoadingForms(false)
    }
  }, [])

  useEffect(() => { void fetchForms() }, [fetchForms])

  async function handleCreate() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await fetch(apiPath('/api/admin/forms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          category: newCategory || undefined,
          questions: [],
        }),
      })
      setShowNewForm(false)
      setNewName('')
      setNewCategory('')
      await fetchForms()
    } catch {
      // Failed
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteForm(id: string) {
    try {
      await fetch(apiPath(`/api/admin/forms/${id}`), { method: 'DELETE' })
      if (editingForm?.id === id) setEditingForm(null)
      await fetchForms()
    } catch {
      // Failed
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <FileText className="w-5 h-5" />
        Request Forms
      </h2>

      {loadingForms ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <div className="space-y-3">
          {/* Form list */}
          {forms.map(form => (
            <div key={form.id} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-3">
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => setEditingForm(editingForm?.id === form.id ? null : form)}
                    className="text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-brand)] transition-colors text-left"
                  >
                    {form.name}
                  </button>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {form.category || 'Global'} - {(form.questions as FormQuestion[]).length} question{(form.questions as FormQuestion[]).length !== 1 ? 's' : ''}
                    {form.isDefault ? ' (Default)' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingForm(editingForm?.id === form.id ? null : form)}
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                    aria-label="Toggle form editor"
                  >
                    {editingForm?.id === form.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => handleDeleteForm(form.id)}
                    className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-secondary)] transition-colors"
                    aria-label="Delete form"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Inline editor */}
              {editingForm?.id === form.id && (
                <FormEditor
                  form={form}
                  onSaved={async () => {
                    setEditingForm(null)
                    await fetchForms()
                  }}
                />
              )}
            </div>
          ))}

          {/* New form */}
          {showNewForm ? (
            <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="new-form-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">Name</label>
                  <input
                    id="new-form-name"
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Design Request Form"
                    className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                  />
                </div>
                <div>
                  <label htmlFor="new-form-category" className="block text-sm font-medium text-[var(--color-text)] mb-1">Category</label>
                  <select
                    id="new-form-category"
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value)}
                    className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                  >
                    {FORM_CATEGORIES.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <TahiButton variant="secondary" size="sm" onClick={() => setShowNewForm(false)}>Cancel</TahiButton>
                <TahiButton size="sm" onClick={handleCreate} disabled={saving || !newName.trim()}>
                  {saving ? 'Creating...' : 'Create Form'}
                </TahiButton>
              </div>
            </div>
          ) : (
            <TahiButton variant="secondary" size="sm" onClick={() => setShowNewForm(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
              Add Form Template
            </TahiButton>
          )}
        </div>
      )}
    </section>
  )
}

// -- Form Editor --

function FormEditor({ form, onSaved }: { form: FormTemplate; onSaved: () => void }) {
  const [questions, setQuestions] = useState<FormQuestion[]>(
    Array.isArray(form.questions) ? form.questions as FormQuestion[] : []
  )
  const [saving, setSaving] = useState(false)

  function addQuestion() {
    setQuestions([
      ...questions,
      { id: crypto.randomUUID(), type: 'text', label: '', required: false },
    ])
  }

  function updateQuestion(idx: number, updates: Partial<FormQuestion>) {
    setQuestions(questions.map((q, i) => i === idx ? { ...q, ...updates } : q))
  }

  function removeQuestion(idx: number) {
    setQuestions(questions.filter((_, i) => i !== idx))
  }

  async function save() {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/forms/${form.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
      })
      onSaved()
    } catch {
      // Failed
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-[var(--color-border-subtle)] px-5 py-4 space-y-3">
      {questions.map((q, i) => (
        <div key={q.id} className="flex items-start gap-2 bg-[var(--color-bg-secondary)] rounded-lg p-3">
          <GripVertical className="w-4 h-4 text-[var(--color-text-subtle)] mt-2 flex-shrink-0" />
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              value={q.label}
              onChange={e => updateQuestion(i, { label: e.target.value })}
              placeholder="Question label"
              className="text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)] sm:col-span-1"
            />
            <select
              value={q.type}
              onChange={e => updateQuestion(i, { type: e.target.value })}
              className="text-sm rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
            >
              {QUESTION_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
                <input
                  type="checkbox"
                  checked={q.required}
                  onChange={e => updateQuestion(i, { required: e.target.checked })}
                  className="rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                />
                Required
              </label>
              {(q.type === 'select' || q.type === 'multiselect') && (
                <input
                  type="text"
                  value={(q.options ?? []).join(', ')}
                  onChange={e => updateQuestion(i, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                  placeholder="Options (comma-separated)"
                  className="flex-1 text-xs rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                />
              )}
            </div>
          </div>
          <button
            onClick={() => removeQuestion(i)}
            className="p-1 rounded text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] transition-colors mt-1.5"
            aria-label="Remove question"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <button
          onClick={addQuestion}
          className="flex items-center gap-1 text-xs font-medium text-[var(--color-brand)] hover:underline"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Question
        </button>
        <TahiButton size="sm" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save Questions'}
        </TahiButton>
      </div>
    </div>
  )
}

// -- Kanban Columns Section --

interface KanbanColumnData {
  id: string
  orgId?: string | null
  label: string
  statusValue: string
  colour: string | null
  position: number
  isDefault: number
}

interface ClientOption {
  id: string
  name: string
}

function KanbanColumnsSection() {
  const [mode, setMode] = useState<'global' | 'client'>('global')
  const [columns, setColumns] = useState<KanbanColumnData[]>([])
  const [loadingCols, setLoadingCols] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newStatus, setNewStatus] = useState('')
  const [newColour, setNewColour] = useState('#5A824E')
  const [saving, setSaving] = useState(false)

  // Per-client state
  const [clients, setClients] = useState<ClientOption[]>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [selectedClientId, setSelectedClientId] = useState('')
  const [clientSearch, setClientSearch] = useState('')

  const fetchColumns = useCallback(async (orgId?: string) => {
    setLoadingCols(true)
    try {
      const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''
      const res = await fetch(apiPath(`/api/admin/kanban-columns${qs}`))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { columns: KanbanColumnData[] }
      setColumns((data.columns ?? []).sort((a, b) => a.position - b.position))
    } catch {
      setColumns([])
    } finally {
      setLoadingCols(false)
    }
  }, [])

  const fetchClients = useCallback(async () => {
    setLoadingClients(true)
    try {
      const res = await fetch(apiPath('/api/admin/clients?limit=200'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { organisations?: ClientOption[] }
      setClients(data.organisations ?? [])
    } catch {
      setClients([])
    } finally {
      setLoadingClients(false)
    }
  }, [])

  useEffect(() => {
    if (mode === 'global') {
      void fetchColumns()
      setSelectedClientId('')
    } else {
      void fetchClients()
    }
  }, [mode, fetchColumns, fetchClients])

  useEffect(() => {
    if (mode === 'client' && selectedClientId) {
      void fetchColumns(selectedClientId)
    }
  }, [mode, selectedClientId, fetchColumns])

  const currentOrgId = mode === 'client' ? selectedClientId : undefined

  async function handleAdd() {
    if (!newLabel.trim() || !newStatus.trim()) return
    if (mode === 'client' && !selectedClientId) return
    setSaving(true)
    try {
      await fetch(apiPath('/api/admin/kanban-columns'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: currentOrgId ?? null,
          label: newLabel.trim(),
          statusValue: newStatus.trim(),
          colour: newColour,
          position: columns.length,
        }),
      })
      setShowAdd(false)
      setNewLabel('')
      setNewStatus('')
      setNewColour('#5A824E')
      await fetchColumns(currentOrgId)
    } catch {
      // Failed
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteColumn(id: string) {
    try {
      await fetch(apiPath(`/api/admin/kanban-columns/${id}`), { method: 'DELETE' })
      await fetchColumns(currentOrgId)
    } catch {
      // Failed
    }
  }

  async function handleUpdateColumn(id: string, updates: Partial<KanbanColumnData>) {
    try {
      await fetch(apiPath(`/api/admin/kanban-columns/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      await fetchColumns(currentOrgId)
    } catch {
      // Failed
    }
  }

  async function moveColumn(idx: number, direction: -1 | 1) {
    const targetIdx = idx + direction
    if (targetIdx < 0 || targetIdx >= columns.length) return
    const current = columns[idx]
    const target = columns[targetIdx]
    await Promise.all([
      handleUpdateColumn(current.id, { position: target.position }),
      handleUpdateColumn(target.id, { position: current.position }),
    ])
  }

  const filteredClients = clientSearch
    ? clients.filter(c => c.name.toLowerCase().includes(clientSearch.toLowerCase()))
    : clients

  // Check if current columns are global defaults (shown when viewing a client with no overrides)
  const isShowingGlobalFallback = mode === 'client' && selectedClientId && columns.length > 0 && columns.every(c => !c.orgId)

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <GripVertical className="w-5 h-5" />
        Kanban Columns
      </h2>

      {/* Mode toggle */}
      <div className="flex items-center gap-1 mb-4 p-0.5 rounded-lg" style={{ background: 'var(--color-bg-tertiary)', display: 'inline-flex' }}>
        <button
          onClick={() => setMode('global')}
          className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
          style={{
            background: mode === 'global' ? 'var(--color-bg)' : 'transparent',
            color: mode === 'global' ? 'var(--color-text)' : 'var(--color-text-muted)',
            border: 'none',
            cursor: 'pointer',
            boxShadow: mode === 'global' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            minHeight: '2rem',
          }}
        >
          Global Default
        </button>
        <button
          onClick={() => setMode('client')}
          className="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
          style={{
            background: mode === 'client' ? 'var(--color-bg)' : 'transparent',
            color: mode === 'client' ? 'var(--color-text)' : 'var(--color-text-muted)',
            border: 'none',
            cursor: 'pointer',
            boxShadow: mode === 'client' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            minHeight: '2rem',
          }}
        >
          Per-Client Override
        </button>
      </div>

      {/* Client picker (per-client mode only) */}
      {mode === 'client' && (
        <div className="mb-4">
          <label htmlFor="kanban-client-search" className="block text-xs font-medium text-[var(--color-text)] mb-1">
            Select Client
          </label>
          <input
            id="kanban-client-search"
            type="text"
            value={clientSearch}
            onChange={e => setClientSearch(e.target.value)}
            placeholder="Search clients..."
            className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)] mb-2"
            style={{ maxWidth: '24rem' }}
          />
          {loadingClients ? (
            <LoadingSkeleton rows={3} height={36} />
          ) : (
            <div
              className="border border-[var(--color-border)] rounded-lg overflow-hidden"
              style={{ maxWidth: '24rem', maxHeight: '12rem', overflowY: 'auto' }}
            >
              {filteredClients.length === 0 ? (
                <div className="px-3 py-2 text-sm text-[var(--color-text-muted)]">No clients found</div>
              ) : (
                filteredClients.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedClientId(c.id); setClientSearch('') }}
                    className="w-full text-left px-3 py-2 text-sm transition-colors hover:bg-[var(--color-bg-secondary)]"
                    style={{
                      background: selectedClientId === c.id ? 'var(--color-brand-50)' : 'var(--color-bg)',
                      color: selectedClientId === c.id ? 'var(--color-brand-dark)' : 'var(--color-text)',
                      fontWeight: selectedClientId === c.id ? 600 : 400,
                      border: 'none',
                      borderBottom: '1px solid var(--color-border-subtle)',
                      cursor: 'pointer',
                      minHeight: '2.75rem',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    {c.name}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Show columns only when we have context */}
      {mode === 'client' && !selectedClientId ? (
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            Select a client above to view or create custom kanban columns for them.
          </p>
        </div>
      ) : loadingCols ? (
        <LoadingSkeleton rows={3} />
      ) : (
        <div className="space-y-2">
          {/* Info banner when showing global fallback for a client */}
          {isShowingGlobalFallback && (
            <div
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm"
              style={{
                background: 'var(--color-info-bg, #eff6ff)',
                color: 'var(--color-info, #60a5fa)',
                border: '1px solid var(--color-info, #60a5fa)',
              }}
            >
              This client has no custom columns. Showing global defaults. Add a column below to create a client-specific override.
            </div>
          )}

          {columns.map((col, idx) => (
            <div key={col.id} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl px-4 py-3 flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: col.colour ?? 'var(--color-text-subtle)' }}
              />
              <InlineEditText
                value={col.label}
                onSave={label => handleUpdateColumn(col.id, { label })}
                className="flex-1 text-sm font-medium text-[var(--color-text)]"
              />
              <span className="text-xs text-[var(--color-text-subtle)] flex-shrink-0">{col.statusValue}</span>
              <input
                type="color"
                value={col.colour ?? '#5A824E'}
                onChange={e => handleUpdateColumn(col.id, { colour: e.target.value })}
                className="w-6 h-6 rounded border border-[var(--color-border)] cursor-pointer flex-shrink-0"
                aria-label={`Change color for ${col.label}`}
              />
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={() => moveColumn(idx, -1)}
                  disabled={idx === 0}
                  className="p-1 rounded text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-30 transition-colors"
                  aria-label="Move up"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => moveColumn(idx, 1)}
                  disabled={idx === columns.length - 1}
                  className="p-1 rounded text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-30 transition-colors"
                  aria-label="Move down"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                onClick={() => handleDeleteColumn(col.id)}
                className="p-1 rounded text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-secondary)] transition-colors flex-shrink-0"
                aria-label="Delete column"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {showAdd ? (
            <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="new-col-label" className="block text-xs font-medium text-[var(--color-text)] mb-1">Label</label>
                  <input
                    id="new-col-label"
                    type="text"
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    placeholder="In Progress"
                    className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                  />
                </div>
                <div>
                  <label htmlFor="new-col-status" className="block text-xs font-medium text-[var(--color-text)] mb-1">Status Value</label>
                  <input
                    id="new-col-status"
                    type="text"
                    value={newStatus}
                    onChange={e => setNewStatus(e.target.value)}
                    placeholder="in_progress"
                    className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                  />
                </div>
                <div>
                  <label htmlFor="new-col-colour" className="block text-xs font-medium text-[var(--color-text)] mb-1">Colour</label>
                  <input
                    id="new-col-colour"
                    type="color"
                    value={newColour}
                    onChange={e => setNewColour(e.target.value)}
                    className="w-full h-8 rounded-lg border border-[var(--color-border)] cursor-pointer"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <TahiButton variant="secondary" size="sm" onClick={() => setShowAdd(false)}>Cancel</TahiButton>
                <TahiButton size="sm" onClick={handleAdd} disabled={saving || !newLabel.trim() || !newStatus.trim()}>
                  {saving ? 'Adding...' : 'Add Column'}
                </TahiButton>
              </div>
            </div>
          ) : (
            <TahiButton variant="secondary" size="sm" onClick={() => setShowAdd(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
              Add Column
            </TahiButton>
          )}
        </div>
      )}
    </section>
  )
}

// -- Webhooks Section --

const WEBHOOK_EVENTS = [
  { value: 'request.created', label: 'Request Created' },
  { value: 'request.updated', label: 'Request Updated' },
  { value: 'request.completed', label: 'Request Completed' },
  { value: 'client.created', label: 'Client Created' },
  { value: 'invoice.created', label: 'Invoice Created' },
  { value: 'invoice.paid', label: 'Invoice Paid' },
  { value: 'message.sent', label: 'Message Sent' },
]

interface WebhookEndpoint {
  id: string
  url: string
  secret: string
  events: string[]
  createdAt: string
}

function WebhooksSection() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([])
  const [loadingWebhooks, setLoadingWebhooks] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newSecret, setNewSecret] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null)

  const fetchWebhooks = useCallback(async () => {
    setLoadingWebhooks(true)
    try {
      const res = await fetch(apiPath('/api/admin/webhooks'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { endpoints: WebhookEndpoint[] }
      setEndpoints(data.endpoints ?? [])
    } catch {
      setEndpoints([])
    } finally {
      setLoadingWebhooks(false)
    }
  }, [])

  useEffect(() => { void fetchWebhooks() }, [fetchWebhooks])

  async function handleAdd() {
    if (!newUrl.trim() || !newSecret.trim() || selectedEvents.length === 0) return
    setSaving(true)
    try {
      await fetch(apiPath('/api/admin/webhooks'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: newUrl.trim(),
          secret: newSecret.trim(),
          events: selectedEvents,
        }),
      })
      setShowAdd(false)
      setNewUrl('')
      setNewSecret('')
      setSelectedEvents([])
      await fetchWebhooks()
    } catch {
      // Failed
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeleteLoading(id)
    try {
      await fetch(apiPath(`/api/admin/webhooks?id=${id}`), { method: 'DELETE' })
      await fetchWebhooks()
    } catch {
      // Failed
    } finally {
      setDeleteLoading(null)
    }
  }

  function toggleEvent(event: string) {
    setSelectedEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event],
    )
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Webhook className="w-5 h-5" />
        Webhooks
      </h2>

      {loadingWebhooks ? (
        <LoadingSkeleton rows={2} />
      ) : (
        <div className="space-y-3">
          {endpoints.length === 0 && !showAdd && (
            <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 text-center">
              <p className="text-sm text-[var(--color-text-muted)]">
                No webhook endpoints configured. Add one to receive event notifications.
              </p>
            </div>
          )}

          {endpoints.map(ep => (
            <div key={ep.id} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--color-text)] truncate">{ep.url}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {ep.events.map(ev => (
                      <span
                        key={ev}
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          background: 'var(--color-bg-tertiary)',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        {ev}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--color-text-subtle)] mt-1">
                    Created {ep.createdAt ? new Date(ep.createdAt).toLocaleDateString('en-NZ') : 'unknown'}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(ep.id)}
                  disabled={deleteLoading === ep.id}
                  className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-secondary)] transition-colors flex-shrink-0"
                  aria-label="Delete webhook"
                >
                  {deleteLoading === ep.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ))}

          {showAdd ? (
            <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="webhook-url" className="block text-sm font-medium text-[var(--color-text)] mb-1">URL</label>
                  <input
                    id="webhook-url"
                    type="url"
                    value={newUrl}
                    onChange={e => setNewUrl(e.target.value)}
                    placeholder="https://example.com/webhook"
                    className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                  />
                </div>
                <div>
                  <label htmlFor="webhook-secret" className="block text-sm font-medium text-[var(--color-text)] mb-1">Secret</label>
                  <input
                    id="webhook-secret"
                    type="text"
                    value={newSecret}
                    onChange={e => setNewSecret(e.target.value)}
                    placeholder="whsec_..."
                    className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                  />
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-text)] mb-2">Events</p>
                <div className="flex flex-wrap gap-2">
                  {WEBHOOK_EVENTS.map(ev => (
                    <label
                      key={ev.value}
                      className="flex items-center gap-1.5 text-sm cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(ev.value)}
                        onChange={() => toggleEvent(ev.value)}
                        className="rounded border-[var(--color-border)] accent-[var(--color-brand)]"
                      />
                      <span className="text-[var(--color-text-muted)]">{ev.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <TahiButton variant="secondary" size="sm" onClick={() => { setShowAdd(false); setSelectedEvents([]) }}>Cancel</TahiButton>
                <TahiButton size="sm" onClick={handleAdd} disabled={saving || !newUrl.trim() || !newSecret.trim() || selectedEvents.length === 0}>
                  {saving ? 'Adding...' : 'Add Webhook'}
                </TahiButton>
              </div>
            </div>
          ) : (
            <TahiButton variant="secondary" size="sm" onClick={() => setShowAdd(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
              Add Webhook Endpoint
            </TahiButton>
          )}
        </div>
      )}
    </section>
  )
}

// -- Inline Edit Text --

function InlineEditText({
  value, onSave, className,
}: {
  value: string
  onSave: (v: string) => void
  className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)

  function commit() {
    if (text.trim() && text.trim() !== value) {
      onSave(text.trim())
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
        autoFocus
        className="text-sm rounded border border-[var(--color-brand)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[var(--color-text)] focus:outline-none"
        style={{ width: `${Math.max(text.length, 8)}ch` }}
      />
    )
  }

  return (
    <button
      onClick={() => { setText(value); setEditing(true) }}
      className={`${className ?? ''} hover:underline cursor-text text-left`}
    >
      {value}
    </button>
  )
}

// ── Branding Section (T277) ─────────────────────────────────────────────────

const COLOR_PRESETS = [
  '#5A824E', '#2563eb', '#7c3aed', '#dc2626', '#d97706',
  '#059669', '#0d9488', '#db2777', '#6366f1', '#1e293b',
]

function BrandingSection({
  settings,
  onSave,
  savingKey,
}: {
  settings: Record<string, string | null>
  onSave: (key: string, value: string) => Promise<void>
  savingKey: string | null
}) {
  const [portalName, setPortalName] = useState('')
  const [primaryColor, setPrimaryColor] = useState('#5A824E')
  const [logoUrl, setLogoUrl] = useState('')
  const [faviconLightUrl, setFaviconLightUrl] = useState('/dashboard/favicon.png')
  const [faviconDarkUrl, setFaviconDarkUrl] = useState('/dashboard/favicon.png')

  // Sync from settings when loaded
  useEffect(() => {
    setPortalName(settings['portal_name'] ?? '')
    setPrimaryColor(settings['portal_primary_color'] ?? '#5A824E')
    setLogoUrl(settings['portal_logo_url'] ?? '')
    setFaviconLightUrl(settings['favicon_light_url'] ?? '/dashboard/favicon.png')
    setFaviconDarkUrl(settings['favicon_dark_url'] ?? '/dashboard/favicon.png')
  }, [settings])

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Palette className="w-5 h-5" aria-hidden="true" />
        Portal Branding
      </h2>
      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl divide-y divide-[var(--color-border-subtle)]">
        {/* Portal name */}
        <div className="p-5">
          <label htmlFor="branding-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">
            Portal Name
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mb-2">
            Displayed in the client portal header.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="branding-name"
              type="text"
              value={portalName}
              onChange={e => setPortalName(e.target.value)}
              placeholder="Tahi Studio"
              className="flex-1 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                minHeight: '2.75rem',
              }}
            />
            <button
              onClick={() => onSave('portal_name', portalName)}
              disabled={savingKey === 'portal_name'}
              className="px-3 py-2 text-sm font-medium text-white transition-colors"
              style={{
                background: 'var(--color-brand)',
                borderRadius: 'var(--radius-button)',
                border: 'none',
                cursor: savingKey === 'portal_name' ? 'not-allowed' : 'pointer',
                opacity: savingKey === 'portal_name' ? 0.7 : 1,
                minHeight: '2.75rem',
              }}
            >
              {savingKey === 'portal_name' ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* Primary color */}
        <div className="p-5">
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1">
            Primary Color
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mb-3">
            Used for buttons, links, and accents in the client portal.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            {COLOR_PRESETS.map(color => (
              <button
                key={color}
                onClick={() => {
                  setPrimaryColor(color)
                  void onSave('portal_primary_color', color)
                }}
                className="w-8 h-8 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                style={{
                  background: color,
                  border: primaryColor === color ? '3px solid var(--color-text)' : '2px solid var(--color-border)',
                  cursor: 'pointer',
                }}
                aria-label={`Select color ${color}`}
              />
            ))}
            <div className="flex items-center gap-2 ml-2">
              <input
                type="color"
                value={primaryColor}
                onChange={e => setPrimaryColor(e.target.value)}
                onBlur={() => onSave('portal_primary_color', primaryColor)}
                className="w-8 h-8 rounded cursor-pointer"
                style={{ border: '1px solid var(--color-border)', padding: 0 }}
                aria-label="Custom color picker"
              />
              <span className="text-xs font-mono text-[var(--color-text-muted)]">
                {primaryColor}
              </span>
            </div>
          </div>

          {/* Live preview */}
          <div className="mt-4">
            <p className="text-xs font-medium text-[var(--color-text-muted)] mb-2">Preview</p>
            <div
              className="flex items-center gap-3 rounded-lg"
              style={{
                padding: '0.75rem 1rem',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-secondary)',
              }}
            >
              <button
                className="px-4 py-2 text-sm font-medium text-white rounded-lg"
                style={{ background: primaryColor, border: 'none', cursor: 'default' }}
              >
                Primary Button
              </button>
              <span className="text-sm font-medium" style={{ color: primaryColor }}>
                Link text
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: `${primaryColor}20`,
                  color: primaryColor,
                }}
              >
                Badge
              </span>
            </div>
          </div>
        </div>

        {/* Logo URL */}
        <div className="p-5">
          <label htmlFor="branding-logo" className="block text-sm font-medium text-[var(--color-text)] mb-1">
            Logo URL
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mb-2">
            Enter a URL to your logo image. Displayed in the portal header.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="branding-logo"
              type="url"
              value={logoUrl}
              onChange={e => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="flex-1 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                minHeight: '2.75rem',
              }}
            />
            <button
              onClick={() => onSave('portal_logo_url', logoUrl)}
              disabled={savingKey === 'portal_logo_url'}
              className="px-3 py-2 text-sm font-medium text-white transition-colors"
              style={{
                background: 'var(--color-brand)',
                borderRadius: 'var(--radius-button)',
                border: 'none',
                cursor: savingKey === 'portal_logo_url' ? 'not-allowed' : 'pointer',
                opacity: savingKey === 'portal_logo_url' ? 0.7 : 1,
                minHeight: '2.75rem',
              }}
            >
              {savingKey === 'portal_logo_url' ? 'Saving...' : 'Save'}
            </button>
          </div>
          {logoUrl && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-[var(--color-text-muted)]">Preview:</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="Logo preview"
                className="h-8 object-contain"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
          )}
        </div>

        {/* Favicon (Light Mode) */}
        <div className="p-5">
          <label htmlFor="branding-favicon-light" className="block text-sm font-medium text-[var(--color-text)] mb-1">
            Favicon (Light Mode)
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mb-2">
            Favicon displayed when the user is in light mode.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="branding-favicon-light"
              type="url"
              value={faviconLightUrl}
              onChange={e => setFaviconLightUrl(e.target.value)}
              placeholder="/dashboard/favicon.png"
              className="flex-1 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                minHeight: '2.75rem',
              }}
            />
            <button
              onClick={() => onSave('favicon_light_url', faviconLightUrl)}
              disabled={savingKey === 'favicon_light_url'}
              className="px-3 py-2 text-sm font-medium text-white transition-colors"
              style={{
                background: 'var(--color-brand)',
                borderRadius: 'var(--radius-button)',
                border: 'none',
                cursor: savingKey === 'favicon_light_url' ? 'not-allowed' : 'pointer',
                opacity: savingKey === 'favicon_light_url' ? 0.7 : 1,
                minHeight: '2.75rem',
              }}
            >
              {savingKey === 'favicon_light_url' ? 'Saving...' : 'Save'}
            </button>
          </div>
          {faviconLightUrl && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-[var(--color-text-muted)]">Preview:</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={faviconLightUrl}
                alt="Favicon light mode preview"
                style={{ width: '2rem', height: '2rem', objectFit: 'contain' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
          )}
        </div>

        {/* Favicon (Dark Mode) */}
        <div className="p-5">
          <label htmlFor="branding-favicon-dark" className="block text-sm font-medium text-[var(--color-text)] mb-1">
            Favicon (Dark Mode)
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mb-2">
            Favicon displayed when the user is in dark mode.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="branding-favicon-dark"
              type="url"
              value={faviconDarkUrl}
              onChange={e => setFaviconDarkUrl(e.target.value)}
              placeholder="/dashboard/favicon.png"
              className="flex-1 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: 'var(--radius-input)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                minHeight: '2.75rem',
              }}
            />
            <button
              onClick={() => onSave('favicon_dark_url', faviconDarkUrl)}
              disabled={savingKey === 'favicon_dark_url'}
              className="px-3 py-2 text-sm font-medium text-white transition-colors"
              style={{
                background: 'var(--color-brand)',
                borderRadius: 'var(--radius-button)',
                border: 'none',
                cursor: savingKey === 'favicon_dark_url' ? 'not-allowed' : 'pointer',
                opacity: savingKey === 'favicon_dark_url' ? 0.7 : 1,
                minHeight: '2.75rem',
              }}
            >
              {savingKey === 'favicon_dark_url' ? 'Saving...' : 'Save'}
            </button>
          </div>
          {faviconDarkUrl && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-[var(--color-text-muted)]">Preview:</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={faviconDarkUrl}
                alt="Favicon dark mode preview"
                style={{ width: '2rem', height: '2rem', objectFit: 'contain' }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// -- Modules Section (T278) --

const MODULE_CONFIG = [
  {
    key: 'requests',
    name: 'Requests',
    description: 'Task and request management for client work',
  },
  {
    key: 'messaging',
    name: 'Messaging',
    description: 'Direct and group conversations with clients and team',
  },
  {
    key: 'billing',
    name: 'Billing',
    description: 'Invoicing, payments, and subscription management',
  },
  {
    key: 'time_tracking',
    name: 'Time Tracking',
    description: 'Log and report hours worked per client and request',
  },
  {
    key: 'reports',
    name: 'Reports',
    description: 'Charts, analytics, and performance dashboards',
  },
]

function ModulesSection({
  settings,
  onSave,
  savingKey,
}: {
  settings: Record<string, string | null>
  onSave: (key: string, value: string) => Promise<void>
  savingKey: string | null
}) {
  function isEnabled(moduleKey: string): boolean {
    const settingKey = `module_${moduleKey}_enabled`
    // Default to enabled if not explicitly set
    return settings[settingKey] !== 'false'
  }

  async function handleToggle(moduleKey: string) {
    const settingKey = `module_${moduleKey}_enabled`
    const next = !isEnabled(moduleKey)
    await onSave(settingKey, next ? 'true' : 'false')
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <ToggleLeft className="w-5 h-5" aria-hidden="true" />
        Modules
      </h2>
      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl divide-y divide-[var(--color-border-subtle)]">
        {MODULE_CONFIG.map(mod => {
          const enabled = isEnabled(mod.key)
          const settingKey = `module_${mod.key}_enabled`
          return (
            <div key={mod.key} className="flex items-center justify-between p-5">
              <div>
                <p className="text-sm font-medium text-[var(--color-text)]">{mod.name}</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                  {mod.description}
                </p>
              </div>
              <button
                onClick={() => handleToggle(mod.key)}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                style={{
                  background: enabled ? 'var(--color-brand)' : 'var(--color-border)',
                }}
                role="switch"
                aria-checked={enabled}
                aria-label={`Toggle ${mod.name}`}
                disabled={savingKey === settingKey}
              >
                <span
                  className="inline-block h-4 w-4 rounded-full bg-white transition-transform"
                  style={{
                    transform: enabled ? 'translateX(1.375rem)' : 'translateX(0.25rem)',
                  }}
                />
              </button>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-[var(--color-text-subtle)] mt-2">
        Disabled modules will be hidden from the sidebar navigation.
      </p>
    </section>
  )
}
