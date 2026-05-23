'use client'

/**
 * <FileAttachmentList>. The shared file list. Used in request threads,
 * messages, contracts, proposals, anywhere we attach files.
 *
 *   <FileAttachmentList
 *     items={[
 *       { id: '1', name: 'brief.pdf',      sizeBytes: 184_000, url: '/files/1' },
 *       { id: '2', name: 'hero.png',       sizeBytes: 412_000, url: '/files/2', thumbnailUrl: '/thumbs/2' },
 *       { id: '3', name: 'logo.svg',       sizeBytes:   3_400, url: '/files/3', mime: 'image/svg+xml' },
 *     ]}
 *     onPreview={item => openPreview(item)}
 *     onRemove={item => deleteFile(item.id)}
 *   />
 *
 *   <FileAttachmentList variant="grid" items={imageFiles} />
 *
 * Variants:
 *   list (default)   compact rows with icon, name, size, actions
 *   grid             square thumbnails for image-heavy attachments
 *
 * Items with `thumbnailUrl` or an image mime show a thumbnail; others
 * show a tone-coded icon (pdf/doc/sheet/zip/audio/video/code/image).
 */

import * as React from 'react'
import {
  Download,
  Eye,
  X,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileCode,
  Sheet,
  File as FileIconGeneric,
} from 'lucide-react'

export interface FileAttachment {
  id: string
  name: string
  sizeBytes?: number
  /** MIME type. When set, drives the icon + thumbnail logic. */
  mime?: string
  /** Direct URL for downloading + the default click target. */
  url?: string
  /** Pre-generated thumbnail URL (R2 / image preview). Overrides icon. */
  thumbnailUrl?: string
  /** Optional uploader display name. */
  uploadedBy?: string
  /** Optional ISO date. */
  uploadedAt?: string
  /** Disable interactions for this item (uploading, removed). */
  disabled?: boolean
}

interface FileAttachmentListProps {
  items: ReadonlyArray<FileAttachment>
  /** "list" = rows with icon + name + meta. "grid" = thumbnail cards. */
  variant?: 'list' | 'grid'
  /** Click an item. Default opens `url` in a new tab when present. */
  onItemClick?: (item: FileAttachment) => void
  /** Eye icon. Shows when set. */
  onPreview?: (item: FileAttachment) => void
  /** Download icon. Defaults to opening `url` in a new tab when set; pass
   *  a custom handler to override (e.g. signed download). */
  onDownload?: (item: FileAttachment) => void
  /** Remove X. Shows when set. */
  onRemove?: (item: FileAttachment) => void
  /** Cap rendered items. The rest are summarised as "+N more". */
  maxItems?: number
  className?: string
}

// ── Icon + tone per MIME family ─────────────────────────────────────────────

interface IconSpec {
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; 'aria-hidden'?: boolean }>
  /** Hex colour for the icon + tile bg tint. */
  tone: string
}

function iconForMime(name: string, mime?: string): IconSpec {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const m = (mime ?? '').toLowerCase()
  if (m.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) {
    return { Icon: FileImage, tone: 'var(--color-text-muted)' }
  }
  if (m.startsWith('video/') || ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) {
    return { Icon: FileVideo, tone: 'var(--color-text-muted)' }
  }
  if (m.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) {
    return { Icon: FileAudio, tone: 'var(--color-text-muted)' }
  }
  if (['pdf'].includes(ext) || m === 'application/pdf') {
    return { Icon: FileText, tone: 'var(--color-text-muted)' }
  }
  if (['xlsx', 'xls', 'csv'].includes(ext) || m.includes('sheet') || m === 'text/csv') {
    return { Icon: Sheet, tone: 'var(--color-text-muted)' }
  }
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext) || m.includes('zip') || m.includes('archive')) {
    return { Icon: FileArchive, tone: 'var(--color-text-muted)' }
  }
  if (['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'sh', 'py', 'rb', 'go', 'rs', 'md'].includes(ext)) {
    return { Icon: FileCode, tone: 'var(--color-text-muted)' }
  }
  if (['doc', 'docx', 'txt'].includes(ext) || m.includes('word')) {
    return { Icon: FileText, tone: 'var(--color-text-muted)' }
  }
  return { Icon: FileIconGeneric, tone: 'var(--color-text-muted)' }
}

