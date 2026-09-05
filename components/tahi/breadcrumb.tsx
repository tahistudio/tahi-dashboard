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
                {...(isLast ? { 'data-private': '' } : {})}
                className="font-medium truncate"
                style={{
                  color: isLast ? 'var(--color-text)' : 'var(--color-text-subtle)',
                  maxWidth: '15rem',
                }}
              >
                {item.label}
              </span>
            ) : (
              // The parent link measured 21px on a phone: a line of 13px type
              // and nothing else. It gets a real 2.75rem target below md,
              // padded out rather than set in bigger type, and md: hands the
              // height back to the line. The box has to centre that extra
              // space, so it becomes a flex box, and the clamp moves onto the
              // label because text-overflow needs a text container to sit on.
              <Link
                href={item.href}
                className="tahi-focus-ring inline-flex items-center font-medium transition-colors hover:underline min-h-[2.75rem] md:min-h-0"
                style={{
                  color: 'var(--color-text-muted)',
                  textDecoration: 'none',
                  borderRadius: 'var(--radius-sm)',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand)' }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
              >
                <span className="truncate" style={{ maxWidth: '15rem' }}>{item.label}</span>
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
