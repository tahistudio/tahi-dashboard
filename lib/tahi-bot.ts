/**
 * lib/tahi-bot.ts
 *
 * The one fixed automation identity every mirrored line posts as. Every
 * writer that mirrors an automated action into `messages` or `task_comments`
 * (see lib/task-comments.ts#postTaskComment) stamps this constant rather than
 * inventing its own label, and every reader that maps an author to a name and
 * an avatar answers 'bot' with "Tahi bot" and its mark, never a person's name
 * or photo. That is the whole point: Liam and Staci approve what the bot
 * proposes, so the line has to read as automation at a glance, not as one of
 * them having typed it.
 *
 * `.ts`, not `.tsx`: this module carries the identity and the token
 * references only, no JSX. The rendered mark lives in
 * components/tahi/bot-mark.tsx, which imports BOT_AVATAR_TOKENS from here so
 * there is exactly one place the bot's colours are declared.
 */

export const TAHI_BOT = {
  /** The one value `authorType` takes for automation, never a person. */
  authorType: 'bot' as const,
  /** Stands in for `authorId` on a bot line: the bot has no roster row. */
  id: 'tahi-bot',
  name: 'Tahi bot',
}

/** True for anything authored by the fixed bot identity. */
export function isBotAuthor(authorType: string | null | undefined): boolean {
  return authorType === TAHI_BOT.authorType
}

/**
 * The avatar treatment for the bot mark: a small leaf-radius tile in brand
 * tokens, never a photo or initials. CSS custom property references only
 * (never hardcoded hex), so dark mode needs no override here.
 */
export const BOT_AVATAR_TOKENS = {
  background: 'var(--color-brand)',
  color: 'var(--color-text-on-dark)',
  borderRadius: 'var(--radius-leaf-sm)',
}
