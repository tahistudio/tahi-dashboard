/**
 * lib/notification-events.ts
 *
 * The window-event vocabulary the notification bell shares with the surfaces
 * that clear rows behind its back.
 *
 * This lives in a client-safe module for the same reason lib/notification-links
 * does: the bell carries an EventSource reconnect loop, a router and a popover
 * with it, and a page that only needs to say "the count moved" should not have
 * to import all of that to read one string.
 */

/**
 * Fired by any surface that has just marked notifications read without going
 * through the popover (opening a request clears that request's rows). The bell
 * refetches on open, on reconnect and on a pushed row, so without this the
 * badge kept counting rows the user had already dealt with.
 */
export const NOTIFICATIONS_CHANGED_EVENT = 'tahi:notifications-changed'

/**
 * Announce that rows were marked read outside the popover. Safe to call during
 * SSR or in a test: it no-ops when there is no window.
 */
export function notifyNotificationsChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT))
}
