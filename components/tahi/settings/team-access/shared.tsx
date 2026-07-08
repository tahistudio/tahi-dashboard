'use client'

/**
 * Shared bits for the Team & access pane: role labels/tones, the subject
 * avatar, audit-entry humanising, and the API row types the pane consumes.
 * The interactive controls (Tri, SlideSeg, TaSelect, Toasts, SlideOverShell)
 * live in settings/primitives.tsx - one source of truth for the design kit.
 */

import { getFeatureNode } from '@/lib/feature-tree'

// ── API row types ─────────────────────────────────────────────────────────────

export interface MemberRole {
  roleId: string
  roleName: string
}

export interface MemberScope {
  scopeType: string // all_clients | plan_type | specific_clients
  planType: string | null
  trackType: string
  orgIds: string[]
}

export interface SubjectMember {
  id: string
  name: string
  email: string
  roles: MemberRole[]
  scope: MemberScope | null
}

export interface SubjectOrg {
  id: string
  name: string
  planType: string | null
}

export interface RoleSummary {
  id: string
  name: string
  description: string | null
  isSystem: boolean | number
}

export interface SubjectsResponse {
  teamMembers: SubjectMember[]
  orgs: SubjectOrg[]
  roles: RoleSummary[]
}

export type Effect = 'allow' | 'deny'
export type ThreeWay = 'inherit' | Effect

export interface Override {
  id: string
  featureKey: string
  effect: Effect
  reason: string | null
  updatedAt: string
}

export interface AuditItem {
  id: string
  actorId: string | null
  action: string
  entityType: string | null
  entityId: string | null
  metadata: string | null
  createdAt: string
  actorName?: string | null
  entityName?: string | null
}

// ── Role labels + tones ───────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  project_manager: 'Project manager',
  task_handler: 'Task handler',
  viewer: 'Viewer',
}

export function humaniseRole(name: string): string {
  if (ROLE_LABELS[name]) return ROLE_LABELS[name]
  const spaced = name.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Chip tone class for a role name (the design's purple/brand/info/teal ramp). */
export function roleTone(name: string): string {
  switch (name) {
    case 'super_admin': return 'purple'
    case 'admin': return 'brand'
    case 'project_manager': return 'info'
    case 'task_handler': return 'teal'
    case 'viewer': return 'neutral'
    default: return 'neutral'
  }
}

/** Roles the data-scope rules understand; admin-level roles always see all. */
export const SCOPED_ROLES = new Set(['project_manager', 'task_handler', 'viewer'])

export function RoleChip({ roleName }: { roleName: string | null }) {
  if (!roleName) return <span className="chip outline">No role</span>
  return <span className={'chip ' + roleTone(roleName)}>{humaniseRole(roleName)}</span>
}

// ── Subject avatar (initials) ─────────────────────────────────────────────────

export function initialsOf(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  )
}

export function SubjAvatar({ name, size }: { name: string; size?: number }) {
  return (
    <span
      className="subj-av"
      style={size ? { width: size, height: size, fontSize: Math.round(size * 0.36) } : undefined}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  )
}

// ── Audit humanising ──────────────────────────────────────────────────────────

interface AuditMeta {
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  featureKey?: string
  sourceName?: string
  [key: string]: unknown
}

function parseMeta(raw: string | null): AuditMeta {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as AuditMeta
  } catch {
    return {}
  }
}

function featureLabel(key: unknown): string {
  if (typeof key !== 'string') return 'a feature'
  return getFeatureNode(key)?.label ?? key
}

const SCOPE_LABELS: Record<string, string> = {
  all_clients: 'All clients',
  plan_type: 'By plan',
  specific_clients: 'Specific clients',
}

/** One human sentence for a permission.* audit entry, e.g. "Denied Financial reports". */
export function humaniseAudit(item: AuditItem): string {
  const meta = parseMeta(item.metadata)
  const after = (meta.after ?? {}) as Record<string, unknown>
  switch (item.action) {
    case 'permission.role_assigned':
      return 'Set role to ' + humaniseRole(String(after.roleName ?? 'unknown'))
    case 'permission.role_cleared':
      return 'Cleared role'
    case 'permission.feature_override_set': {
      const effect = after.effect === 'deny' ? 'Denied' : 'Allowed'
      return effect + ' ' + featureLabel(meta.featureKey)
    }
    case 'permission.feature_override_cleared':
      return 'Reset ' + featureLabel(meta.featureKey) + ' to default'
    case 'permission.scope_changed': {
      const scopeType = String(after.scopeType ?? '')
      const label = SCOPE_LABELS[scopeType] ?? scopeType
      const orgIds = Array.isArray(after.orgIds) ? (after.orgIds as unknown[]) : []
      const count = scopeType === 'specific_clients' ? ' (' + orgIds.length + ')' : ''
      return 'Scope set to ' + label + count
    }
    case 'permission.access_copied':
      return 'Copied access from ' + String(meta.sourceName ?? 'another subject')
    default:
      return item.action.replace('permission.', '').replace(/_/g, ' ')
  }
}

/** The reason attached to a permission change, if any. */
export function auditReason(item: AuditItem): string {
  const meta = parseMeta(item.metadata)
  const after = (meta.after ?? {}) as Record<string, unknown>
  const reason = after.reason
  return typeof reason === 'string' && reason.trim() ? reason : '-'
}

export function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
  const time = d
    .toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })
    .toLowerCase()
    .replace(' ', ' ')
  return date + ', ' + time
}

export function humanisePlan(planType: string | null | undefined): string {
  if (!planType || planType === 'none') return 'No plan'
  return planType.charAt(0).toUpperCase() + planType.slice(1)
}

/** SWR key for a subject's permission change-history teaser. Shared by the
 *  detail card (reader) and the pane (revalidates it after each change). */
export function permissionTeaserKey(subjectType: 'team_member' | 'organisation', subjectId: string): string {
  return (
    '/api/admin/audit?actionPrefix=permission.&entityType=' +
    encodeURIComponent(subjectType) +
    '&entityId=' +
    encodeURIComponent(subjectId) +
    '&resolveNames=1'
  )
}
