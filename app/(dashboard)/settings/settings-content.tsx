'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  RefreshCw, Sun, Moon,
  CreditCard, Link2, Bell, Building2,
  FileText, Plus, Trash2, GripVertical, ChevronDown, ChevronUp,
  Webhook, Loader2, User, Palette, ToggleLeft,
  Target, ClipboardList, Pencil, Sparkles, Share2, Heart, MessageCircle,
  PiggyBank, Lightbulb, Eye, EyeOff,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { useToast } from '@/components/tahi/toast'
import { TiptapDocEditor } from '@/components/tahi/tiptap-doc-editor'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { Input, Select, Textarea } from '@/components/tahi/input'
import { SlideOver } from '@/components/tahi/slide-over'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { apiPath } from '@/lib/api'

// -- Types --

interface IntegrationCard {
  key: string
  name: string
  description: string
  icon: React.ReactNode
  disabled?: boolean
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
    description: 'CRM is built-in, no external integration needed',
    icon: <Link2 className="w-5 h-5" />,
    disabled: true,
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
  const { showToast } = useToast()

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
      const res = await fetch(apiPath('/api/admin/settings'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
        throw new Error(data.error ?? 'Failed to save setting')
      }
      setSettings(prev => ({ ...prev, [key]: value }))
      showToast('Setting saved', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save setting', 'error')
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
                    cursor: 'pointer',
                    border: 'none',
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
                  const isDisabled = integration.disabled === true
                  const status = getIntegrationStatus(integration.key)
                  const isConnected = !isDisabled && status === 'connected'
                  return (
                    <div
                      key={integration.key}
                      className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5"
                      style={{ opacity: isDisabled ? 0.6 : 1 }}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="w-10 h-10 flex items-center justify-center flex-shrink-0"
                          style={{
                            borderRadius: 'var(--radius-leaf-sm)',
                            background: isDisabled ? 'var(--color-bg-tertiary)' : isConnected ? 'var(--color-brand-50)' : 'var(--color-bg-tertiary)',
                            color: isDisabled ? 'var(--color-text-subtle)' : isConnected ? 'var(--color-brand)' : 'var(--color-text-muted)',
                          }}
                        >
                          {integration.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-semibold" style={{ color: isDisabled ? 'var(--color-text-subtle)' : 'var(--color-text)' }}>
                              {integration.name}
                            </h3>
                            {isDisabled ? (
                              <Badge tone="neutral" size="sm">Built-in</Badge>
                            ) : (
                              <Badge tone={isConnected ? 'positive' : 'neutral'} size="sm" dot>
                                {isConnected ? 'Connected' : 'Not Connected'}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs mt-0.5" style={{ color: isDisabled ? 'var(--color-text-subtle)' : 'var(--color-text-muted)' }}>
                            {integration.description}
                          </p>
                          {integration.key === 'xero' && isConnected && (
                            <span className="text-xs mt-1" style={{ color: 'var(--color-text-subtle)' }}>
                              Custom Connection (auto-authenticates)
                            </span>
                          )}
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

          {/* Cash reserves (admin only). Sits between Notifications
              and Integrations conceptually — surfaces the reserve pots
              that drive the disposable-cash math on /financial-reports. */}
          {isAdmin && <ReservesSection />}

          {/* Branding (admin only) - T277 */}
          {isAdmin && (
            <BrandingSection
              settings={settings}
              onSave={saveSetting}
              savingKey={savingKey}
            />
          )}

          {/* Modules Toggle (admin only) - T278 */}
          {isAdmin && (
            <ModulesSection
              settings={settings}
              onSave={saveSetting}
              savingKey={savingKey}
            />
          )}

          {/* Request Forms (admin only) */}
          {isAdmin && <FormsSection />}

          {/* Webhooks (admin only) */}
          {isAdmin && <WebhooksSection />}

          {/* Kanban Columns (admin only) */}
          {isAdmin && <KanbanColumnsSection />}

          {/* Task Templates (admin only) - T423 */}
          {isAdmin && <TaskTemplatesSection />}

          {/* Pipeline Defaults (admin only): default deal owner + nudge signature */}
          {isAdmin && (
            <PipelineDefaultsSection
              settings={settings}
              onSave={saveSetting}
              savingKey={savingKey}
            />
          )}

          {/* Pipeline Stages (admin only) - T289 */}
          {isAdmin && <PipelineStagesSection />}

          {/* Lead AI & automations (admin only) */}
          {isAdmin && (
            <LeadAutomationsSection
              settings={settings}
              onSave={saveSetting}
              savingKey={savingKey}
            />
          )}

          {/* Scheduled jobs visibility (admin only) — links to the new
              /settings/crons page where each cron's last run + manual
              triggers live. */}
          {isAdmin && <ScheduledJobsLinkSection />}

          {/* AI context docs (Docs Hub pages wired into AI prompts) */}
          {isAdmin && (
            <AiContextDocsSection
              settings={settings as Record<string, string>}
              onSave={saveSetting}
              savingKey={savingKey}
            />
          )}

          {/* Google Workspace (Calendar + Drive) */}
          {isAdmin && <GoogleIntegrationSection />}

          {/* Buffer (Liam's personal social) */}
          {isAdmin && <BufferIntegrationSection />}

          {/* AI cost dashboard */}
          {isAdmin && <AiCostSection />}

          {/* Content engine signals (Phase I Slice 1) */}
          {isAdmin && (
            <ContentEngineSignalsSection
              settings={settings}
              onSave={saveSetting}
              savingKey={savingKey}
            />
          )}

          {/* Google Calendar Booking (admin only) - T87 */}
          {isAdmin && <BookingLinkSection settings={settings} onSave={saveSetting} savingKey={savingKey} />}

          {/* Team Management (admin only) - T169 */}
          {isAdmin && (
            <section>
              <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
                <User className="w-5 h-5" aria-hidden="true" />
                Team
              </h2>
              <Card>
                <p className="text-sm text-[var(--color-text)]">
                  Manage your team members and their access scoping rules.
                </p>
                <a
                  href="/team"
                  className="inline-flex items-center gap-2 mt-3 text-sm font-medium transition-colors hover:opacity-80"
                  style={{ color: 'var(--color-brand)', textDecoration: 'none', cursor: 'pointer' }}
                >
                  Go to Team Management
                </a>
              </Card>
            </section>
          )}

          {/* Billing (admin only) - T171 */}
          {isAdmin && (
            <section>
              <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
                <CreditCard className="w-5 h-5" aria-hidden="true" />
                Billing
              </h2>
              <Card>
                <p className="text-sm text-[var(--color-text)] mb-1">
                  Manage your Stripe subscription and billing settings.
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Connect Stripe in the Integrations section to enable subscription billing.
                </p>
              </Card>
            </section>
          )}

          {/* Account (admin only) */}
          {isAdmin && (
            <section>
              <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Account
              </h2>
              <Card>
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
              </Card>
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

// -- Task Templates Section (T423) --

interface TaskTemplate {
  id: string
  name: string
  type: string
  category: string | null
  defaultPriority: string | null
  description: string | null
}

const TASK_TYPE_OPTIONS = [
  { value: 'client_external', label: 'Client External' },
  { value: 'internal_client', label: 'Internal Client' },
  { value: 'tahi_internal', label: 'Tahi Internal' },
]

const PRIORITY_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

function priorityBadgeTone(p: string): 'info' | 'warning' | 'danger' | 'rose' | 'neutral' {
  switch (p) {
    case 'low':    return 'info'
    case 'medium': return 'warning'
    case 'high':   return 'danger'
    case 'urgent': return 'rose'
    default:       return 'neutral'
  }
}

function TaskTemplatesSection() {
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState('tahi_internal')
  const [formCategory, setFormCategory] = useState('')
  const [formPriority, setFormPriority] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/task-templates'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { templates: TaskTemplate[] }
      setTemplates(data.templates ?? [])
    } catch {
      setTemplates([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchTemplates() }, [fetchTemplates])

  function resetForm() {
    setFormName('')
    setFormType('tahi_internal')
    setFormCategory('')
    setFormPriority('')
    setFormDescription('')
    setEditingId(null)
    setShowForm(false)
  }

  function startEdit(t: TaskTemplate) {
    setFormName(t.name)
    setFormType(t.type)
    setFormCategory(t.category ?? '')
    setFormPriority(t.defaultPriority ?? '')
    setFormDescription(t.description ?? '')
    setEditingId(t.id)
    setShowForm(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!formName.trim()) return
    setSaving(true)
    try {
      const body = {
        name: formName.trim(),
        type: formType,
        category: formCategory || null,
        defaultPriority: formPriority || null,
        description: formDescription.trim() || null,
      }
      const url = editingId
        ? apiPath(`/api/admin/task-templates/${editingId}`)
        : apiPath('/api/admin/task-templates')
      const method = editingId ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        resetForm()
        await fetchTemplates()
      }
    } catch {
      // silent
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id)
    try {
      await fetch(apiPath(`/api/admin/task-templates/${id}`), { method: 'DELETE' })
      await fetchTemplates()
    } catch {
      // silent
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <ClipboardList className="w-5 h-5" aria-hidden="true" />
        Task Templates
      </h2>
      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
        {/* Add button */}
        <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
          <p className="text-xs text-[var(--color-text-muted)]">
            Define reusable templates for tasks.
          </p>
          {!showForm && (
            <TahiButton
              size="sm"
              onClick={() => { resetForm(); setShowForm(true) }}
              iconLeft={<Plus className="w-3.5 h-3.5" />}
            >
              Add Template
            </TahiButton>
          )}
        </div>

        {/* Inline form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4 rounded-lg mb-4" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
                  Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full rounded-lg"
                  style={{
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.875rem',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    minHeight: '2.5rem',
                  }}
                  autoFocus
                  placeholder="e.g. Weekly status update"
                />
              </div>
              <div>
                <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
                  Type
                </label>
                <select
                  value={formType}
                  onChange={e => setFormType(e.target.value)}
                  className="w-full rounded-lg cursor-pointer"
                  style={{
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.875rem',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    minHeight: '2.5rem',
                  }}
                >
                  {TASK_TYPE_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
                  Category
                </label>
                <input
                  type="text"
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value)}
                  className="w-full rounded-lg"
                  style={{
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.875rem',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    minHeight: '2.5rem',
                  }}
                  placeholder="e.g. design, development"
                />
              </div>
              <div>
                <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
                  Default Priority
                </label>
                <select
                  value={formPriority}
                  onChange={e => setFormPriority(e.target.value)}
                  className="w-full rounded-lg cursor-pointer"
                  style={{
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.875rem',
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text)',
                    minHeight: '2.5rem',
                  }}
                >
                  {PRIORITY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block font-medium" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
                Description
              </label>
              <textarea
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                className="w-full rounded-lg resize-y"
                rows={2}
                style={{
                  padding: '0.5rem 0.75rem',
                  fontSize: '0.875rem',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                }}
                placeholder="Optional description for this template"
              />
            </div>
            <div className="flex justify-end gap-2">
              <TahiButton type="button" variant="secondary" size="sm" onClick={resetForm}>
                Cancel
              </TahiButton>
              <TahiButton type="submit" size="sm" disabled={saving || !formName.trim()} loading={saving}>
                {editingId ? 'Update' : 'Create'}
              </TahiButton>
            </div>
          </form>
        )}

        {/* Template list */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse rounded-lg" style={{ height: '3rem', background: 'var(--color-bg-tertiary)' }} />
            ))}
          </div>
        ) : templates.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)] text-center" style={{ padding: '1.5rem 0' }}>
            No task templates yet. Create one to get started.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {templates.map(t => {
              const typeLabel = TASK_TYPE_OPTIONS.find(o => o.value === t.type)?.label ?? t.type
              return (
                <div
                  key={t.id}
                  className="flex items-center justify-between rounded-lg"
                  style={{
                    padding: '0.625rem 0.75rem',
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate" style={{ fontSize: '0.875rem', color: 'var(--color-text)' }}>
                        {t.name}
                      </span>
                      <Badge tone="neutral" size="sm">{typeLabel}</Badge>
                      {t.category && <Badge tone="neutral" size="sm">{t.category}</Badge>}
                      {t.defaultPriority && (
                        <Badge tone={priorityBadgeTone(t.defaultPriority)} size="sm">
                          {t.defaultPriority}
                        </Badge>
                      )}
                    </div>
                    {t.description && (
                      <p className="truncate" style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '0.125rem' }}>
                        {t.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0" style={{ marginLeft: '0.75rem' }}>
                    <button
                      onClick={() => startEdit(t)}
                      className="rounded-lg transition-colors"
                      style={{
                        padding: '0.375rem',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-text-subtle)',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                      aria-label="Edit template"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(t.id)}
                      disabled={deletingId === t.id}
                      className="rounded-lg transition-colors"
                      style={{
                        padding: '0.375rem',
                        background: 'transparent',
                        border: 'none',
                        cursor: deletingId === t.id ? 'not-allowed' : 'pointer',
                        color: 'var(--color-text-subtle)',
                        opacity: deletingId === t.id ? 0.5 : 1,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-danger)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                      aria-label="Delete template"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// -- Pipeline Stages Section (T289) --

// -- Pipeline Defaults Section --
// Owns: default deal owner, nudge signature.
// Both are stored in the key/value `settings` table so they don't need a
// schema migration. The deal POST and nudge send paths read these directly.

interface TeamMemberOption {
  id: string
  name: string
  email: string | null
  avatarUrl: string | null
}

function PipelineDefaultsSection({
  settings,
  onSave,
  savingKey,
}: {
  settings: Record<string, string | null>
  onSave: (key: string, value: string) => Promise<void>
  savingKey: string | null
}) {
  const [members, setMembers] = useState<TeamMemberOption[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [signatureDraft, setSignatureDraft] = useState<string>('')

  const ownerKey = 'pipeline.defaultDealOwnerId'
  const sigKey = 'pipeline.nudgeSignatureHtml'
  const currentOwnerId = settings[ownerKey] ?? ''
  const currentSignature = settings[sigKey] ?? ''

  // Hydrate signature draft from settings whenever it changes externally.
  useEffect(() => {
    setSignatureDraft(currentSignature)
  }, [currentSignature])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(apiPath('/api/admin/team-members'))
        if (!res.ok) throw new Error('Failed to load team members')
        const data = await res.json() as { items?: TeamMemberOption[] }
        if (!cancelled) setMembers(data.items ?? [])
      } catch {
        if (!cancelled) setMembers([])
      } finally {
        if (!cancelled) setLoadingMembers(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const signatureDirty = signatureDraft !== currentSignature

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Target className="w-5 h-5" />
        Pipeline Defaults
      </h2>

      <div className="space-y-4">
        {/* Default deal owner */}
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
          <label htmlFor="default-deal-owner" className="block text-sm font-medium text-[var(--color-text)]">
            Default deal owner
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            Auto-assigned as the owner whenever a new deal is created without one.
          </p>
          {loadingMembers ? (
            <LoadingSkeleton rows={1} />
          ) : (
            <select
              id="default-deal-owner"
              value={currentOwnerId}
              onChange={(e) => { void onSave(ownerKey, e.target.value) }}
              disabled={savingKey === ownerKey}
              className="w-full sm:w-80 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              <option value="">No default (leave unassigned)</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.email ? ` (${m.email})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Nudge signature */}
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
          <label className="block text-sm font-medium text-[var(--color-text)]">
            Nudge email signature
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            Appended to every nudge email at send time. Format with the rich
            text controls (links, lists, headings and emphasis all carry
            through to the email).
          </p>
          <TiptapDocEditor
            content={signatureDraft}
            onChange={(html) => setSignatureDraft(html)}
            placeholder="Liam Miller, Tahi Studio, tahi.studio"
          />
          <div className="flex items-center justify-end gap-2 mt-3">
            {signatureDirty && (
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={() => setSignatureDraft(currentSignature)}
              >
                Discard
              </TahiButton>
            )}
            <TahiButton
              size="sm"
              onClick={() => { void onSave(sigKey, signatureDraft) }}
              disabled={!signatureDirty || savingKey === sigKey}
            >
              {savingKey === sigKey ? 'Saving...' : 'Save signature'}
            </TahiButton>
          </div>
        </div>

        {/* Forecast horizon: drives "12-mo Total Pipeline" rollup, weighted
            forecast, and the recurring-portion contribution to deal value. */}
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
          <label htmlFor="forecast-horizon" className="block text-sm font-medium text-[var(--color-text)]">
            Pipeline forecast horizon
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            Months of recurring revenue to roll into the headline pipeline number. 12 is the SaaS standard.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="forecast-horizon"
              type="number"
              min={1}
              max={36}
              defaultValue={settings['pipeline.forecastHorizonMonths'] ?? '12'}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim()
                const n = parseInt(v, 10)
                const next = Number.isFinite(n) && n > 0 ? String(Math.min(36, Math.max(1, n))) : '12'
                if (next !== (settings['pipeline.forecastHorizonMonths'] ?? '12')) {
                  void onSave('pipeline.forecastHorizonMonths', next)
                }
              }}
              disabled={savingKey === 'pipeline.forecastHorizonMonths'}
              className="text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              style={{ width: '6rem', minHeight: '2.5rem' }}
            />
            <span className="text-sm text-[var(--color-text-muted)]">months</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// -- Scheduled jobs link card --
// Cheap entry point — the full UI lives at /settings/crons.
function ScheduledJobsLinkSection() {
  return (
    <section
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-card)',
        padding: '1.25rem 1.5rem',
      }}
    >
      <div className="flex items-start justify-between" style={{ gap: '1rem', flexWrap: 'wrap' }}>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[var(--color-text)]">Scheduled jobs</h2>
          <p className="text-xs text-[var(--color-text-muted)] mt-1" style={{ lineHeight: 1.5 }}>
            Calendar pull, transcript pull, pre-call digest, lead AI, daily summary, auto-promote, affiliate reactivation — see their last run + fire any one manually.
          </p>
        </div>
        <Link
          href="/settings/crons"
          className="inline-flex items-center"
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            padding: '0.4375rem 0.75rem',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            color: 'var(--color-text)',
            textDecoration: 'none',
            background: 'var(--color-bg)',
          }}
        >
          Open scheduled jobs →
        </Link>
      </div>
    </section>
  )
}

// -- Lead AI & Automations Section --
// All toggles + tunables live in the key/value `settings` table so no
// schema migration is needed. The cron route (POST /api/admin/cron/leads-ai)
// reads these on every run.

function LeadAutomationsSection({
  settings,
  onSave,
  savingKey,
}: {
  settings: Record<string, string | null>
  onSave: (key: string, value: string) => Promise<void>
  savingKey: string | null
}) {
  const [members, setMembers] = useState<TeamMemberOption[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)

  const ownerKey = 'leads.defaultLeadOwnerId'
  const cronEnabledKey = 'leads.cronEnabled'
  const highIntentKey = 'leads.highIntentThreshold'
  const idleDaysKey = 'leads.idleQualifyingDays'
  const autoNurturingKey = 'leads.autoNurturingAfterDays'
  const notifyHighIntentKey = 'leads.notifyOnHighIntent'
  const notifyIdleKey = 'leads.notifyOnIdleQualifying'
  const notifyEnrichedKey = 'leads.notifyOnEnriched'
  const discoveryTemplateKey = 'leads.discoveryQuestionsTemplate'

  // Hydrate discovery questions from JSON.
  const rawTemplate = settings[discoveryTemplateKey] ?? '[]'
  const initialQuestions: string[] = (() => {
    try {
      const p = JSON.parse(rawTemplate)
      return Array.isArray(p) ? p.filter((q: unknown): q is string => typeof q === 'string') : []
    } catch { return [] }
  })()
  const [questions, setQuestions] = useState<string[]>(initialQuestions)
  const [questionsDirty, setQuestionsDirty] = useState(false)

  useEffect(() => {
    // Re-hydrate if settings.discoveryQuestionsTemplate changes externally.
    try {
      const p = JSON.parse(settings[discoveryTemplateKey] ?? '[]')
      if (Array.isArray(p)) setQuestions(p.filter((q: unknown): q is string => typeof q === 'string'))
    } catch {
      // ignore
    }
    setQuestionsDirty(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings[discoveryTemplateKey]])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(apiPath('/api/admin/team-members'))
        if (!res.ok) throw new Error('Failed to load team members')
        const data = await res.json() as { items?: TeamMemberOption[] }
        if (!cancelled) setMembers(data.items ?? [])
      } catch {
        if (!cancelled) setMembers([])
      } finally {
        if (!cancelled) setLoadingMembers(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  // Helper to read bool settings with defaults.
  const boolSetting = (key: string, fallback: boolean): boolean => {
    const v = settings[key]
    if (v == null) return fallback
    return v === 'true' || v === '1'
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Sparkles className="w-5 h-5" />
        Lead AI &amp; Automations
      </h2>

      <div className="space-y-4">
        {/* Default lead owner */}
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
          <label htmlFor="default-lead-owner" className="block text-sm font-medium text-[var(--color-text)]">
            Default lead owner
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            Auto-assigned as the owner of every new lead. Also where lead AI notifications get sent.
          </p>
          {loadingMembers ? (
            <LoadingSkeleton rows={1} />
          ) : (
            <select
              id="default-lead-owner"
              value={settings[ownerKey] ?? ''}
              onChange={(e) => { void onSave(ownerKey, e.target.value) }}
              disabled={savingKey === ownerKey}
              className="w-full sm:w-80 text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
            >
              <option value="">No default (leave unassigned)</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.email ? ` (${m.email})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Discovery questions template */}
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
          <label className="block text-sm font-medium text-[var(--color-text)]">
            3 always-ask discovery questions
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            These appear on every lead&apos;s call brief, alongside 3 unique AI-generated questions tailored to that prospect.
          </p>
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <input
                key={i}
                type="text"
                value={questions[i] ?? ''}
                onChange={(e) => {
                  const next = [...questions]
                  next[i] = e.target.value
                  setQuestions(next)
                  setQuestionsDirty(true)
                }}
                placeholder={`Question ${i + 1}`}
                className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              />
            ))}
          </div>
          {questionsDirty && (
            <div className="flex items-center justify-end gap-2 mt-3">
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={() => {
                  try {
                    const p = JSON.parse(settings[discoveryTemplateKey] ?? '[]')
                    if (Array.isArray(p)) setQuestions(p.filter((q: unknown): q is string => typeof q === 'string'))
                  } catch { setQuestions([]) }
                  setQuestionsDirty(false)
                }}
              >
                Discard
              </TahiButton>
              <TahiButton
                size="sm"
                onClick={() => { void onSave(discoveryTemplateKey, JSON.stringify(questions.filter(Boolean).slice(0, 3))) }}
                disabled={savingKey === discoveryTemplateKey}
              >
                {savingKey === discoveryTemplateKey ? 'Saving...' : 'Save questions'}
              </TahiButton>
            </div>
          )}
        </div>

        {/* Daily cron master switch */}
        <ToggleRow
          label="Daily AI scoring cron"
          help="Re-scores active leads each day where something has changed. Cheap (Haiku, no web search). Turn off to pause AI processing entirely."
          settingKey={cronEnabledKey}
          defaultOn={true}
          settings={settings}
          onSave={onSave}
          savingKey={savingKey}
        />

        {/* High-intent threshold */}
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
          <label htmlFor="high-intent" className="block text-sm font-medium text-[var(--color-text)]">
            High-intent score threshold
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            When a lead&apos;s score crosses this number, the cron fires a &quot;high intent&quot; notification to the default lead owner. 80 is a strong fit by default.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="high-intent"
              type="number"
              min={1}
              max={100}
              defaultValue={settings[highIntentKey] ?? '80'}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim()
                const n = parseInt(v, 10)
                const next = Number.isFinite(n) && n > 0 ? String(Math.min(100, Math.max(1, n))) : '80'
                if (next !== (settings[highIntentKey] ?? '80')) void onSave(highIntentKey, next)
              }}
              disabled={savingKey === highIntentKey}
              className="text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              style={{ width: '6rem', minHeight: '2.5rem' }}
            />
            <span className="text-sm text-[var(--color-text-muted)]">/ 100</span>
          </div>
          <div className="mt-3">
            <ToggleRow
              compact
              label="Notify me when a lead crosses the threshold"
              help=""
              settingKey={notifyHighIntentKey}
              defaultOn={true}
              settings={settings}
              onSave={onSave}
              savingKey={savingKey}
            />
          </div>
        </div>

        {/* Idle qualifying threshold */}
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
          <label htmlFor="idle-days" className="block text-sm font-medium text-[var(--color-text)]">
            Idle &quot;Qualifying&quot; notification
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            Notify when a lead has sat in Qualifying with no activity for this many days. 7 keeps the funnel honest.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="idle-days"
              type="number"
              min={1}
              max={60}
              defaultValue={settings[idleDaysKey] ?? '7'}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim()
                const n = parseInt(v, 10)
                const next = Number.isFinite(n) && n > 0 ? String(Math.min(60, Math.max(1, n))) : '7'
                if (next !== (settings[idleDaysKey] ?? '7')) void onSave(idleDaysKey, next)
              }}
              disabled={savingKey === idleDaysKey}
              className="text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              style={{ width: '6rem', minHeight: '2.5rem' }}
            />
            <span className="text-sm text-[var(--color-text-muted)]">days</span>
          </div>
          <div className="mt-3">
            <ToggleRow
              compact
              label="Send idle-lead notifications"
              help=""
              settingKey={notifyIdleKey}
              defaultOn={true}
              settings={settings}
              onSave={onSave}
              savingKey={savingKey}
            />
          </div>
        </div>

        {/* Smart-enrich gate (auto-spend control) */}
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
          <label htmlFor="auto-enrich-threshold" className="block text-sm font-medium text-[var(--color-text)]">
            Auto-enrich score threshold
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            When the cron scores an unenriched lead above this number, full Sonnet enrichment auto-runs (~$0.30/lead). Set to 0 to disable and only enrich manually. 60 is the sensible default: only spend research budget on leads that look promising.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="auto-enrich-threshold"
              type="number"
              min={0}
              max={100}
              defaultValue={settings['leads.autoEnrichScoreThreshold'] ?? '60'}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim()
                const n = parseInt(v, 10)
                const next = Number.isFinite(n) && n >= 0 ? String(Math.min(100, Math.max(0, n))) : '60'
                if (next !== (settings['leads.autoEnrichScoreThreshold'] ?? '60')) void onSave('leads.autoEnrichScoreThreshold', next)
              }}
              disabled={savingKey === 'leads.autoEnrichScoreThreshold'}
              className="text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              style={{ width: '6rem', minHeight: '2.5rem' }}
            />
            <span className="text-sm text-[var(--color-text-muted)]">/ 100 (0 = manual only)</span>
          </div>
        </div>

        {/* Daily enrichment hard cap (cost ceiling) */}
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
          <label htmlFor="max-auto-enrich" className="block text-sm font-medium text-[var(--color-text)]">
            Max auto-enrichments per day
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            Hard cap on how many leads the cron can auto-enrich in a single day. At ~$0.30/enrich, 10 = $3/day max. Stops a flood of high-scoring leads (e.g. a bulk import) from spending too much in one go. Manual &quot;Run AI&quot; clicks are not counted.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="max-auto-enrich"
              type="number"
              min={0}
              max={100}
              defaultValue={settings['leads.maxAutoEnrichmentsPerDay'] ?? '10'}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim()
                const n = parseInt(v, 10)
                const next = Number.isFinite(n) && n >= 0 ? String(Math.min(100, Math.max(0, n))) : '10'
                if (next !== (settings['leads.maxAutoEnrichmentsPerDay'] ?? '10')) void onSave('leads.maxAutoEnrichmentsPerDay', next)
              }}
              disabled={savingKey === 'leads.maxAutoEnrichmentsPerDay'}
              className="text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              style={{ width: '6rem', minHeight: '2.5rem' }}
            />
            <span className="text-sm text-[var(--color-text-muted)]">per day</span>
          </div>
        </div>

        {/* Auto-status transition (opt-in) */}
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
          <label htmlFor="auto-nurturing" className="block text-sm font-medium text-[var(--color-text)]">
            Auto-flip Qualifying → Nurturing
          </label>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            Automatically moves a lead from Qualifying to Nurturing after this many days of no activity. Set to 0 to disable. Off by default so you stay in control.
          </p>
          <div className="flex items-center gap-2">
            <input
              id="auto-nurturing"
              type="number"
              min={0}
              max={90}
              defaultValue={settings[autoNurturingKey] ?? '0'}
              onBlur={(e) => {
                const v = e.currentTarget.value.trim()
                const n = parseInt(v, 10)
                const next = Number.isFinite(n) && n >= 0 ? String(Math.min(90, Math.max(0, n))) : '0'
                if (next !== (settings[autoNurturingKey] ?? '0')) void onSave(autoNurturingKey, next)
              }}
              disabled={savingKey === autoNurturingKey}
              className="text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
              style={{ width: '6rem', minHeight: '2.5rem' }}
            />
            <span className="text-sm text-[var(--color-text-muted)]">days (0 = off)</span>
          </div>
        </div>

        {/* Enriched notification toggle */}
        <ToggleRow
          label="Notify me when AI enrichment completes"
          help="Sent the first time a lead is enriched. Useful right after a Webflow form lead lands and the AI finishes researching it."
          settingKey={notifyEnrichedKey}
          defaultOn={true}
          settings={settings}
          onSave={onSave}
          savingKey={savingKey}
        />
      </div>
    </section>
  )

  // Tiny helper to keep boolean toggles uniform. Defined inside the component
  // so it can close over the loaded `settings` map for the current value.
  function _useBool(key: string, fallback: boolean) {
    return boolSetting(key, fallback)
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  void _useBool
}

/** Small reusable toggle pill backed by a boolean setting. */
function ToggleRow({
  label,
  help,
  settingKey,
  defaultOn,
  settings,
  onSave,
  savingKey,
  compact,
}: {
  label: string
  help: string
  settingKey: string
  defaultOn: boolean
  settings: Record<string, string | null>
  onSave: (key: string, value: string) => Promise<void>
  savingKey: string | null
  compact?: boolean
}) {
  const raw = settings[settingKey]
  const value = raw == null ? defaultOn : (raw === 'true' || raw === '1')

  const containerClass = compact
    ? 'flex items-start justify-between gap-3'
    : 'bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 flex items-start justify-between gap-3'

  return (
    <div className={containerClass}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-[var(--color-text)]">{label}</div>
        {help && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{help}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        disabled={savingKey === settingKey}
        onClick={() => { void onSave(settingKey, value ? 'false' : 'true') }}
        style={{
          flexShrink: 0,
          width: '2.5rem',
          height: '1.5rem',
          borderRadius: '9999px',
          background: value ? 'var(--color-brand)' : 'var(--color-border)',
          padding: 0,
          border: 'none',
          cursor: 'pointer',
          transition: 'background-color 150ms ease',
          position: 'relative',
        }}
        aria-label={label}
      >
        <span style={{
          display: 'block',
          width: '1.125rem',
          height: '1.125rem',
          borderRadius: '9999px',
          background: '#ffffff',
          position: 'absolute',
          top: '0.1875rem',
          left: value ? 'calc(100% - 1.3125rem)' : '0.1875rem',
          transition: 'left 200ms cubic-bezier(0.22, 1, 0.36, 1)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        }} />
      </button>
    </div>
  )
}

// -- Google Workspace integration section --
// Connect via OAuth, sync Calendar events into discovery_calls,
// disconnect when needed.

interface GoogleStatus {
  connected: boolean
  status?: string
  email: string | null
  scopes: string[]
  expiresAt: string | null
  lastSyncedAt: string | null
  errorMessage: string | null
  configured: boolean
}

function GoogleIntegrationSection() {
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSyncSummary, setLastSyncSummary] = useState<{
    fetched: number; matched: number; created: number; updated: number; skipped: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/integrations/google/status'))
      if (!res.ok) throw new Error('Failed to load Google status')
      const data = await res.json() as GoogleStatus
      setStatus(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // Pick up ?connected=1 or ?error=X from the OAuth callback redirect
    if (typeof window !== 'undefined' && window.location.hash.includes('google')) {
      if (window.location.hash.includes('connected=1')) {
        showToast('Google connected', 'success')
      } else if (window.location.hash.includes('error=')) {
        const m = window.location.hash.match(/error=([^&]+)/)
        if (m) setError(decodeURIComponent(m[1]))
      }
    }
  }, [load, showToast])

  async function startConnect() {
    setConnecting(true)
    setError(null)
    try {
      const res = await fetch(apiPath('/api/admin/integrations/google/start'))
      const data = await res.json() as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? 'Could not start OAuth')
      }
      window.location.href = data.url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connect failed')
      setConnecting(false)
    }
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Google? Existing Calendar-synced calls stay; future syncs stop.')) return
    try {
      await fetch(apiPath('/api/admin/integrations/google/status'), { method: 'DELETE' })
      await load()
      showToast('Google disconnected', 'success')
    } catch {
      setError('Disconnect failed')
    }
  }

  async function syncCalendar() {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch(apiPath('/api/admin/integrations/google/sync-calendar'), { method: 'POST' })
      const data = await res.json() as {
        fetched?: number; matched?: number; created?: number; updated?: number; skipped?: number
        error?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'Sync failed')
      setLastSyncSummary({
        fetched: data.fetched ?? 0,
        matched: data.matched ?? 0,
        created: data.created ?? 0,
        updated: data.updated ?? 0,
        skipped: data.skipped ?? 0,
      })
      await load()
      showToast(`Synced: ${data.created ?? 0} new + ${data.updated ?? 0} updated`, 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section id="google">
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Link2 className="w-5 h-5" />
        Google Workspace
      </h2>

      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
        <p className="text-xs text-[var(--color-text-muted)]">
          Connect a Google account to auto-pull Calendar meetings into the dashboard. The sync matches attendee emails against leads, contacts, and active deals, then creates a discovery call on the right record. Drive integration (for &quot;Notes by Gemini&quot; transcripts) layers on after this is wired.
        </p>

        {loading && <LoadingSkeleton rows={1} />}

        {!loading && status && !status.configured && (
          <div className="text-sm text-[var(--color-warning)] bg-[var(--color-warning-bg)] border border-[var(--color-warning)] rounded-lg p-3">
            GOOGLE_CLIENT_ID is not configured on this environment. Add GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET to the Webflow Cloud secrets, then refresh.
          </div>
        )}

        {!loading && status && status.configured && (
          <>
            {status.connected ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Badge tone="positive" variant="soft" size="sm">Connected</Badge>
                  <div className="text-sm text-[var(--color-text)]">
                    {status.email ?? 'Connected (email unknown)'}
                  </div>
                </div>
                {status.lastSyncedAt && (
                  <div className="text-xs text-[var(--color-text-muted)]">
                    Last synced: {new Date(status.lastSyncedAt).toLocaleString()}
                  </div>
                )}
                {status.errorMessage && (
                  <div className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg)] border border-[var(--color-danger)] rounded-lg p-3">
                    {status.errorMessage}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <TahiButton
                    size="sm"
                    onClick={() => { void syncCalendar() }}
                    disabled={syncing}
                    iconLeft={syncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  >
                    {syncing ? 'Syncing...' : 'Sync calendar now'}
                  </TahiButton>
                  <TahiButton variant="secondary" size="sm" onClick={disconnect}>
                    Disconnect
                  </TahiButton>
                </div>
                {lastSyncSummary && (
                  <div className="text-xs text-[var(--color-text-muted)] bg-[var(--color-bg-secondary)] border border-[var(--color-border-subtle)] rounded-lg p-3">
                    Last run: <strong>{lastSyncSummary.fetched}</strong> events fetched ·
                    <strong> {lastSyncSummary.matched}</strong> matched ·
                    <strong> {lastSyncSummary.created}</strong> created ·
                    <strong> {lastSyncSummary.updated}</strong> updated ·
                    <strong> {lastSyncSummary.skipped}</strong> skipped (no CRM match)
                  </div>
                )}
              </div>
            ) : (
              <div>
                <TahiButton
                  size="sm"
                  onClick={() => { void startConnect() }}
                  disabled={connecting}
                  iconLeft={<Link2 className="w-3.5 h-3.5" />}
                >
                  {connecting ? 'Redirecting...' : 'Connect Google'}
                </TahiButton>
              </div>
            )}
          </>
        )}

        {error && (
          <div className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg)] border border-[var(--color-danger)] rounded-lg p-3">
            {error}
          </div>
        )}
      </div>
    </section>
  )
}

interface PipelineStageData {
  id: string
  name: string
  slug: string
  probability: number
  position: number
  colour: string | null
  isDefault: number
  isClosedWon: number
  isClosedLost: number
}

function PipelineStagesSection() {
  const [stages, setStages] = useState<PipelineStageData[]>([])
  const [loadingStages, setLoadingStages] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColour, setNewColour] = useState('#5A824E')
  const [newProbability, setNewProbability] = useState('50')
  const { showToast } = useToast()

  const fetchStages = useCallback(async () => {
    setLoadingStages(true)
    try {
      const res = await fetch(apiPath('/api/admin/pipeline/stages'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { stages: PipelineStageData[] }
      setStages((data.stages ?? []).sort((a, b) => a.position - b.position))
      setDirty(false)
    } catch {
      setStages([])
    } finally {
      setLoadingStages(false)
    }
  }, [])

  useEffect(() => { void fetchStages() }, [fetchStages])

  function updateStage(idx: number, updates: Partial<PipelineStageData>) {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s))
    setDirty(true)
  }

  function moveStage(idx: number, direction: -1 | 1) {
    const targetIdx = idx + direction
    if (targetIdx < 0 || targetIdx >= stages.length) return
    setStages(prev => {
      const next = [...prev]
      const currentPos = next[idx].position
      next[idx] = { ...next[idx], position: next[targetIdx].position }
      next[targetIdx] = { ...next[targetIdx], position: currentPos }
      return next.sort((a, b) => a.position - b.position)
    })
    setDirty(true)
  }

  function removeStage(idx: number) {
    setStages(prev => {
      const next = prev.filter((_, i) => i !== idx)
      return next.map((s, i) => ({ ...s, position: i }))
    })
    setDirty(true)
  }

  function addStage() {
    if (!newName.trim()) return
    const slug = newName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    setStages(prev => [
      ...prev,
      {
        id: `_new_${Date.now()}`,
        name: newName.trim(),
        slug,
        probability: parseInt(newProbability, 10) || 0,
        position: prev.length,
        colour: newColour,
        isDefault: 0,
        isClosedWon: 0,
        isClosedLost: 0,
      },
    ])
    setShowAdd(false)
    setNewName('')
    setNewColour('#5A824E')
    setNewProbability('50')
    setDirty(true)
  }

  async function saveAll() {
    setSaving(true)
    try {
      const res = await fetch(apiPath('/api/admin/pipeline/stages'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages }),
      })
      if (!res.ok) throw new Error('Failed to save')
      showToast('Pipeline stages saved', 'success')
      await fetchStages()
    } catch {
      showToast('Failed to save pipeline stages', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Target className="w-5 h-5" />
        Pipeline Stages
      </h2>

      {loadingStages ? (
        <LoadingSkeleton rows={4} />
      ) : (
        <div className="space-y-2">
          {stages.map((stage, idx) => (
            <div key={stage.id} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl px-4 py-3 flex items-center gap-3">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: stage.colour ?? 'var(--color-text-subtle)' }}
              />
              <InlineEditText
                value={stage.name}
                onSave={name => updateStage(idx, { name })}
                className="flex-1 text-sm font-medium text-[var(--color-text)]"
              />
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <label className="text-xs text-[var(--color-text-subtle)]" htmlFor={`prob-${stage.id}`}>
                  Prob:
                </label>
                <input
                  id={`prob-${stage.id}`}
                  type="number"
                  min={0}
                  max={100}
                  value={stage.probability}
                  onChange={e => updateStage(idx, { probability: parseInt(e.target.value, 10) || 0 })}
                  className="text-sm rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-1.5 py-0.5 text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-brand)]"
                  style={{ width: '3.5rem' }}
                />
                <span className="text-xs text-[var(--color-text-subtle)]">%</span>
              </div>
              <input
                type="color"
                value={stage.colour ?? '#5A824E'}
                onChange={e => updateStage(idx, { colour: e.target.value })}
                className="w-6 h-6 rounded border border-[var(--color-border)] cursor-pointer flex-shrink-0"
                aria-label={`Change color for ${stage.name}`}
              />
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={() => moveStage(idx, -1)}
                  disabled={idx === 0}
                  className="p-1 rounded text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-30 transition-colors"
                  aria-label="Move up"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => moveStage(idx, 1)}
                  disabled={idx === stages.length - 1}
                  className="p-1 rounded text-[var(--color-text-subtle)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-30 transition-colors"
                  aria-label="Move down"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <button
                onClick={() => removeStage(idx)}
                className="p-1 rounded text-[var(--color-text-subtle)] hover:text-[var(--color-danger)] hover:bg-[var(--color-bg-secondary)] transition-colors flex-shrink-0"
                aria-label="Remove stage"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {showAdd ? (
            <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label htmlFor="new-stage-name" className="block text-xs font-medium text-[var(--color-text)] mb-1">Name</label>
                  <input
                    id="new-stage-name"
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Discovery"
                    className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                  />
                </div>
                <div>
                  <label htmlFor="new-stage-prob" className="block text-xs font-medium text-[var(--color-text)] mb-1">Probability %</label>
                  <input
                    id="new-stage-prob"
                    type="number"
                    min={0}
                    max={100}
                    value={newProbability}
                    onChange={e => setNewProbability(e.target.value)}
                    className="w-full text-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]"
                  />
                </div>
                <div>
                  <label htmlFor="new-stage-colour" className="block text-xs font-medium text-[var(--color-text)] mb-1">Colour</label>
                  <input
                    id="new-stage-colour"
                    type="color"
                    value={newColour}
                    onChange={e => setNewColour(e.target.value)}
                    className="w-full h-8 rounded-lg border border-[var(--color-border)] cursor-pointer"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <TahiButton variant="secondary" size="sm" onClick={() => setShowAdd(false)}>Cancel</TahiButton>
                <TahiButton size="sm" onClick={addStage} disabled={!newName.trim()}>
                  Add Stage
                </TahiButton>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <TahiButton variant="secondary" size="sm" onClick={() => setShowAdd(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
                Add Stage
              </TahiButton>
              {dirty && (
                <TahiButton size="sm" onClick={saveAll} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </TahiButton>
              )}
            </div>
          )}

          {dirty && !showAdd && (
            <p className="text-xs text-[var(--color-warning)]">
              You have unsaved changes. Click &quot;Save Changes&quot; to apply.
            </p>
          )}
        </div>
      )}
    </section>
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
                background: 'var(--color-info-bg)',
                color: 'var(--color-info)',
                border: '1px solid var(--color-info)',
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
                      <Badge key={ev} tone="neutral" size="sm">{ev}</Badge>
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
  '#5A824E', 'var(--status-submitted-text)', '#7c3aed', 'var(--color-danger)', 'var(--status-in-review-text)',
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
  const [faviconLightUrl, setFaviconLightUrl] = useState('/favicon.png')
  const [faviconDarkUrl, setFaviconDarkUrl] = useState('/favicon.png')

  // Sync from settings when loaded
  useEffect(() => {
    setPortalName(settings['portal_name'] ?? '')
    setPrimaryColor(settings['portal_primary_color'] ?? '#5A824E')
    setLogoUrl(settings['portal_logo_url'] ?? '')
    setFaviconLightUrl(settings['favicon_light_url'] ?? '/favicon.png')
    setFaviconDarkUrl(settings['favicon_dark_url'] ?? '/favicon.png')
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
            <Input
              id="branding-name"
              type="text"
              value={portalName}
              onChange={e => setPortalName(e.target.value)}
              placeholder="Tahi Studio"
              style={{ flex: 1 }}
            />
            <TahiButton
              size="sm"
              onClick={() => onSave('portal_name', portalName)}
              disabled={savingKey === 'portal_name'}
              loading={savingKey === 'portal_name'}
            >
              Save
            </TahiButton>
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
            <Input
              id="branding-logo"
              type="url"
              value={logoUrl}
              onChange={e => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              style={{ flex: 1 }}
            />
            <TahiButton
              size="sm"
              onClick={() => onSave('portal_logo_url', logoUrl)}
              disabled={savingKey === 'portal_logo_url'}
              loading={savingKey === 'portal_logo_url'}
            >
              Save
            </TahiButton>
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
            <Input
              id="branding-favicon-light"
              type="url"
              value={faviconLightUrl}
              onChange={e => setFaviconLightUrl(e.target.value)}
              placeholder="/favicon.png"
              style={{ flex: 1 }}
            />
            <TahiButton
              size="sm"
              onClick={() => onSave('favicon_light_url', faviconLightUrl)}
              disabled={savingKey === 'favicon_light_url'}
              loading={savingKey === 'favicon_light_url'}
            >
              Save
            </TahiButton>
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
            <Input
              id="branding-favicon-dark"
              type="url"
              value={faviconDarkUrl}
              onChange={e => setFaviconDarkUrl(e.target.value)}
              placeholder="/favicon.png"
              style={{ flex: 1 }}
            />
            <TahiButton
              size="sm"
              onClick={() => onSave('favicon_dark_url', faviconDarkUrl)}
              disabled={savingKey === 'favicon_dark_url'}
              loading={savingKey === 'favicon_dark_url'}
            >
              Save
            </TahiButton>
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
                  cursor: savingKey === settingKey ? 'not-allowed' : 'pointer',
                  border: 'none',
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

// ── AI cost dashboard ───────────────────────────────────────────────────
// Pulls from /api/admin/reports/ai-cost. Shows total + last-30-day
// token spend across all AI surfaces, plus top 10 leads by spend.
// Tokens not dollars — Anthropic pricing changes too fast to bake in.

interface AiCostResponse {
  totals: {
    allTime: { tokens: number; leadTokens: number; draftTokens: number; leads: number; drafts: number }
    last30Days: { tokens: number; leadTokens: number; draftTokens: number; leads: number; drafts: number }
  }
  topLeads: Array<{ id: string; name: string; company: string | null; tokens: number; score: number | null; enriched: boolean }>
  enrichmentSurface: { enrichedLeads: number; estimatedTokens: number }
  pricingNote: string
}

function AiCostSection() {
  const [data, setData] = useState<AiCostResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/reports/ai-cost'))
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d as AiCostResponse | null))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  const fmtTokens = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
    return n.toLocaleString()
  }
  // Rough USD estimate: weighted average of Haiku (cheap) + Sonnet
  // (pricier). Most tokens are Haiku scoring, so $1.50 / 1M is a
  // safe-ish all-in number for display.
  const estimateUsd = (n: number) => (n / 1_000_000) * 1.5

  return (
    <section id="ai-cost">
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Sparkles className="w-5 h-5" />
        AI cost
      </h2>

      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
        {loading && <LoadingSkeleton rows={2} />}
        {!loading && !data && (
          <p className="text-sm text-[var(--color-text-muted)]">
            Cost data unavailable.
          </p>
        )}
        {!loading && data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <CostTile
                label="Last 30 days"
                value={fmtTokens(data.totals.last30Days.tokens)}
                sub={`${data.totals.last30Days.leads} leads · ${data.totals.last30Days.drafts} drafts · ~$${estimateUsd(data.totals.last30Days.tokens).toFixed(2)} USD`}
              />
              <CostTile
                label="All time"
                value={fmtTokens(data.totals.allTime.tokens)}
                sub={`${data.totals.allTime.leads} leads · ${data.totals.allTime.drafts} drafts · ~$${estimateUsd(data.totals.allTime.tokens).toFixed(2)} USD`}
              />
            </div>

            {data.topLeads.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-subtle)] mb-2">
                  Top spend by lead
                </p>
                <ul className="space-y-1.5">
                  {data.topLeads.slice(0, 5).map(l => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-md"
                      style={{
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border-subtle)',
                      }}
                    >
                      <a
                        href={`/leads/${l.id}`}
                        className="text-sm text-[var(--color-text)] truncate hover:underline"
                      >
                        {l.name}
                        {l.company && (
                          <span className="text-[var(--color-text-subtle)]"> · {l.company}</span>
                        )}
                      </a>
                      <span className="text-xs text-[var(--color-text-muted)] flex-shrink-0 font-mono">
                        {fmtTokens(l.tokens)}
                        {l.score != null && (
                          <span className="text-[var(--color-text-subtle)]"> · score {l.score}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-xs text-[var(--color-text-subtle)] italic leading-relaxed">
              {data.pricingNote}
            </p>
          </>
        )}
      </div>
    </section>
  )
}

function CostTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
      }}
    >
      <p className="text-xs uppercase tracking-wider text-[var(--color-text-subtle)] font-semibold">
        {label}
      </p>
      <p className="text-2xl font-bold text-[var(--color-text)] mt-1 tabular-nums">
        {value} <span className="text-sm font-normal text-[var(--color-text-muted)]">tokens</span>
      </p>
      <p className="text-xs text-[var(--color-text-subtle)] mt-1">{sub}</p>
    </div>
  )
}

// ── AI context docs (Docs Hub → AI prompts) ─────────────────────────────
// Read-only inventory of the canonical docs wired into the AI prompts
// + a docs picker so Liam can swap them. The actual loading +
// caching happens in lib/ai-context.ts on the server.

interface DocLite { id: string; title: string; slug: string; category: string | null }

interface AiContextRow {
  settingKey: string
  label: string
  description: string
  surfaces: string  // human-readable list of where the doc is used
}

const AI_CONTEXT_ROWS: AiContextRow[] = [
  { settingKey: 'ai.icpDocId',       label: 'Ideal Client Profile',  description: 'Drives lead scoring + enrichment fit. Discriminating signal for the AI.', surfaces: 'Scoring (Haiku) · Enrichment (Sonnet) · Reply drafting' },
  { settingKey: 'ai.brandDnaDocId',  label: 'Brand DNA',             description: 'Tahi positioning + voice principles. Frames how AI talks about us.',     surfaces: 'Reply drafting' },
  { settingKey: 'ai.toneDocId',      label: 'Tone of Voice',         description: 'Cadence + phrasing rules. NZ English, no em dashes, direct + warm.',     surfaces: 'Reply drafting' },
  { settingKey: 'ai.liamVoiceDocId', label: 'Liam Personal Voice',   description: 'How Liam writes personally. Outreach style for first-touch replies.',    surfaces: 'Reply drafting' },
  { settingKey: 'ai.aiTellsDocId',   label: 'AI Writing Tells',      description: 'Anti-patterns the AI must avoid. Phrases that scream "AI wrote this".',  surfaces: 'Reply drafting' },
  { settingKey: 'ai.servicesDocId',  label: 'Services + Pricing',    description: 'Product catalogue. AI knows what we sell when assessing fit.',           surfaces: 'Scoring · Enrichment' },
]

function AiContextDocsSection({
  settings,
  onSave,
  savingKey,
}: {
  settings: Record<string, string>
  onSave: (key: string, value: string) => Promise<void>
  savingKey: string | null
}) {
  const [docs, setDocs] = useState<DocLite[]>([])
  const [loadingDocs, setLoadingDocs] = useState(true)

  useEffect(() => {
    fetch(apiPath('/api/admin/docs'))
      .then(r => r.ok ? r.json() : { pages: [] })
      .then(data => {
        const typed = data as { pages?: DocLite[] }
        setDocs(typed.pages ?? [])
      })
      .catch(() => setDocs([]))
      .finally(() => setLoadingDocs(false))
  }, [])

  return (
    <section id="ai-context">
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Sparkles className="w-5 h-5" />
        AI context docs
      </h2>

      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
        <p className="text-xs text-[var(--color-text-muted)]">
          Tahi&apos;s AI surfaces (lead scoring, enrichment, reply drafting) read these Docs Hub pages as canonical context. Edit the doc → AI behaviour updates within 5 minutes. Pick a different page below if you want to swap.
        </p>

        {loadingDocs && <LoadingSkeleton rows={2} />}

        {!loadingDocs && AI_CONTEXT_ROWS.map(row => {
          const currentDocId = settings[row.settingKey] ?? ''
          const currentDoc = docs.find(d => d.id === currentDocId)
          return (
            <div
              key={row.settingKey}
              className="rounded-lg p-3"
              style={{
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-text)]">{row.label}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{row.description}</p>
                  <p className="text-xs text-[var(--color-text-subtle)] mt-1 italic">Used by: {row.surfaces}</p>
                </div>
                {currentDoc ? (
                  <Badge tone="positive" variant="soft" size="sm">Wired</Badge>
                ) : (
                  <Badge tone="warning" variant="soft" size="sm">Not set</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={currentDocId}
                  onChange={e => { void onSave(row.settingKey, e.target.value) }}
                  disabled={savingKey === row.settingKey}
                  className="flex-1 min-w-0 text-sm rounded-md px-2 py-1.5"
                  style={{
                    background: 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  <option value="">— pick a doc —</option>
                  {docs
                    .slice()
                    .sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.title.localeCompare(b.title))
                    .map(d => (
                      <option key={d.id} value={d.id}>
                        {d.category ? `${d.category} · ` : ''}{d.title}
                      </option>
                    ))}
                </select>
                {currentDoc && (
                  <a
                    href={`/docs/${currentDoc.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--color-brand)] underline hover:no-underline"
                  >
                    Open doc
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Buffer integration (Liam's personal social) ─────────────────────────
// Uses Buffer's new GraphQL API (api.buffer.com). Surfaces connected
// channels + recent posts. Per-post engagement metrics are NOT
// available on this API (Buffer gates those behind Analyze) — so the
// UI shows post text + date + channel only.
// Intentionally scoped to Liam's personal Buffer, not the Tahi page.

interface BufferChannelLite {
  id: string
  name: string | null
  displayName: string | null
  service: string
  avatarUrl: string | null
  isQueuePaused: boolean
}

interface BufferPostLite {
  id: string
  channelId: string
  text: string
  status: string
  sentAt: string | null
  scheduledAt: string | null
  createdAt: string | null
}

interface BufferStatusResponse {
  configured: boolean
  connected: boolean
  organizationId: string | null
  organizationName: string | null
  channels: BufferChannelLite[]
  errorMessage: string | null
}

interface BufferPostsResponse {
  posts: BufferPostLite[]
  channels: BufferChannelLite[]
  totals: {
    posts: number
    byService: Record<string, number>
  }
}

function BufferIntegrationSection() {
  const [status, setStatus] = useState<BufferStatusResponse | null>(null)
  const [posts, setPosts] = useState<BufferPostLite[] | null>(null)
  const [postsTotals, setPostsTotals] = useState<BufferPostsResponse['totals'] | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [postsError, setPostsError] = useState<string | null>(null)

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true)
    try {
      const res = await fetch(apiPath('/api/admin/integrations/buffer/status'))
      if (!res.ok) throw new Error()
      const data = await res.json() as BufferStatusResponse
      setStatus(data)
    } catch {
      setStatus({
        configured: false, connected: false,
        organizationId: null, organizationName: null,
        channels: [], errorMessage: 'Status check failed',
      })
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  const fetchPosts = useCallback(async () => {
    setLoadingPosts(true)
    setPostsError(null)
    try {
      const res = await fetch(apiPath('/api/admin/integrations/buffer/posts?count=10'))
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? 'Posts fetch failed')
      }
      const data = await res.json() as BufferPostsResponse
      setPosts(data.posts)
      setPostsTotals(data.totals)
    } catch (err) {
      setPostsError(err instanceof Error ? err.message : 'Posts fetch failed')
    } finally {
      setLoadingPosts(false)
    }
  }, [])

  useEffect(() => { void fetchStatus() }, [fetchStatus])
  useEffect(() => {
    if (status?.connected) void fetchPosts()
  }, [status?.connected, fetchPosts])

  // Channel id → display label lookup for posts
  const channelLabel = (id: string) => {
    const c = status?.channels.find(ch => ch.id === id)
    if (!c) return id.slice(0, 8)
    return c.displayName ?? c.name ?? c.service
  }
  const channelService = (id: string) => {
    return status?.channels.find(ch => ch.id === id)?.service ?? 'unknown'
  }

  return (
    <section id="buffer">
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Share2 className="w-5 h-5" />
        Buffer (personal social)
      </h2>

      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
        <p className="text-xs text-[var(--color-text-muted)]">
          Pulls Liam&apos;s personal social posts (LinkedIn, Twitter, etc.) from Buffer for the AI to reference when drafting content. This is the personal account, not the Tahi Studio company page. Per-post engagement metrics aren&apos;t exposed by Buffer&apos;s API (they require their Analyze product).
        </p>

        {loadingStatus && <LoadingSkeleton rows={1} />}

        {!loadingStatus && status && !status.configured && (
          <div className="text-sm text-[var(--color-warning)] bg-[var(--color-warning-bg)] border border-[var(--color-warning)] rounded-lg p-3">
            BUFFER_API_KEY is not configured. Get a Personal Access Token from <a href="https://publish.buffer.com/settings/api" target="_blank" rel="noopener noreferrer" className="underline">publish.buffer.com/settings/api</a> and set it as BUFFER_API_KEY in Webflow Cloud env vars.
          </div>
        )}

        {!loadingStatus && status && status.configured && !status.connected && (
          <div className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg)] border border-[var(--color-danger)] rounded-lg p-3">
            {status.errorMessage ?? 'Buffer returned no channels. Check the token has access and you have connected social accounts.'}
          </div>
        )}

        {status?.connected && (
          <>
            <div className="flex items-start gap-3 flex-wrap">
              <Badge tone="positive" variant="soft" size="sm">Connected</Badge>
              <div className="text-sm text-[var(--color-text)]">
                {status.channels.length} channel{status.channels.length === 1 ? '' : 's'}
                {status.organizationName ? ` · ${status.organizationName}` : ''}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {status.channels.map(c => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 px-2.5 py-1 rounded-full"
                  style={{
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                    {c.service}
                  </span>
                  <span className="text-xs text-[var(--color-text)]">
                    {c.displayName ?? c.name ?? c.id.slice(0, 8)}
                  </span>
                  {c.isQueuePaused && (
                    <Badge tone="warning" variant="soft" size="sm">paused</Badge>
                  )}
                </div>
              ))}
            </div>

            {/* Service breakdown (post counts) — Buffer GraphQL doesn't
                expose engagement on this endpoint */}
            {postsTotals && Object.keys(postsTotals.byService).length > 0 && (
              <div
                className="text-xs text-[var(--color-text-muted)] p-3 rounded-lg"
                style={{
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border-subtle)',
                }}
              >
                <div className="font-medium text-[var(--color-text)] mb-1">Last {postsTotals.posts} posts</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {Object.entries(postsTotals.byService).map(([k, v]) => (
                    <span key={k}>
                      <strong>{v}</strong> on {k}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-[var(--color-text)]">Recent posts</h3>
                <TahiButton
                  variant="secondary"
                  size="sm"
                  onClick={() => { void fetchPosts() }}
                  disabled={loadingPosts}
                  iconLeft={loadingPosts ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                >
                  {loadingPosts ? 'Loading...' : 'Refresh'}
                </TahiButton>
              </div>

              {postsError && (
                <div className="text-sm text-[var(--color-danger)] bg-[var(--color-danger-bg)] border border-[var(--color-danger)] rounded-lg p-3 mb-2">
                  {postsError}
                </div>
              )}

              {!postsError && posts && posts.length === 0 && (
                <p className="text-xs text-[var(--color-text-subtle)] italic">No sent posts yet.</p>
              )}

              {!postsError && posts && posts.length > 0 && (
                <ul className="space-y-2">
                  {posts.slice(0, 8).map(post => (
                    <li
                      key={post.id}
                      className="p-3 rounded-lg"
                      style={{
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border-subtle)',
                      }}
                    >
                      <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                        <span className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wide">
                          {channelService(post.channelId)} · {channelLabel(post.channelId)}
                        </span>
                        <span className="text-xs text-[var(--color-text-subtle)]">
                          {post.sentAt
                            ? new Date(post.sentAt).toLocaleDateString()
                            : post.scheduledAt
                              ? `Scheduled ${new Date(post.scheduledAt).toLocaleDateString()}`
                              : ''}
                        </span>
                      </div>
                      <p className="text-sm text-[var(--color-text)] leading-relaxed whitespace-pre-wrap" style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}>
                        {post.text}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}

// -- Cash reserves section --
//
// Surfaces the cash reserve pots that drive disposable-cash math on
// /financial-reports. Each reserve is a "ringfenced" pot — tax, buffer,
// client deposits, etc. — with an optional auto-accrual rate so the
// daily cron can top it up from incoming revenue (e.g. 0.28 = NZ corp
// tax rate).
//
// CRUD wires straight to /api/admin/reserves (+ /[id]). Soft-delete via
// active=false is reserved for the backend cron; this UI uses hard
// DELETE since Liam is unlikely to want stale rows hanging around.

interface ReserveRow {
  id: string
  name: string
  category: 'tax' | 'buffer' | 'deposits' | 'other'
  currency: string
  targetAmount: number | null
  accruedAmount: number
  accrualRate: number | null
  notes: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

const RESERVE_CATEGORIES = [
  { value: 'tax',      label: 'Tax' },
  { value: 'buffer',   label: 'Buffer' },
  { value: 'deposits', label: 'Client deposits' },
  { value: 'other',    label: 'Other' },
] as const

const RESERVE_CURRENCIES = [
  { value: 'NZD', label: 'NZD' },
  { value: 'USD', label: 'USD' },
  { value: 'GBP', label: 'GBP' },
  { value: 'EUR', label: 'EUR' },
  { value: 'AUD', label: 'AUD' },
] as const

const CATEGORY_TONE: Record<ReserveRow['category'], 'positive' | 'warning' | 'info' | 'neutral'> = {
  tax: 'warning',
  buffer: 'positive',
  deposits: 'info',
  other: 'neutral',
}

const CATEGORY_LABEL: Record<ReserveRow['category'], string> = {
  tax: 'Tax',
  buffer: 'Buffer',
  deposits: 'Deposits',
  other: 'Other',
}

function formatReserveAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-NZ', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(0)}`
  }
}

function ReservesSection() {
  const { showToast } = useToast()
  const [reserves, setReserves] = useState<ReserveRow[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<ReserveRow | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ReserveRow | null>(null)

  // Form state — single shared block so create + edit reuse the same fields.
  const [formName, setFormName] = useState('')
  const [formCategory, setFormCategory] = useState<ReserveRow['category']>('tax')
  const [formCurrency, setFormCurrency] = useState('NZD')
  const [formTarget, setFormTarget] = useState('')
  const [formAccrued, setFormAccrued] = useState('0')
  const [formRate, setFormRate] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchReserves = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/reserves'))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { reserves: ReserveRow[] }
      setReserves(data.reserves ?? [])
    } catch {
      setReserves([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchReserves() }, [fetchReserves])

  function resetForm() {
    setFormName('')
    setFormCategory('tax')
    setFormCurrency('NZD')
    setFormTarget('')
    setFormAccrued('0')
    setFormRate('')
    setFormNotes('')
  }

  function openCreate() {
    setEditing(null)
    resetForm()
    setDrawerOpen(true)
  }

  function openEdit(row: ReserveRow) {
    setEditing(row)
    setFormName(row.name)
    setFormCategory(row.category)
    setFormCurrency(row.currency)
    setFormTarget(row.targetAmount != null ? String(row.targetAmount) : '')
    setFormAccrued(String(row.accruedAmount))
    setFormRate(row.accrualRate != null ? String(row.accrualRate) : '')
    setFormNotes(row.notes ?? '')
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setEditing(null)
  }

  async function handleSave() {
    if (!formName.trim()) {
      showToast('Name is required', 'error')
      return
    }
    const targetParsed = formTarget.trim() === '' ? null : Number(formTarget)
    const accruedParsed = formAccrued.trim() === '' ? 0 : Number(formAccrued)
    const rateParsed = formRate.trim() === '' ? null : Number(formRate)

    if (targetParsed != null && (!Number.isFinite(targetParsed) || targetParsed < 0)) {
      showToast('Target amount must be zero or positive', 'error')
      return
    }
    if (!Number.isFinite(accruedParsed) || accruedParsed < 0) {
      showToast('Accrued amount must be zero or positive', 'error')
      return
    }
    if (rateParsed != null && (!Number.isFinite(rateParsed) || rateParsed < 0 || rateParsed > 1)) {
      showToast('Accrual rate must be between 0 and 1 (e.g. 0.28 for 28%)', 'error')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: formName.trim(),
        category: formCategory,
        currency: formCurrency,
        targetAmount: targetParsed,
        accruedAmount: accruedParsed,
        accrualRate: rateParsed,
        notes: formNotes.trim() === '' ? null : formNotes.trim(),
      }
      const url = editing
        ? apiPath(`/api/admin/reserves/${editing.id}`)
        : apiPath('/api/admin/reserves')
      const method = editing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string }
        throw new Error(err.error ?? 'Failed to save reserve')
      }
      showToast(editing ? 'Reserve updated' : 'Reserve created', 'success')
      closeDrawer()
      await fetchReserves()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save reserve', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      const res = await fetch(apiPath(`/api/admin/reserves/${confirmDelete.id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      showToast('Reserve deleted', 'success')
      setConfirmDelete(null)
      await fetchReserves()
    } catch {
      showToast('Failed to delete reserve', 'error')
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <PiggyBank className="w-5 h-5" aria-hidden="true" />
        Cash reserves
      </h2>

      <div
        style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-card)',
          overflow: 'hidden',
        }}
      >
        {/* Header strip with hint + add button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '1rem',
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--color-border-subtle)',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: '12rem' }}>
            <p className="text-sm text-[var(--color-text)]" style={{ margin: 0 }}>
              Ringfence cash for tax, buffers, and client deposits. Reserves are subtracted from disposable cash on Financial reports.
            </p>
            {reserves.length === 0 && !loading && (
              <p
                className="text-xs"
                style={{
                  marginTop: '0.5rem',
                  color: 'var(--color-text-muted)',
                  lineHeight: 1.5,
                }}
              >
                No reserves configured. Tahi recommends at minimum a tax pot (28% accrual rate, NZD).
              </p>
            )}
          </div>
          <TahiButton size="sm" onClick={openCreate} iconLeft={<Plus className="w-3.5 h-3.5" />}>
            Add reserve
          </TahiButton>
        </div>

        {loading ? (
          <div style={{ padding: '1rem 1.25rem' }}>
            <LoadingSkeleton rows={3} />
          </div>
        ) : reserves.length === 0 ? (
          <div
            style={{
              padding: '2rem 1.25rem',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            Add your first reserve to start tracking ringfenced cash.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {reserves.map((row, idx) => {
              const pct = row.targetAmount && row.targetAmount > 0
                ? Math.min(100, Math.round((row.accruedAmount / row.targetAmount) * 100))
                : null
              return (
                <li
                  key={row.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '0.875rem 1.25rem',
                    borderTop: idx === 0 ? 'none' : '1px solid var(--color-border-subtle)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: '12rem' }}>
                    <div className="flex items-center gap-2" style={{ flexWrap: 'wrap' }}>
                      <span className="text-sm font-semibold text-[var(--color-text)]">{row.name}</span>
                      <Badge tone={CATEGORY_TONE[row.category]} variant="soft" size="sm">
                        {CATEGORY_LABEL[row.category]}
                      </Badge>
                      <Badge tone="neutral" variant="soft" size="sm">{row.currency}</Badge>
                    </div>
                    <div
                      className="text-xs text-[var(--color-text-muted)]"
                      style={{ marginTop: '0.25rem', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatReserveAmount(row.accruedAmount, row.currency)}
                      {row.targetAmount != null && row.targetAmount > 0 && (
                        <> / {formatReserveAmount(row.targetAmount, row.currency)}</>
                      )}
                      {row.accrualRate != null && (
                        <> · auto-accruing at {Math.round(row.accrualRate * 100)}%</>
                      )}
                      {row.accrualRate == null && (
                        <> · manual</>
                      )}
                    </div>
                    {pct != null && (
                      <div
                        aria-hidden="true"
                        style={{
                          marginTop: '0.5rem',
                          height: '0.25rem',
                          width: '100%',
                          maxWidth: '14rem',
                          background: 'var(--color-bg-secondary)',
                          borderRadius: '999px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: pct >= 100 ? 'var(--color-brand)' : 'var(--color-brand-light)',
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => openEdit(row)}
                      aria-label={`Edit ${row.name}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '2.25rem',
                        height: '2.25rem',
                        borderRadius: 'var(--radius-md)',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--color-text-muted)',
                        cursor: 'pointer',
                        transition: 'background 150ms ease, color 150ms ease',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'var(--color-bg-secondary)'
                        e.currentTarget.style.color = 'var(--color-brand)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.color = 'var(--color-text-muted)'
                      }}
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(row)}
                      aria-label={`Delete ${row.name}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '2.25rem',
                        height: '2.25rem',
                        borderRadius: 'var(--radius-md)',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--color-text-muted)',
                        cursor: 'pointer',
                        transition: 'background 150ms ease, color 150ms ease',
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.background = 'var(--color-bg-secondary)'
                        e.currentTarget.style.color = 'var(--color-danger)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.color = 'var(--color-text-muted)'
                      }}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <SlideOver
        open={drawerOpen}
        onClose={closeDrawer}
        title={editing ? 'Edit reserve' : 'Add reserve'}
        subtitle={editing ? 'Update this ringfenced pot.' : 'Ringfence cash for tax, buffer, or client deposits.'}
        icon={<PiggyBank size={15} aria-hidden="true" />}
        maxWidth="30rem"
      >
        <SlideOver.Body>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
              <span className="text-xs font-semibold text-[var(--color-text)]">Name</span>
              <Input
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="Corp tax pot"
                autoFocus
              />
            </label>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 'var(--space-3)',
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
                <span className="text-xs font-semibold text-[var(--color-text)]">Category</span>
                <Select
                  value={formCategory}
                  onChange={e => setFormCategory(e.target.value as ReserveRow['category'])}
                  options={RESERVE_CATEGORIES}
                  style={{ width: '100%' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
                <span className="text-xs font-semibold text-[var(--color-text)]">Currency</span>
                <Select
                  value={formCurrency}
                  onChange={e => setFormCurrency(e.target.value)}
                  options={RESERVE_CURRENCIES}
                  style={{ width: '100%' }}
                />
              </label>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 'var(--space-3)',
              }}
            >
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
                <span className="text-xs font-semibold text-[var(--color-text)]">Currently accrued</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={formAccrued}
                  onChange={e => setFormAccrued(e.target.value)}
                  placeholder="0"
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
                <span className="text-xs font-semibold text-[var(--color-text)]">Target (optional)</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={formTarget}
                  onChange={e => setFormTarget(e.target.value)}
                  placeholder="20000"
                />
              </label>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
              <span className="text-xs font-semibold text-[var(--color-text)]">Accrual rate (optional)</span>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                max={1}
                step="0.01"
                value={formRate}
                onChange={e => setFormRate(e.target.value)}
                placeholder="0.28"
              />
              <span className="text-xs text-[var(--color-text-muted)]">
                Decimal between 0 and 1. The daily sync adds (revenue × rate) to the pot. Leave blank for manual.
              </span>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
              <span className="text-xs font-semibold text-[var(--color-text)]">Notes</span>
              <Textarea
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                placeholder="Optional context for future-you."
                rows={3}
              />
            </label>
          </div>
        </SlideOver.Body>
        <SlideOver.Footer>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
            <TahiButton variant="secondary" size="sm" onClick={closeDrawer} disabled={saving}>
              Cancel
            </TahiButton>
            <TahiButton size="sm" onClick={() => void handleSave()} loading={saving}>
              {editing ? 'Save changes' : 'Create reserve'}
            </TahiButton>
          </div>
        </SlideOver.Footer>
      </SlideOver>

      {confirmDelete && (
        <ConfirmDialog
          open={true}
          title="Delete reserve?"
          description={`"${confirmDelete.name}" will be removed permanently. The disposable cash figure on Financial reports will jump up by the accrued amount.`}
          confirmLabel="Delete reserve"
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </section>
  )
}

// ── Content engine signals (Phase I Slice 1) ────────────────────────────
// Surfaces the four signal sources (GA4 / GSC via Google / Matomo /
// SE Ranking) and the ideation cron toggle + weekly target. The cron
// itself lives at /api/admin/cron/ideation; this section configures it.
// Read-only display of the resolved GA4 property + "Auto-detect" button
// that calls discover-ga4 and saves the result in one click.

interface Ga4Property {
  accountId: string
  accountName: string
  propertyId: string
  propertyName: string
  displayName: string
}

function ContentEngineSignalsSection({
  settings,
  onSave,
  savingKey,
}: {
  settings: Record<string, string | null>
  onSave: (key: string, value: string) => Promise<void>
  savingKey: string | null
}) {
  const { showToast } = useToast()
  const [discoveredProps, setDiscoveredProps] = useState<Ga4Property[] | null>(null)
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [showMatomoToken, setShowMatomoToken] = useState(false)
  const [showSeRankingKey, setShowSeRankingKey] = useState(false)

  const ga4PropertyId = settings['content.ga4PropertyId'] ?? ''
  const matomoUrl = settings['content.matomoUrl'] ?? ''
  const matomoToken = settings['content.matomoToken'] ?? ''
  const seRankingKey = settings['content.seRankingApiKey'] ?? ''
  const ideationEnabled = settings['content.ideationEnabled'] === 'true'
  const weeklyTarget = settings['content.weeklyIdeaTarget'] ?? '7'

  async function discoverGa4() {
    setDiscoverLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/integrations/google/discover-ga4'), {
        method: 'POST',
      })
      const data = await res.json() as {
        properties?: Ga4Property[]
        autoPersisted?: boolean
        ga4PropertyId?: string | null
        error?: string
      }
      if (!res.ok) {
        showToast(data.error ?? 'GA4 discovery failed', 'error')
        return
      }
      const props = data.properties ?? []
      if (props.length === 0) {
        showToast('No GA4 properties found on this Google account', 'warning')
        setDiscoveredProps([])
      } else if (data.autoPersisted) {
        showToast(`Saved: ${props[0].displayName}`, 'success')
        setDiscoveredProps(null)
        await onSave('content.ga4PropertyId', props[0].propertyId)
      } else {
        setDiscoveredProps(props)
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'GA4 discovery failed', 'error')
    } finally {
      setDiscoverLoading(false)
    }
  }

  async function pickGa4Property(propertyId: string) {
    await onSave('content.ga4PropertyId', propertyId)
    setDiscoveredProps(null)
  }

  // Single-property display: prefer the friendly displayName if we just
  // discovered, fall back to "Property #<id>" otherwise.
  const ga4Display = ga4PropertyId
    ? (discoveredProps?.find(p => p.propertyId === ga4PropertyId)?.displayName ?? `Property ${ga4PropertyId}`)
    : null

  async function toggleIdeation() {
    await onSave('content.ideationEnabled', ideationEnabled ? 'false' : 'true')
  }

  return (
    <section id="content-engine-signals">
      <h2 className="text-lg font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
        <Lightbulb className="w-5 h-5" aria-hidden="true" />
        Content engine signals
      </h2>

      <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 space-y-5">
        <p className="text-xs text-[var(--color-text-muted)]" style={{ lineHeight: 1.5 }}>
          Wire the signal sources for the weekly content ideation cron (Phase I Slice 1). The cron pulls GA4 + GSC + Matomo + SE Ranking every Monday at 08:00 UK, sends them to Claude Sonnet, and drops 6-8 fresh ideas into <strong>Content studio → Ideas</strong> for triage. Disabled by default — flip the toggle below when you&apos;re ready.
        </p>

        {/* GA4 property — read-only display + Auto-detect button */}
        <div
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '1rem',
          }}
        >
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--color-text)]">GA4 property</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Powers the top-pages + decaying-pages signal. Requires the analytics.readonly scope on your Google connection.
              </p>
            </div>
            <TahiButton
              size="sm"
              variant="secondary"
              loading={discoverLoading}
              onClick={() => { void discoverGa4() }}
              iconLeft={!discoverLoading ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
            >
              {discoverLoading ? 'Detecting...' : 'Auto-detect from Google'}
            </TahiButton>
          </div>

          <div className="mt-3 flex items-center gap-2 flex-wrap">
            {ga4PropertyId ? (
              <>
                <Badge tone="positive" variant="soft" size="sm">Wired</Badge>
                <span className="text-sm text-[var(--color-text)] font-mono">{ga4Display}</span>
              </>
            ) : (
              <Badge tone="warning" variant="soft" size="sm">Not set</Badge>
            )}
          </div>

          {discoveredProps && discoveredProps.length > 1 && (
            <div
              className="mt-3"
              style={{
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem',
              }}
            >
              <p className="text-xs font-semibold text-[var(--color-text)] mb-2">
                Multiple GA4 properties found. Pick the one for tahi.studio:
              </p>
              <div className="space-y-1.5">
                {discoveredProps.map(p => (
                  <button
                    key={p.propertyId}
                    type="button"
                    onClick={() => { void pickGa4Property(p.propertyId) }}
                    className="w-full text-left flex items-center justify-between gap-2 px-3 py-2 rounded transition-colors"
                    style={{
                      background: p.propertyId === ga4PropertyId ? 'var(--color-brand-50)' : 'transparent',
                      border: `1px solid ${p.propertyId === ga4PropertyId ? 'var(--color-brand)' : 'var(--color-border-subtle)'}`,
                      cursor: 'pointer',
                      fontSize: '0.8125rem',
                      color: 'var(--color-text)',
                    }}
                    onMouseEnter={e => {
                      if (p.propertyId !== ga4PropertyId) {
                        e.currentTarget.style.background = 'var(--color-bg-secondary)'
                      }
                    }}
                    onMouseLeave={e => {
                      if (p.propertyId !== ga4PropertyId) {
                        e.currentTarget.style.background = 'transparent'
                      }
                    }}
                  >
                    <span className="truncate">{p.displayName}</span>
                    <span className="text-xs text-[var(--color-text-subtle)] font-mono">{p.propertyId}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Matomo URL + token */}
        <div
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '1rem',
          }}
        >
          <p className="text-sm font-semibold text-[var(--color-text)]">Matomo</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            Optional — second analytics source used as a sanity check vs GA4.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
              <span className="text-xs font-semibold text-[var(--color-text)]">Matomo URL</span>
              <Input
                type="url"
                value={matomoUrl}
                onChange={e => { void onSave('content.matomoUrl', e.target.value) }}
                placeholder="https://analytics.tahi.studio"
                disabled={savingKey === 'content.matomoUrl'}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
              <span className="text-xs font-semibold text-[var(--color-text)]">Auth token</span>
              <Input
                type={showMatomoToken ? 'text' : 'password'}
                value={matomoToken}
                onChange={e => { void onSave('content.matomoToken', e.target.value) }}
                placeholder="token_auth value"
                disabled={savingKey === 'content.matomoToken'}
                trailingIcon={
                  <button
                    type="button"
                    onClick={() => setShowMatomoToken(v => !v)}
                    aria-label={showMatomoToken ? 'Hide token' : 'Show token'}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--color-text-subtle)',
                      display: 'flex',
                    }}
                  >
                    {showMatomoToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                }
              />
            </label>
          </div>
        </div>

        {/* SE Ranking API key */}
        <div
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '1rem',
          }}
        >
          <p className="text-sm font-semibold text-[var(--color-text)]">SE Ranking</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 mb-3">
            Optional — competitor keyword gaps. Persisted now, signal wired in Slice 7.
          </p>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)', maxWidth: '32rem' }}>
            <span className="text-xs font-semibold text-[var(--color-text)]">API key</span>
            <Input
              type={showSeRankingKey ? 'text' : 'password'}
              value={seRankingKey}
              onChange={e => { void onSave('content.seRankingApiKey', e.target.value) }}
              placeholder="SE Ranking API key"
              disabled={savingKey === 'content.seRankingApiKey'}
              trailingIcon={
                <button
                  type="button"
                  onClick={() => setShowSeRankingKey(v => !v)}
                  aria-label={showSeRankingKey ? 'Hide key' : 'Show key'}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-subtle)',
                    display: 'flex',
                  }}
                >
                  {showSeRankingKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
            />
          </label>
        </div>

        {/* Cron enable + weekly target */}
        <div
          style={{
            background: 'var(--color-bg-secondary)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-lg)',
            padding: '1rem',
          }}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--color-text)]">Weekly ideation cron</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                Runs Mondays 08:00 UK. Manual &quot;Run now&quot; in Content studio works regardless of this toggle.
              </p>
            </div>
            <button
              type="button"
              onClick={() => { void toggleIdeation() }}
              role="switch"
              aria-checked={ideationEnabled}
              aria-label="Toggle ideation cron"
              disabled={savingKey === 'content.ideationEnabled'}
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] flex-shrink-0"
              style={{
                background: ideationEnabled ? 'var(--color-brand)' : 'var(--color-border)',
                cursor: 'pointer',
                border: 'none',
              }}
            >
              <span
                className="inline-block h-4 w-4 rounded-full bg-white transition-transform"
                style={{
                  transform: ideationEnabled ? 'translateX(1.375rem)' : 'translateX(0.25rem)',
                }}
              />
            </button>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)', maxWidth: '12rem' }}>
            <span className="text-xs font-semibold text-[var(--color-text)]">Weekly idea target</span>
            <Input
              type="number"
              min={3}
              max={12}
              value={weeklyTarget}
              onChange={e => { void onSave('content.weeklyIdeaTarget', e.target.value) }}
              placeholder="7"
              disabled={savingKey === 'content.weeklyIdeaTarget'}
            />
          </label>
        </div>
      </div>
    </section>
  )
}
