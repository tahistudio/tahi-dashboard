import Link from 'next/link'
import { ChevronRight } from 'lucide-react'

interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbProps {
  items: BreadcrumbItem[]
}

export function Breadcrumb({ items }: BreadcrumbProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1.5 flex-wrap"
      style={{ fontSize: '0.8125rem' }}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <ChevronRight
                size={12}
                style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }}
              />
            )}
            {isLast || !item.href ? (
              <span
                className="font-medium truncate"
                style={{
                  color: isLast ? 'var(--color-text)' : 'var(--color-text-subtle)',
                  maxWidth: '15rem',
                }}
              >
                {item.label}
              </span>
            ) : (
              <Link
                href={item.href}
                className="font-medium truncate transition-colors hover:underline"
                style={{
                  color: 'var(--color-text-muted)',
                  textDecoration: 'none',
                  maxWidth: '15rem',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
              >
                {item.label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
