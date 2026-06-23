import * as React from 'react'

type ImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | { src: string }
  fill?: boolean
  priority?: boolean
  quality?: number
  placeholder?: string
  blurDataURL?: string
  loader?: unknown
  unoptimized?: boolean
}

const Image = React.forwardRef<HTMLImageElement, ImageProps>(function Image(
  { src, fill, priority, quality, placeholder, blurDataURL, loader, unoptimized, style, ...rest },
  ref,
) {
  const s = typeof src === 'string' ? src : src?.src
  const st: React.CSSProperties = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', ...style }
    : (style ?? {})
  return <img ref={ref} src={s} style={st} {...rest} />
})

export default Image
