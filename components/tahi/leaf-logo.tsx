'use client'

import { cn } from '@/lib/utils'

interface LeafLogoProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: { outer: 'w-8 h-8', text: 'text-sm' },
  md: { outer: 'w-10 h-10', text: 'text-base' },
  lg: { outer: 'w-14 h-14', text: 'text-xl' },
}

export function LeafLogo({ size = 'md', className }: LeafLogoProps) {
  const s = sizeMap[size]
  return (
    <div
      className={cn(
        'brand-gradient flex items-center justify-center flex-shrink-0',
        s.outer,
        className
      )}
      style={{ borderRadius: 'var(--radius-leaf-sm)' }}
    >
      {/* Leaf SVG icon */}
      <svg
        width="60%"
        height="60%"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.85 0 3.58-.5 5.07-1.38C19.55 19.1 21 16.72 21 14c0-3.87-3.13-7-7-7-2.21 0-4.19.97-5.54 2.5C9.52 10.67 10 12.28 10 14c0 1.1.9 2 2 2s2-.9 2-2V8.93C15.34 9.57 17 11.6 17 14c0 2.76-2.24 5-5 5S7 16.76 7 14c0-3.87 3.13-7 7-7 1.85 0 3.53.72 4.77 1.89"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

interface TahiWordmarkProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  light?: boolean
}

export function TahiWordmark({ size = 'md', className, light }: TahiWordmarkProps) {
  const textSize = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl',
  }[size]

  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <LeafLogo size={size} />
      <div>
        <p
          className={cn('font-bold leading-none', textSize)}
          style={{ color: light ? 'white' : 'var(--color-text)' }}
        >
          Tahi Studio
        </p>
        <p
          className="text-xs leading-none mt-0.5"
          style={{ color: light ? 'rgba(168, 196, 160, 0.7)' : 'var(--color-text-muted)' }}
        >
          Dashboard
        </p>
      </div>
    </div>
  )
}
