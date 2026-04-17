/**
 * <SidebarCard> + <SidebarSection> — the "one outer card, many labelled
 * sections with horizontal dividers" pattern used on Deal / Request / Task
 * detail sidebars.
 *
 *   <SidebarCard>
 *     <SidebarSection label="CLIENT">
 *       <Link href="/clients/abc">Acme Corp</Link>
 *     </SidebarSection>
 *     <SidebarSection label="OWNER">
 *       Liam
 *     </SidebarSection>
 *     <SidebarSection label="EXPECTED CLOSE">
 *       15 Jun 2026
 *     </SidebarSection>
 *   </SidebarCard>
 *
 * The last section's bottom border is removed automatically via the
 * `.sidebar-card-group .sidebar-section:last-child` rule in globals.css.
 */

import React from 'react'
import { Card } from './card'

interface SidebarCardProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function SidebarCard({ children, className, style }: SidebarCardProps) {
  // No inner padding — each SidebarSection owns its own horizontal padding so
  // the horizontal dividers between sections span the full card width.
  return (
    <div className={`sidebar-card-group ${className ?? ''}`} style={{ alignSelf: 'flex-start', ...style }}>
      <Card variant="default" padding="none">
        {children}
      </Card>
    </div>
  )
}

interface SidebarSectionProps {
  /** Small uppercase label (e.g. "CLIENT", "OWNER"). */
  label?: React.ReactNode
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function SidebarSection({ label, children, className, style }: SidebarSectionProps) {
  return (
    <div
      className={`sidebar-section ${className ?? ''}`}
      style={{
        padding: 'var(--space-4) var(--space-5)',
        borderBottom: '1px solid var(--color-border-subtle)',
        ...style,
      }}
    >
      {label && (
        <div
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--color-text-subtle)',
            marginBottom: 'var(--space-2)',
          }}
        >
          {label}
        </div>
      )}
      {children}
    </div>
  )
}
