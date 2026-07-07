'use client'

import { useMemo, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  User, SunMoon, Bell, CalendarClock, Paintbrush, LayoutGrid, Megaphone,
  Building2, FileText, Columns3, ClipboardList, Target, GitBranch, Sparkles,
  Plug, Webhook, Workflow, Clock, Bot, Users, CreditCard, PiggyBank,
  ScrollText, AlertTriangle, Palette, ChevronDown, Wallet,
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

type Audience = 'both' | 'admin' | 'client'

type SectionComponent = React.ComponentType<{ isAdmin?: boolean }>

interface SectionDef {
  id: string
  label: string
  icon: LucideIcon
  group: string
  audience: Audience
  Component: SectionComponent
}

// Registry order is intentional: it drives the order items appear inside their
// group, so keep entries listed under the group they belong to.
const SECTIONS: SectionDef[] = [
  { id: 'profile', label: 'Profile', icon: User, group: 'Account', audience: 'both', Component: ProfileSection },
  { id: 'appearance', label: 'Appearance', icon: SunMoon, group: 'Account', audience: 'both', Component: AppearanceSection },
  { id: 'notifications', label: 'Notifications', icon: Bell, group: 'Account', audience: 'both', Component: NotificationsSection },
  { id: 'booking', label: 'Booking', icon: CalendarClock, group: 'Account', audience: 'admin', Component: BookingSection },

  { id: 'branding', label: 'Branding', icon: Paintbrush, group: 'Workspace', audience: 'admin', Component: BrandingSection },
  { id: 'modules', label: 'Modules', icon: LayoutGrid, group: 'Workspace', audience: 'admin', Component: ModulesSection },
  { id: 'announce', label: 'Announcements', icon: Megaphone, group: 'Workspace', audience: 'admin', Component: AnnouncementsSection },
  { id: 'studio', label: 'Studio details', icon: Building2, group: 'Workspace', audience: 'admin', Component: StudioDetailsSection },

  { id: 'forms', label: 'Request forms', icon: FileText, group: 'Intake & boards', audience: 'admin', Component: RequestFormsSection },
  { id: 'kanban', label: 'Kanban columns', icon: Columns3, group: 'Intake & boards', audience: 'admin', Component: KanbanColumnsSection },
  { id: 'tasktpl', label: 'Task templates', icon: ClipboardList, group: 'Intake & boards', audience: 'admin', Component: TaskTemplatesSection },

  { id: 'pipedef', label: 'Pipeline defaults', icon: Target, group: 'Sales & pipeline', audience: 'admin', Component: PipelineDefaultsSection },
  { id: 'stages', label: 'Pipeline stages', icon: GitBranch, group: 'Sales & pipeline', audience: 'admin', Component: PipelineStagesSection },
  { id: 'leadauto', label: 'Lead automations', icon: Sparkles, group: 'Sales & pipeline', audience: 'admin', Component: LeadAutomationsSection },

  { id: 'integrations', label: 'Integrations', icon: Plug, group: 'Automations & integrations', audience: 'admin', Component: IntegrationsSection },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook, group: 'Automations & integrations', audience: 'admin', Component: WebhooksSection },
  { id: 'automations', label: 'Automations', icon: Workflow, group: 'Automations & integrations', audience: 'admin', Component: AutomationsSection },
  { id: 'crons', label: 'Scheduled jobs', icon: Clock, group: 'Automations & integrations', audience: 'admin', Component: ScheduledJobsSection },
  { id: 'aicontext', label: 'AI context', icon: Bot, group: 'Automations & integrations', audience: 'admin', Component: AiContextSection },

  { id: 'teamaccess', label: 'Team & access', icon: Users, group: 'Team & access', audience: 'admin', Component: TeamAccessSection },

  { id: 'plans', label: 'Client plans', icon: CreditCard, group: 'Billing', audience: 'admin', Component: PlansRetainersSection },
  { id: 'reserves', label: 'Reserves', icon: PiggyBank, group: 'Billing', audience: 'admin', Component: ReservesSection },

  { id: 'audit', label: 'Audit log', icon: ScrollText, group: 'Advanced', audience: 'admin', Component: AuditLogSection },
  { id: 'danger', label: 'Danger zone', icon: AlertTriangle, group: 'Advanced', audience: 'admin', Component: DangerZoneSection },

  // Client portal sections (Organization + Plan & billing groups).
  { id: 'org', label: 'Organization', icon: Building2, group: 'Organization', audience: 'client', Component: OrgSettingsSection },
  { id: 'people', label: 'People', icon: Users, group: 'Organization', audience: 'client', Component: PeopleSection },
  { id: 'brands', label: 'Brand', icon: Palette, group: 'Organization', audience: 'client', Component: BrandsSection },
  { id: 'plan', label: 'Plan & billing', icon: Wallet, group: 'Plan & billing', audience: 'client', Component: PlanBillingSection },
]

// Group display order per audience.
const ADMIN_GROUPS = [
  'Account', 'Workspace', 'Intake & boards', 'Sales & pipeline',
  'Automations & integrations', 'Team & access', 'Billing', 'Advanced',
]
const CLIENT_GROUPS = ['Account', 'Organization', 'Plan & billing']

function isVisible(section: SectionDef, isAdmin: boolean): boolean {
  if (section.audience === 'both') return true
  return isAdmin ? section.audience === 'admin' : section.audience === 'client'
}

export function SettingsShell({ isAdmin }: { isAdmin: boolean }) {
  const groupOrder = isAdmin ? ADMIN_GROUPS : CLIENT_GROUPS

  // Sections this audience may see, kept in registry order.
  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => isVisible(s, isAdmin)),
    [isAdmin],
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

  const active =
    visibleSections.find((s) => s.id === activeId) ?? visibleSections[0]
  const ActiveComponent = active?.Component
  const ActiveIcon = active?.icon

  return (
    <div className="set-frame">
      {/* Desktop sub-nav */}
      <aside className="set-nav hidden md:flex" aria-label="Settings sections">
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
                  onClick={() => setActiveId(section.id)}
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
      </aside>

      <div className="set-content">
        {/* Mobile section picker */}
        <div className="set-mobilepick md:hidden">
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
              value={active?.id ?? ''}
              onChange={(e) => setActiveId(e.target.value)}
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
          {ActiveComponent ? <ActiveComponent isAdmin={isAdmin} /> : null}
        </div>
      </div>
    </div>
  )
}