function isImage(name: string, mime?: string): boolean {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return (mime ?? '').startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ext)
}

function formatBytes(n?: number): string {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// ── Component ───────────────────────────────────────────────────────────────

export function FileAttachmentList({
  items,
  variant = 'list',
  onItemClick,
  onPreview,
  onDownload,
  onRemove,
  maxItems,
  className,
}: FileAttachmentListProps) {
  const cap = maxItems ?? items.length
  const visibleItems = items.slice(0, cap)
  const overflow = items.length - visibleItems.length

  const handleItemClick = (item: FileAttachment) => {
    if (item.disabled) return
    if (onItemClick) onItemClick(item)
    else if (item.url) window.open(item.url, '_blank', 'noopener')
  }

  if (variant === 'grid') {
    return (
      <div
        className={className}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(8rem, 1fr))',
          gap: '0.5rem',
        }}
      >
        {visibleItems.map(item => (
          <GridTile
            key={item.id}
            item={item}
            onItemClick={handleItemClick}
            onRemove={onRemove}
          />
        ))}
        {overflow > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              aspectRatio: '1 / 1',
              borderRadius: 'var(--radius-md)',
              border: '1px dashed var(--color-border)',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
              fontWeight: 500,
            }}
          >
            +{overflow} more
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
    >
      {visibleItems.map(item => (
        <ListRow
          key={item.id}
          item={item}
          onItemClick={handleItemClick}
          onPreview={onPreview}
          onDownload={onDownload}
          onRemove={onRemove}
        />
      ))}
      {overflow > 0 && (
        <div
          style={{
            padding: '0.375rem 0.625rem',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-subtle)',
          }}
        >
          +{overflow} more
        </div>
      )}
    </div>
  )
}

// ── List row ────────────────────────────────────────────────────────────────

