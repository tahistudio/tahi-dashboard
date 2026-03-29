'use client'

import Link from 'next/link'
import { ChevronRight, Home } from 'lucide-react'

interface Crumb {
  label: string
  href?: string
}

interface BreadcrumbsProps {
  items: Crumb[]
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" style={{ marginBottom: '1rem' }}>
      <ol className="flex items-center gap-1 flex-wrap" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        <li className="flex items-center">
          <Link
            href="/overview"
            className="flex items-center text-xs transition-colors hover:underline"
            style={{ color: 'var(--color-text-subtle)', textDecoration: 'none' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
          >
            <Home size={12} />
          </Link>
        </li>
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          return (
            <li key={i} className="flex items-center gap-1">
              <ChevronRight size={11} style={{ color: 'var(--color-text-subtle)' }} />
              {isLast || !item.href ? (
                <span
                  className="text-xs font-medium"
                  style={{ color: isLast ? 'var(--color-text)' : 'var(--color-text-subtle)' }}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="text-xs transition-colors hover:underline"
                  style={{ color: 'var(--color-text-subtle)', textDecoration: 'none' }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-subtle)' }}
                >
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
