'use client'

/**
 * <Menu>. Standardised dropdown menu built on top of <Popover>. Use it
 * for kebab menus, user dropdowns, sort/filter pickers, any context
 * menu where the trigger opens a list of actions or links.
 *
 *   <Menu
 *     trigger={<button>...</button>}
 *     align="end"
 *   >
 *     <Menu.Item icon={<Edit />} onClick={...}>Rename</Menu.Item>
 *     <Menu.Item icon={<Copy />} onClick={...}>Duplicate</Menu.Item>
 *     <Menu.Divider />
 *     <Menu.Label>Move</Menu.Label>
 *     <Menu.Item icon={<Archive />} onClick={...}>Archive</Menu.Item>
 *     <Menu.Item icon={<Trash />} onClick={...} tone="danger">Delete</Menu.Item>
 *   </Menu>
 *
 * Trigger receives a `data-state` attribute (open / closed) we can use
 * for hover styling.
 */

import * as React from 'react'
import Link from 'next/link'
import { Popover } from '@/components/tahi/popover'

interface MenuProps {
  trigger: React.ReactElement
  children: React.ReactNode
  align?: 'start' | 'end'
  /** Min width of the menu. Defaults to anchor width. */
  width?: string | number
  /** Disable the menu (passthrough on the trigger). */
  disabled?: boolean
}

function MenuRoot({ trigger, children, align = 'start', width, disabled }: MenuProps) {
  const [open, setOpen] = React.useState(false)
  const triggerRef = React.useRef<HTMLElement | null>(null)

  const child = trigger as React.ReactElement<{
    ref?: React.Ref<HTMLElement>
    onClick?: React.MouseEventHandler<HTMLElement>
    'aria-haspopup'?: 'menu' | 'true'
    'aria-expanded'?: boolean
    'data-state'?: 'open' | 'closed'
  }>

  const wrapped = React.cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node
      const original = (trigger as { ref?: React.Ref<HTMLElement> }).ref
      if (typeof original === 'function') original(node)
      else if (original && 'current' in original) (original as React.MutableRefObject<HTMLElement | null>).current = node
    },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (disabled) return
      child.props.onClick?.(e)
      if (!e.defaultPrevented) setOpen(o => !o)
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'data-state': open ? 'open' : 'closed',
  })

  return (
    <>
      {wrapped}
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={triggerRef}
        align={align}
        width={width}
      >
        <div role="menu" onClick={() => setOpen(false)} style={{ display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </Popover>
    </>
  )
}

// ── Item ───────────────────────────────────────────────────────────────

interface MenuItemProps {
  icon?: React.ReactNode
  children: React.ReactNode
  onClick?: () => void
  href?: string
  tone?: 'default' | 'danger'
  disabled?: boolean
  /** Trailing hint, e.g. a keyboard shortcut or a count. */
  trailing?: React.ReactNode
}

function MenuItem({
  icon,
  children,
  onClick,
  href,
  tone = 'default',
  disabled,
  trailing,
}: MenuItemProps) {
  const isDanger = tone === 'danger'
  const fg = isDanger ? 'var(--color-danger)' : 'var(--color-text)'
  const iconFg = isDanger ? 'var(--color-danger)' : 'var(--color-text-muted)'
  const hoverBg = isDanger ? 'var(--color-danger-bg)' : 'var(--color-bg-secondary)'

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.625rem',
    padding: '0.5rem 0.625rem',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.8125rem',
    fontWeight: 500,
    color: fg,
    background: 'transparent',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    width: '100%',
    textAlign: 'left',
    textDecoration: 'none',
    minHeight: '2rem',
    transition: 'background var(--motion-quick, 220ms) var(--ease-out)',
  }

  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled) return
    e.currentTarget.style.background = hoverBg
  }
  const onLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = 'transparent'
  }

  const content = (
    <>
      {icon && (
        <span style={{ display: 'inline-flex', flexShrink: 0, color: iconFg }}>
          {icon}
        </span>
      )}
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {children}
      </span>
      {trailing && (
        <span style={{ flexShrink: 0, color: 'var(--color-text-subtle)', fontSize: '0.6875rem', fontWeight: 500 }}>
          {trailing}
        </span>
      )}
    </>
  )

  if (href && !disabled) {
    return (
      <Link href={href} role="menuitem" style={baseStyle} onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave}>
        {content}
      </Link>
    )
  }
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      style={baseStyle}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {content}
    </button>
  )
}

// ── Divider ────────────────────────────────────────────────────────────

function MenuDivider() {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      style={{
        height: '1px',
        background: 'var(--color-border-subtle)',
        margin: '0.25rem 0',
      }}
    />
  )
}

// ── Label (small uppercase header inside a menu) ───────────────────────

function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: '0.625rem',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--color-text-subtle)',
        padding: '0.5rem 0.625rem 0.25rem',
      }}
    >
      {children}
    </div>
  )
}

export const Menu = Object.assign(MenuRoot, {
  Item: MenuItem,
  Divider: MenuDivider,
  Label: MenuLabel,
})
