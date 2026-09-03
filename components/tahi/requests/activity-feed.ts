/**
 * The request detail Activity feed, as pure data.
 *
 * The feed merges four sources into one chronology: the request's own
 * lifecycle, every thread message as a comment event carrying a one-line
 * excerpt, and every uploaded file. Merging the messages in is what makes
 * the All / Comments filter worth having: before, Comments kept rows that
 * said "Posted a comment" and nothing else.
 *
 * No React in here, so it is testable in the repo's node Vitest environment.
 */

/** How far an excerpt runs before it is cut. Roughly one rail line. */
export const EXCERPT_LIMIT = 120

export type ActivityFilter = 'all' | 'comments'

export type ActivityEventType = 'created' | 'status_change' | 'comment' | 'file_upload'

export interface ActivityEvent {
  id: string
  type: ActivityEventType
  /** What happened. For a comment this is the excerpt of what was said. */
  description: string
  author: string | null
  /** ISO timestamp. */
  timestamp: string
  /** Comments only: an internal note the client never sees. */
  internal?: boolean
}

export interface ActivityRequestSource {
  createdAt: string
  updatedAt: string
  deliveredAt: string | null
  /** Already-resolved label, e.g. "In progress". */
  statusLabel: string
  assigneeName: string | null
}

export interface ActivityMessageSource {
  id: string
  /** Tiptap HTML. */
  body: string
  isInternal: boolean
  createdAt: string
  authorName: string | null
}

export interface ActivityFileSource {
  id: string
  filename: string
  createdAt: string
  uploaderName: string | null
}

/**
 * Strip HTML down to readable text. Used for the AI wizard seed and for
 * comment excerpts, so both read the same words a person would.
 */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * One line of plain text from a Tiptap message body: tags gone, every run of
 * whitespace collapsed so a multi-paragraph reply cannot push the feed row
 * to three lines, and a hard cut at EXCERPT_LIMIT on a word boundary when
 * there is one to cut on.
 */
export function messageExcerpt(html: string, limit = EXCERPT_LIMIT): string {
  const text = stripHtmlToText(html).replace(/\s+/g, ' ').trim()
  if (text.length <= limit) return text
  const cut = text.slice(0, limit)
  const lastSpace = cut.lastIndexOf(' ')
  // Only respect a word boundary that is not right at the start, otherwise a
  // single very long token would collapse the excerpt to nothing.
  const head = lastSpace > limit * 0.5 ? cut.slice(0, lastSpace) : cut
  return `${head.trimEnd()}…`
}

/**
 * Build the merged feed, newest first. Ties break on id so the order is
 * stable across renders (D1 timestamps have second resolution, and a status
 * change plus the message that caused it routinely share one).
 */
export function buildActivityEvents(
  request: ActivityRequestSource,
  messages: ReadonlyArray<ActivityMessageSource>,
  files: ReadonlyArray<ActivityFileSource>,
): ActivityEvent[] {
  const events: ActivityEvent[] = [{
    id: 'created',
    type: 'created',
    description: 'Request was created',
    author: null,
    timestamp: request.createdAt,
  }]

  // A differing updatedAt is the only status-change signal we have until the
  // audit log is wired in, so it is described as one rather than invented.
  if (request.updatedAt !== request.createdAt) {
    events.push({
      id: 'status-update',
      type: 'status_change',
      description: `Status changed to ${request.statusLabel}`,
      author: request.assigneeName,
      timestamp: request.updatedAt,
    })
  }

  if (request.deliveredAt) {
    events.push({
      id: 'delivered',
      type: 'status_change',
      description: 'Request was delivered',
      author: request.assigneeName,
      timestamp: request.deliveredAt,
    })
  }

  for (const msg of messages) {
    events.push({
      id: `msg-${msg.id}`,
      type: 'comment',
      description: messageExcerpt(msg.body),
      author: msg.authorName,
      timestamp: msg.createdAt,
      internal: msg.isInternal,
    })
  }

  for (const file of files) {
    events.push({
      id: `file-${file.id}`,
      type: 'file_upload',
      description: `Uploaded ${file.filename}`,
      author: file.uploaderName,
      timestamp: file.createdAt,
    })
  }

  events.sort((a, b) => {
    const byTime = b.timestamp.localeCompare(a.timestamp)
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id)
  })
  return events
}

/** Comments keeps the merged thread messages; All keeps everything. */
export function filterActivityEvents(
  events: ReadonlyArray<ActivityEvent>,
  filter: ActivityFilter,
): ActivityEvent[] {
  return filter === 'comments'
    ? events.filter(e => e.type === 'comment')
    : [...events]
}
