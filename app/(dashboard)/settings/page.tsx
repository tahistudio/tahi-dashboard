import { auth } from '@clerk/nextjs/server'
import { Settings } from 'lucide-react'
export const metadata = { title: 'Settings' }
export default async function SettingsPage() {
  const { orgId } = await auth()
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Settings</h1>
        <p className="text-sm text-[var(--color-text-muted)] mt-1">
          {isAdmin ? 'Configure the dashboard, integrations, and notifications.' : 'Manage your profile and notification preferences.'}
        </p>
      </div>
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 brand-gradient flex items-center justify-center mb-4" style={{ borderRadius: 'var(--radius-leaf)' }}>
          <Settings className="w-8 h-8 text-white" />
        </div>
        <h3 className="text-base font-semibold text-[var(--color-text)] mb-2">Settings coming in Phase 7</h3>
        <p className="text-sm text-[var(--color-text-muted)] max-w-sm">
          {isAdmin ? 'Stripe, Xero, MailerLite, Slack, and all integration settings will live here.' : 'Profile, notifications, and display preferences will live here.'}
        </p>
      </div>
    </div>
  )
}
