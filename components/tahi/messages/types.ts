/**
 * components/tahi/messages/types.ts
 *
 * The wire shapes /messages reads, kept next to the page that reads them.
 *
 * The THREAD ROW shape is not redeclared here: it is `InboxThread` from
 * lib/messages-inbox.ts, which the routes build from and the page renders, so
 * there is exactly one definition of what a conversation row is.
 */

import type { InboxSource, InboxThread } from '@/lib/messages-inbox'

export type { InboxSource, InboxThread }

export interface ThreadFile {
  id: string
  filename: string
  storageKey: string
  mimeType: string | null
  sizeBytes: number | null
}

export interface ThreadMessageView {
  id: string
  authorId: string
  authorType: string
  authorName: string | null
  authorAvatarUrl: string | null
  body: string
  isInternal: boolean
  createdAt: string | null
  editedAt: string | null
  isOwn: boolean
  files: ThreadFile[]
  voiceNote: { url: string; durationSeconds: number | null } | null
  /** Client only, never on the wire: an optimistic row that has not landed. */
  pending?: boolean
  /** Client only: the send failed and the row offers Try again. */
  failed?: boolean
}

export interface ThreadHead {
  key: string
  source: InboxSource
  id: string
  title: string
  requestNumber: number | null
  status: string | null
  orgId: string
  orgName: string | null
  href: string | null
  /** False in a read-only impersonation preview. */
  canPost: boolean
  /** Studio only, and never on a Tahi-internal request where everything already is. */
  canInternal: boolean
}

export interface ThreadPayload {
  thread: ThreadHead
  people: Array<{ id: string; name: string; avatarUrl: string | null; side: 'team' | 'client' }>
  messages: ThreadMessageView[]
  /** The cursor AS IT WAS before this read. The "New" divider is drawn from it. */
  lastReadAt: string | null
}

export interface InboxPayload {
  threads: InboxThread[]
  /** Studio only: the client switcher. */
  clients?: Array<{ id: string; name: string; unread: number }>
  audience: 'client' | 'studio'
  readOnly?: boolean
  orgName?: string | null
  orgId?: string | null
}

/** A file staged in the composer tray, before or after its upload lands. */
export interface StagedAttachment {
  /** Local key while uploading, the real files.id once confirmed. */
  key: string
  filename: string
  sizeBytes: number
  fileId: string | null
  /** Set while the upload is in flight, cleared when it lands. */
  busy: string | null
  error: string | null
}
