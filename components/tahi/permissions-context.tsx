'use client'

/**
 * PermissionsProvider + <Gate> — client-side surface of granular permissions.
 *
 * The dashboard layout resolves the caller's capabilities server-side (no flash)
 * and passes them here. <Gate feature="..."> hides a card / tab / button when the
 * feature is off; the sidebar reads `features` to filter nav. usePermissions()
 * exposes level + flags for conditional UI (e.g. the permissions builder link).
 */

import { createContext, useContext } from 'react'

export type AccessLevel = 'super_admin' | 'admin' | 'team_member' | 'client'

export interface PermissionsValue {
  level: AccessLevel
  isAdmin: boolean
  isSuperAdmin: boolean
  canManagePermissions: boolean
  /** featureKey -> visible. Missing key defaults to visible (fail-open on the
   *  client; server routes are the real gate). */
  features: Record<string, boolean>
}

const DEFAULT: PermissionsValue = {
  level: 'admin', isAdmin: true, isSuperAdmin: false, canManagePermissions: true, features: {},
}

const PermissionsContext = createContext<PermissionsValue>(DEFAULT)

export function PermissionsProvider({ value, children }: { value: PermissionsValue; children: React.ReactNode }) {
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>
}

export function usePermissions(): PermissionsValue {
  return useContext(PermissionsContext)
}

/** True unless the feature is explicitly off. Unknown keys are visible. */
export function useFeature(featureKey: string): boolean {
  const { features } = useContext(PermissionsContext)
  return features[featureKey] !== false
}

/** Hide children when `feature` is off. Optional `fallback` renders instead. */
export function Gate({ feature, children, fallback = null }: {
  feature: string
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const visible = useFeature(feature)
  return <>{visible ? children : fallback}</>
}
