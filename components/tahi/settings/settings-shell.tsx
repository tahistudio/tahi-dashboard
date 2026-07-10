'use client'

import { useEffect, useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { usePermissions } from '@/components/tahi/permissions-context'
import { useResource } from '@/lib/use-resource'
import {
  User, SunMoon, Bell, CalendarClock, Paintbrush, LayoutGrid, Megaphone,
  Building2, FileText, Columns3, ClipboardList, Target, GitBranch, Sparkles,
  Plug, Webhook, Workflow, Clock, Bot, Users, CreditCard, Coins, PiggyBank,
  ScrollText, AlertTriangle, Palette, ChevronDown, Wallet, Shield,
} from 'lucide-react'
import '@/app/(dashboard)/settings/settings.css'

import { ProfileSection } from '@/components/tahi/settings/sections/profile'
import { AppearanceSection } from '@/components/tahi/settings/sections/appearance'
import { NotificationsSection } from '@/components/tahi/settings/sections/notifications'
import { BookingSection } from '@/components/tahi/settings/sections/booking'
import { BrandingSection } from '@/components/tahi/settings/sections/branding'
import { ModulesSection } from '@/components/tahi/settings/sections/modules'
import { AnnouncementsSection } from '@/components/tahi/settings/sections/announcements'
import { StudioDetailsSection } from '@/components/tahi/settings/sections/studio-details'
import { RequestFormsSection } from '@/components/tahi/settings/sections/request-forms'
import { KanbanColumnsSection } from '@/components/tahi/settings/sections/kanban'
import { TaskTemplatesSection } from '@/components/tahi/settings/sections/task-templates'
import { PipelineDefaultsSection } from '@/components/tahi/settings/sections/pipeline-defaults'
import { PipelineStagesSection } from '@/components/tahi/settings/sections/pipeline-stages'
import { LeadAutomationsSection } from '@/components/tahi/settings/sections/lead-automations'
import { IntegrationsSection } from '@/components/tahi/settings/sections/integrations'
import { WebhooksSection } from '@/components/tahi/settings/sections/webhooks'
import { AutomationsSection } from '@/components/tahi/settings/sections/automations'
import { ScheduledJobsSection } from '@/components/tahi/settings/sections/scheduled-jobs'
import { AiContextSection } from '@/components/tahi/settings/sections/ai-context'
import { TeamAccessSection } from '@/components/tahi/settings/sections/team-access'
import { PlansRetainersSection } from '@/components/tahi/settings/sections/plans-retainers'
import { ReservesSection } from '@/components/tahi/settings/sections/reserves'
import { AuditLogSection } from '@/components/tahi/settings/sections/audit-log'
import { DangerZoneSection } from '@/components/tahi/settings/sections/danger-zone'
import { BrandsSection } from '@/components/tahi/settings/sections/brands'
import { OrgSettingsSection } from '@/components/tahi/settings/sections/org'
import { PeopleSection } from '@/components/tahi/settings/sections/people'
import { PlanBillingSection } from '@/components/tahi/settings/sections/plan'
import { SubscriptionSection } from '@/components/tahi/settings/sections/subscription'

type Audience = 'both' | 'admin' | 'client'

type SectionComponent = React.ComponentType<{ isAdmin?: boolean; isClientAdmin?: boolean }>

interface SectionDef {
  id: string
  label: string
  icon: LucideIcon
  group: string
  audience: Audience
  Component: SectionComponent
  // Admin-only sections that hold sensitive workspace controls. Hidden from the
  // sub-nav for admins who are not super-admins. This is the cosmetic layer that
  // complements the server-side feature gate (the real enforcement).
  superAdminOnly?: boolean
  // Client sections that only a workspace admin (contacts.portalRole === 'admin',
  // or the primary contact) may reach. Hidden from client members in the sub-nav.
  clientAdminOnly?: boolean
}

// Registry order is intentional: it drives the order items appear inside their
// group, so keep entries listed under the group they belong to.
const SECTIONS: SectionDef[] = [
  { id: 'profile', label: 'Profile', icon: User, group: 'Account', audience: 'both', Component: ProfileSection },
  { id: 'appearance', label: 'Appearance', icon: SunMoon, group: 'Account', audience: 'both', Component: AppearanceSection },
  { id: 'notifications', label: 'Notifications', icon: Bell, group: 'Account', audience: 'both', Component: NotificationsSection },
  { id: 'booking', label: 'Booking link', icon: CalendarClock, group: 'Account', audience: 'admin', Component: BookingSection },

  { id: 'branding', label: 'Branding', icon: Paintbrush, group: 'Workspace', audience: 'admin', Component: BrandingSection },
  { id: 'modules', label: 'Modules', icon: LayoutGrid, group: 'Workspace', audience: 'admin', superAdminOnly: true, Component: ModulesSection },
  { id: 'announce', label: 'Announcements', icon: Megaphone, group: 'Workspace', audience: 'admin', Component: AnnouncementsSection },
  { id: 'studio', label: 'Studio details', icon: Building2, group: 'Workspace', audience: 'admin', superAdminOnly: true, Component: StudioDetailsSection },

  { id: 'forms', label: 'Request forms', icon: FileText, group: 'Intake & boards', audience: 'admin', Component: RequestFormsSection },
  { id: 'kanban', label: 'Kanban columns', icon: Columns3, group: 'Intake & boards', audience: 'admin', Component: KanbanColumnsSection },
  { id: 'tasktpl', label: 'Task templates', icon: ClipboardList, group: 'Intake & boards', audience: 'admin', Component: TaskTemplatesSection },

  { id: 'pipedef', label: 'Pipeline defaults', icon: Target, group: 'Sales & pipeline', audience: 'admin', Component: PipelineDefaultsSection },
  { id: 'stages', label: 'Pipeline stages', icon: GitBranch, group: 'Sales & pipeline', audience: 'admin', Component: PipelineStagesSection },
  { id: 'leadauto', label: 'Lead automations', icon: Sparkles, group: 'Sales & pipeline', audience: 'admin', Component: LeadAutomationsSection },

  { id: 'integrations', label: 'Integrations', icon: Plug, group: 'Automations & integrations', audience: 'admin', superAdminOnly: true, Component: IntegrationsSection },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook, group: 'Automations & integrations', audience: 'admin', superAdminOnly: true, Component: WebhooksSection },
  { id: 'automations', label: 'Automations', icon: Workflow, group: 'Automations & integrations', audience: 'admin', Component: AutomationsSection },
  { id: 'crons', label: 'Scheduled jobs', icon: Clock, group: 'Automations & integrations', audience: 'admin', superAdminOnly: true, Component: ScheduledJobsSection },
  { id: 'aicontext', label: 'AI context', icon: Bot, group: 'Automations & integrations', audience: 'admin', Component: AiContextSection },

  { id: 'teamaccess', label: 'Team & access', icon: Shield, group: 'Team & access', audience: 'admin', superAdminOnly: true, Component: TeamAccessSection },

  { id: 'subscription', label: 'Subscription', icon: CreditCard, group: 'Billing', audience: 'admin', superAdminOnly: true, Component: SubscriptionSection },
  { id: 'plans', label: 'Client plans', icon: Coins, group: 'Billing', audience: 'admin', superAdminOnly: true, Component: PlansRetainersSection },
  { id: 'reserves', label: 'Reserves', icon: PiggyBank, group: 'Billing', audience: 'admin', superAdminOnly: true, Component: ReservesSection },

  { id: 'audit', label: 'Audit log', icon: ScrollText, group: 'Advanced', audience: 'admin', Component: AuditLogSection },
  { id: 'danger', label: 'Danger zone', icon: AlertTriangle, group: 'Advanced', audience: 'admin', superAdminOnly: true, Component: DangerZoneSection },

  // Client portal sections (Organization + Plan & billing groups).
  { id: 'org', label: 'Organization', icon: Building2, group: 'Organization', audience: 'client', Component: OrgSettingsSection },
  { id: 'people', label: 'People', icon: Users, group: 'Organization', audience: 'client', clientAdminOnly: true, Component: PeopleSection },
  { id: 'brands', label: 'Brand', icon: Palette, group: 'Organization', audience: 'client', Component: BrandsSection },
  { id: 'plan', label: 'Plan & billing', icon: Wallet, group: 'Plan & billing', audience: 'client', Component: PlanBillingSection },
]