function ListRow({
  item,
  onItemClick,
  onPreview,
  onDownload,
  onRemove,
}: {
  item: FileAttachment
  onItemClick: (item: FileAttachment) => void
  onPreview?: (item: FileAttachment) => void
  onDownload?: (item: FileAttachment) => void
  onRemove?: (item: FileAttachment) => void
}) {
  const { Icon } = iconForMime(item.name, item.mime)
  const hasThumb = !!item.thumbnailUrl
  return (
    <div
      role="button"
      tabIndex={item.disabled ? -1 : 0}
      onClick={() => onItemClick(item)}
      onKeyDown={(e) => {
        if (item.disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onItemClick(item)
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        padding: '0.4375rem 0.625rem',
        borderRadius: 'var(--radius-md)',
        background: 'transparent',
        cursor: item.disabled ? 'not-allowed' : 'pointer',
        opacity: item.disabled ? 0.55 : 1,
        transition: 'background-color 150ms ease',
      }}
      onMouseEnter={e => {
        if (item.disabled) return
        e.currentTarget.style.background = 'var(--color-bg-secondary)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: '1.75rem',
          height: '1.75rem',
          borderRadius: 'var(--radius-sm)',
          background: hasThumb ? 'transparent' : 'var(--color-bg-tertiary)',
          color: 'var(--color-text-muted)',
          overflow: 'hidden',
        }}
      >
        {hasThumb
          /* eslint-disable-next-line @next/next/no-img-element */
          ? <img src={item.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Icon size={14} aria-hidden={true} />
        }
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text)',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </div>
        <FileMeta item={item} />
      </div>
      <FileActions
        item={item}
        onPreview={onPreview}
        onDownload={onDownload}
        onRemove={onRemove}
      />
    </div>
  )
}

// ── Grid tile ───────────────────────────────────────────────────────────────

function GridTile({
  item,
  onItemClick,
  onRemove,
}: {
  item: FileAttachment
  onItemClick: (item: FileAttachment) => void
  onRemove?: (item: FileAttachment) => void
}) {
  const { Icon } = iconForMime(item.name, item.mime)
  const hasThumb = !!item.thumbnailUrl || (isImage(item.name, item.mime) && !!item.url)
  const thumbSrc = item.thumbnailUrl ?? (isImage(item.name, item.mime) ? item.url : undefined)
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        border: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-secondary)',
        cursor: item.disabled ? 'not-allowed' : 'pointer',
        opacity: item.disabled ? 0.55 : 1,
        transition: 'border-color 150ms ease',
      }}
      onClick={() => onItemClick(item)}
      onMouseEnter={e => {
        if (!item.disabled) e.currentTarget.style.borderColor = 'var(--color-border)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
      }}
    >
      <div
        style={{
          aspectRatio: '1 / 1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: hasThumb ? 'var(--color-bg-tertiary)' : 'var(--color-bg-secondary)',
        }}
      >
        {hasThumb && thumbSrc
          /* eslint-disable-next-line @next/next/no-img-element */
          ? <img src={thumbSrc} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <Icon size={22} aria-hidden={true} />
        }
      </div>
      <div
        style={{
          padding: '0.4375rem 0.5rem',
          borderTop: '1px solid var(--color-border-subtle)',
          background: 'var(--color-bg)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.125rem',
        }}
      >
        <div
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 500,
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {item.name}
        </div>
        <FileMeta item={item} muted />
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(item) }}
          aria-label={`Remove ${item.name}`}
          style={{
            position: 'absolute',
            top: '0.375rem',
            right: '0.375rem',
            width: '1.25rem',
            height: '1.25rem',
            borderRadius: 999,
            background: 'rgba(15, 20, 16, 0.6)',
            border: 'none',
            color: '#ffffff',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={11} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

// ── Inline meta + actions ───────────────────────────────────────────────────

function FileMeta({ item, muted = false }: { item: FileAttachment; muted?: boolean }) {
  const parts: string[] = []
  if (item.sizeBytes != null) parts.push(formatBytes(item.sizeBytes))
  if (item.uploadedBy) parts.push(item.uploadedBy)
  if (parts.length === 0) return null
  return (
    <div
      style={{
        fontSize: '0.6875rem',
        color: muted ? 'var(--color-text-subtle)' : 'var(--color-text-muted)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {parts.join(' · ')}
    </div>
  )
}

function FileActions({
  item,
  onPreview,
  onDownload,
  onRemove,
}: {
  item: FileAttachment
  onPreview?: (item: FileAttachment) => void
  onDownload?: (item: FileAttachment) => void
  onRemove?: (item: FileAttachment) => void
}) {
  const stop = (e: React.MouseEvent) => e.stopPropagation()
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.125rem', flexShrink: 0 }}>
      {onPreview && (
        <IconActionButton
          label={`Preview ${item.name}`}
          onClick={(e) => { stop(e); onPreview(item) }}
        >
          <Eye size={13} aria-hidden="true" />
        </IconActionButton>
      )}
      {(onDownload || item.url) && (
        <IconActionButton
          label={`Download ${item.name}`}
          onClick={(e) => {
            stop(e)
            if (onDownload) onDownload(item)
            else if (item.url) window.open(item.url, '_blank', 'noopener')
          }}
        >
          <Download size={13} aria-hidden="true" />
        </IconActionButton>
      )}
      {onRemove && (
        <IconActionButton
          label={`Remove ${item.name}`}
          onClick={(e) => { stop(e); onRemove(item) }}
          tone="danger"
        >
          <X size={13} aria-hidden="true" />
        </IconActionButton>
      )}
    </div>
  )
}

function IconActionButton({
  children,
  label,
  onClick,
  tone = 'default',
}: {
  children: React.ReactNode
  label: string
  onClick: (e: React.MouseEvent) => void
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.5rem',
        height: '1.5rem',
        borderRadius: 'var(--radius-sm)',
        background: 'transparent',
        border: 'none',
        color: 'var(--color-text-subtle)',
        cursor: 'pointer',
        transition: 'background-color 150ms ease, color 150ms ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = tone === 'danger'
          ? 'var(--color-danger-bg, rgba(220, 38, 38, 0.10))'
          : 'var(--color-bg-tertiary)'
        e.currentTarget.style.color = tone === 'danger'
          ? 'var(--color-danger)'
          : 'var(--color-text)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--color-text-subtle)'
      }}
    >
      {children}
    </button>
  )
}
