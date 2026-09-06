/**
 * Data the auth pages hand to <AuthShell> and to the Clerk widget.
 *
 * Server-safe on purpose. app/(auth)/sign-in and /sign-up are server
 * components (they export `metadata`), and these two values used to be
 * exported from components/tahi/auth-shell.tsx, which is a 'use client'
 * module. In the server bundle Next replaces every export of a client module
 * with a client reference, so a server file reading one is reading a stub, not
 * the data. Passing a stub straight back down as a prop happens to survive the
 * flight serialiser today, which is exactly what makes it dangerous: the first
 * edit that reads `TAHI_TRUST_AVATARS.length` on the server throws, with a
 * green type-check, a green lint and a green build.
 *
 * Values only, no JSX, so both sides may import it.
 */

export interface TrustAvatar {
  /** Profile photo URL. Takes precedence over `bg`. */
  src?: string
  /** Background colour, used when there is no photo. */
  bg?: string
  /** Optional "+N" chip text; when set it renders as a count chip. */
  more?: string
}

/**
 * Trust avatar stack. Placeholder profile photos for now; swap for real client
 * faces/logos when available. The last entry is the "+N" count chip.
 */
export const TAHI_TRUST_AVATARS: TrustAvatar[] = [
  { src: 'https://randomuser.me/api/portraits/men/32.jpg' },
  { src: 'https://randomuser.me/api/portraits/women/44.jpg' },
  { src: 'https://randomuser.me/api/portraits/men/75.jpg' },
  { src: 'https://randomuser.me/api/portraits/women/68.jpg' },
  { more: '+40' },
]

/**
 * Shared Clerk appearance preset for sign-in and sign-up. The full visual
 * theming lives in the scoped `.cl-*` CSS in components/tahi/auth-shell.tsx;
 * these keys set social-button placement and hide Clerk's footer so our own
 * switch link owns that row. The per-step heading wording comes from
 * ClerkProvider localization in app/layout.tsx.
 */
export const tahiClerkAppearance = {
  layout: {
    socialButtonsPlacement: 'top',
    showOptionalFields: true,
  },
  elements: {
    footer: 'hidden',
  },
} as const