// Group display order per audience.
const ADMIN_GROUPS = [
  'Account', 'Workspace', 'Intake & boards', 'Sales & pipeline',
  'Automations & integrations', 'Team & access', 'Billing', 'Advanced',
]
const CLIENT_GROUPS = ['Account', 'Organization', 'Plan & billing']

interface Visibility {
  isAdmin: boolean
  isSuperAdmin: boolean
  isClientAdmin: boolean
  /** Resolved FEATURE_TREE map from PermissionsProvider (server-computed). */
  features: Record<string, boolean>
}

// Sections gated by a granular feature key on top of the audience rules, so a
// scoped teammate type (project manager, task handler, viewer) only sees the
// settings surfaces their role or overrides grant. Cosmetic layer - the API
// routes behind each section enforce the same keys server-side.
const SECTION_FEATURE_KEYS: Readonly<Record<string, string>> = {
  integrations: 'settings.integrations',
  teamaccess: 'settings.permissions',
}

function isVisible(section: SectionDef, v: Visibility): boolean {
  if (section.audience === 'both') return true
  if (v.isAdmin) {
    if (section.audience !== 'admin') return false
    // Sensitive admin surfaces are super-admin only in the sub-nav.
    if (section.superAdminOnly && !v.isSuperAdmin) return false
    // Granular feature gate (fail-open when the map has no entry).
    const featureKey = SECTION_FEATURE_KEYS[section.id]
    if (featureKey && v.features[featureKey] === false) return false
    return true
  }
  // Client portal.
  if (section.audience !== 'client') return false
  // People (and any future admin-only client surface) is hidden from members.
  if (section.clientAdminOnly && !v.isClientAdmin) return false
  return true
}

