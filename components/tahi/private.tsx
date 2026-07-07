/**
 * <Private> - wraps sensitive content so it blurs under Private view.
 *
 * Private view (toggled in the account menu) adds .tahi-private to <html>; a
 * globals.css rule blurs every [data-private] node until hovered. This is the
 * declarative form of that convention - reach for it instead of hand-writing
 * the data-private attribute, so intent reads at a glance and the attribute
 * name can never drift.
 *
 *   <Private>{contact.email}</Private>
 *   <Private as="b">{client.name}</Private>
 *
 * For money, prefer <Money sensitive /> which composes the same behaviour.
 * Tag anything that identifies a client, a person, or a private figure so the
 * dashboard is safe to demo or screen-share.
 */

import type { CSSProperties, ReactNode } from 'react'

type PrivateElement = 'span' | 'b' | 'strong' | 'div' | 'p' | 'small'

interface PrivateProps {
  children: ReactNode
  /** Element to render. Default 'span'. */
  as?: PrivateElement
  className?: string
  style?: CSSProperties
}

export function Private({ children, as: As = 'span', className, style }: PrivateProps) {
  return (
    <As data-private className={className} style={style}>
      {children}
    </As>
  )
}
