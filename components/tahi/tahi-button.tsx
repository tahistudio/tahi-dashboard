'use client'

import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface TahiButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  iconLeft?: React.ReactNode
  iconRight?: React.ReactNode
}

const BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none'

const VARIANTS = {
  primary:   'bg-[var(--color-brand)] text-white hover:bg-[var(--color-brand-dark)] active:scale-[0.98]',
  secondary: 'bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg-secondary)] hover:border-[var(--color-brand)] active:scale-[0.98]',
  ghost:     'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text)] active:scale-[0.98]',
  danger:    'bg-red-500 text-white hover:bg-red-600 active:scale-[0.98]',
}

const SIZES = {
  sm: 'text-xs px-2.5 py-1.5 rounded-md gap-1',
  md: 'text-sm px-3.5 py-2 rounded-lg',
  lg: 'text-sm px-5 py-2.5 rounded-lg',
}

// Leaf radius override for primary buttons
const LEAF_RADIUS = { borderRadius: 'var(--radius-leaf-sm)' }

export function TahiButton({
  variant = 'primary',
  size = 'md',
  loading,
  iconLeft,
  iconRight,
  children,
  className,
  style,
  ...props
}: TahiButtonProps) {
  return (
    <button
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      style={variant === 'primary' ? { ...LEAF_RADIUS, ...style } : style}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        iconLeft
      )}
      {children}
      {!loading && iconRight}
    </button>
  )
}
