'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw, Sun, Moon,
  CreditCard, Link2, Bell, Building2,
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
  const [integrations] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [darkMode, setDarkMode] = useState(false)
  const [savingKey, setSavingKey] = useState<string | null>(null)

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
      const [settingsRes, integrationsRes] = await Promise.all([
        fetch(apiPath('/api/admin/settings')),
        fetch(apiPath('/api/admin/settings')).then(() => null), // integrations live in settings too
      ])

      if (settingsRes.ok) {
        const data = await settingsRes.json() as { settings: Record<string, string | null> }
        setSettings(data.settings ?? {})
        // Load notification prefs from settings
        setEmailNotifications(data.settings?.['notifications.email'] !== 'false')
        setSlackNotifications(data.settings?.['notifications.slack'] === 'true')
      }

      // Load integration statuses (stored as settings keys)
      // integration.stripe.status, etc.
      void integrationsRes
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
    return integrations[key] ?? settings[`integration.${key}.status`] ?? 'disconnected'
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
                          className="w-10 h-10 flex items-center justify-center rounded-lg flex-shrink-0"
                          style={{
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
                                background: isConnected ? '#f0fdf4' : 'var(--color-bg-tertiary)',
                                color: isConnected ? '#16a34a' : 'var(--color-text-muted)',
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
