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
  primary:   'bg-[var(--color-brand)] text-white hover:bg-[#3d6333] hover:shadow-[0_4px_14px_rgba(90,130,78,0.4)] hover:-translate-y-px active:translate-y-0 active:shadow-none',
  secondary: 'bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-bg-tertiary)] hover:border-[var(--color-brand)] active:scale-[0.98]',
  ghost:     'text-[var(--color-text-muted)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text)] active:scale-[0.98]',
  danger:    'bg-[#dc2626] text-white hover:bg-[#991b1b] hover:shadow-[0_4px_14px_rgba(220,38,38,0.4)] hover:-translate-y-px active:translate-y-0 active:shadow-none',
}

const SIZES = {
  sm: 'text-xs px-2.5 py-1.5 gap-1',
  md: 'text-sm px-3.5 py-2',
  lg: 'text-sm px-5 py-2.5',
}

// Primary = leaf radius, everything else = standard rounded
const RADIUS: Record<string, Record<string, string>> = {
  primary: { sm: 'var(--radius-leaf-sm)', md: 'var(--radius-leaf-sm)', lg: 'var(--radius-leaf-sm)' },
  secondary: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-md)' },
  ghost: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-md)' },
  danger: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-md)' },
}

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
      style={{ borderRadius: RADIUS[variant]?.[size] ?? 'var(--radius-md)', ...style }}
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
