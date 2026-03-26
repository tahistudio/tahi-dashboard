'use client'

import { formatDistanceToNow } from 'date-fns'
import { Lock, User } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Message {
  id: string
  authorId: string
  authorType: 'team_member' | 'contact'
  body: string          // HTML from Tiptap
  isInternal: boolean
  editedAt: string | null
  createdAt: string
  teamMemberName?: string | null
  teamMemberAvatar?: string | null
}

interface RequestThreadProps {
  messages: Message[]
  currentUserId?: string
}

export function RequestThread({ messages, currentUserId }: RequestThreadProps) {
  if (messages.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        No messages yet. Start the conversation below.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          msg={msg}
          isOwn={msg.authorId === currentUserId}
        />
      ))}
    </div>
  )
}

function MessageBubble({ msg, isOwn }: { msg: Message; isOwn: boolean }) {
  const isTeam = msg.authorType === 'team_member'
  const authorName = isTeam
    ? (msg.teamMemberName ?? 'Tahi Team')
    : 'Client'

  const timeAgo = (() => {
    try {
      return formatDistanceToNow(new Date(msg.createdAt), { addSuffix: true })
    } catch {
      return ''
    }
  })()

  return (
    <div
      className={cn(
        'group flex gap-3',
        isOwn ? 'flex-row-reverse' : 'flex-row',
      )}
    >
      {/* Avatar */}
      <div className={cn(
        'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold',
        isTeam
          ? 'bg-[var(--color-brand)] text-white'
          : 'bg-gray-200 text-gray-600',
      )}>
        {msg.teamMemberAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={msg.teamMemberAvatar} alt={authorName} className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <User size={14} />
        )}
      </div>

      {/* Bubble */}
      <div className={cn('flex flex-col gap-1 max-w-[75%]', isOwn ? 'items-end' : 'items-start')}>
        {/* Meta */}
        <div className={cn('flex items-center gap-2 text-xs text-gray-400', isOwn && 'flex-row-reverse')}>
          <span className="font-medium text-gray-600">{authorName}</span>
          <span>{timeAgo}</span>
          {msg.editedAt && <span className="italic">(edited)</span>}
          {msg.isInternal && (
            <span className="flex items-center gap-0.5 text-amber-600 font-medium">
              <Lock size={10} />
              Internal
            </span>
          )}
        </div>

        {/* Content */}
        <div
          className={cn(
            'px-4 py-3 rounded-[0_12px_0_12px] text-sm prose prose-sm max-w-none',
            isOwn
              ? 'bg-[var(--color-brand)] text-white prose-invert rounded-[12px_0_12px_0]'
              : msg.isInternal
                ? 'bg-amber-50 border border-amber-200 text-amber-900'
                : 'bg-white border border-gray-200 text-gray-800',
          )}
          // HTML from Tiptap is sanitised server-side before storage
          dangerouslySetInnerHTML={{ __html: msg.body }}
        />
      </div>
    </div>
  )
}
