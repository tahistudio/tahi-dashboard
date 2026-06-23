import * as React from 'react'

type LinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href?: string | { pathname?: string }
  prefetch?: boolean
  replace?: boolean
  scroll?: boolean
  shallow?: boolean
  passHref?: boolean
  locale?: string | false
  legacyBehavior?: boolean
}

const Link = React.forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  { href, prefetch, replace, scroll, shallow, passHref, locale, legacyBehavior, children, ...rest },
  ref,
) {
  const h = typeof href === 'string' ? href : href?.pathname ?? '#'
  return <a ref={ref} href={h} {...rest}>{children}</a>
})

export default Link