interface PortalProfileResponse {
  contact: {
    isPrimary?: boolean | number | null
    portalRole?: string | null
  } | null
}

export function SettingsShell({ isAdmin }: { isAdmin: boolean }) {
  const groupOrder = isAdmin ? ADMIN_GROUPS : CLIENT_GROUPS

  // Super-admin flag + resolved feature map drive the admin sub-nav gates.
  // Resolved server-side in the dashboard layout and surfaced through
  // PermissionsProvider (no flash).
  const { isSuperAdmin, features } = usePermissions()

  // Client-admin flag drives the client sub-nav gate (#6). The signal is
  // contacts.portalRole === 'admin'; until the portal profile endpoint exposes
  // it, we fall back to the primary-contact flag (the foundation backfilled
  // portalRole = 'admin' where is_primary = 1, so they agree for current data).
  // TODO: once GET /api/portal/profile returns portalRole, drop the isPrimary
  // fallback below.
  const { data: profile } = useResource<PortalProfileResponse>(
    isAdmin ? null : '/api/portal/profile',
  )
  const isClientAdmin = useMemo(() => {
    if (isAdmin) return false
    const c = profile?.contact
    if (!c) return false
    if (typeof c.portalRole === 'string') return c.portalRole === 'admin'
    return !!c.isPrimary
  }, [isAdmin, profile])

  const visibility = useMemo<Visibility>(
    () => ({ isAdmin, isSuperAdmin, isClientAdmin, features: features ?? {} }),
    [isAdmin, isSuperAdmin, isClientAdmin, features],
  )

  // Sections this audience may see, kept in registry order.
  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => isVisible(s, visibility)),
    [visibility],
  )

  // Group them for the sub-nav, preserving the group display order and the
  // registry order within each group.
  const groups = useMemo(
    () =>
      groupOrder
        .map((label) => ({
          label,
          items: visibleSections.filter((s) => s.group === label),
        }))
        .filter((g) => g.items.length > 0),
    [groupOrder, visibleSections],
  )

  const [activeId, setActiveId] = useState<string>(
    () => visibleSections[0]?.id ?? 'profile',
  )

  // Deep-linking: /settings?section=<id> selects that section on load (only if
  // the caller may see it), and switching sections keeps the URL in sync via
  // replaceState so links, refreshes, and integration callbacks land on the
  // right pane. Applied post-mount to avoid a server/client hydration mismatch.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('section')
    if (wanted && visibleSections.some((s) => s.id === wanted)) {
      setActiveId(wanted)
    }
    // Run once on mount; visibility changes after load should not yank the
    // user away from the section they are on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectSection = (id: string) => {
    setActiveId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('section', id)
    window.history.replaceState(null, '', url.toString())
  }

  // Scroll the content region back to the top on every section switch, so you
  // never land mid-scroll on the previous panel. #main-content is the scroll
  // container (the dashboard layout's <main overflow-y-auto>).
  useEffect(() => {
    document.getElementById('main-content')?.scrollTo({ top: 0 })
  }, [activeId])

  const active =
    visibleSections.find((s) => s.id === activeId) ?? visibleSections[0]
  const ActiveComponent = active?.Component
  const ActiveIcon = active?.icon

  return (
    <div className="set-frame">
      {/* Desktop sub-nav */}
      <nav className="set-nav hidden md:flex" aria-label="Settings sections">
        {groups.map((group) => (
          <div key={group.label} className="set-navgroup">
            <div className="set-navlabel">{group.label}</div>
            {group.items.map((section) => {
              const Icon = section.icon
              const on = section.id === active?.id
              return (
                <button
                  key={section.id}
                  type="button"
                  className={on ? 'set-navitem on' : 'set-navitem'}
                  aria-current={on ? 'page' : undefined}
                  onClick={() => selectSection(section.id)}
                >
                  <span className="sn-ic">
                    <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                  </span>
                  {section.label}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="set-content">
        {/* Mobile section picker */}
        <div className="set-mobilepick md:hidden">
          <label className="led" htmlFor="secpick">
            Settings section
          </label>
          <div className="set-mselect">
            <span className="sn-ic">
              {ActiveIcon ? (
                <ActiveIcon size={18} strokeWidth={1.9} aria-hidden="true" />
              ) : null}
            </span>
            <span className="ms-label">{active?.label ?? 'Settings'}</span>
            <span className="chev">
              <ChevronDown size={16} aria-hidden="true" />
            </span>
            <select
              id="secpick"
              value={active?.id ?? ''}
              onChange={(e) => selectSection(e.target.value)}
              aria-label="Select settings section"
            >
              {groups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.items.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        {/* Active section, re-keyed so it re-animates on switch */}
        <div className="set-anim" key={active?.id}>
          {ActiveComponent ? (
            <ActiveComponent isAdmin={isAdmin} isClientAdmin={isClientAdmin} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
