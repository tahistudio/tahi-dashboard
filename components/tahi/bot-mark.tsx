'use client'

/**
 * <BotAvatarMark>. The Tahi bot's avatar wherever an author renders: a
 * leaf-radius tile in brand tokens carrying the Bot glyph, never a photo or
 * initials, so a bot line is legible as automation at a glance and is never
 * mistaken for a teammate. See lib/tahi-bot.ts for the identity and the
 * token references this draws from.
 */

import { Bot } from 'lucide-react'
import { BOT_AVATAR_TOKENS, TAHI_BOT } from '@/lib/tahi-bot'

export function BotAvatarMark({ size = 28 }: { size?: number }) {
  const iconSize = Math.round(size * 0.5)
  return (
    <span
      aria-hidden="true"
      title={TAHI_BOT.name}
      className="inline-flex items-center justify-center flex-shrink-0"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        background: BOT_AVATAR_TOKENS.background,
        color: BOT_AVATAR_TOKENS.color,
        borderRadius: BOT_AVATAR_TOKENS.borderRadius,
      }}
    >
      <Bot size={iconSize} aria-hidden="true" />
    </span>
  )
}
