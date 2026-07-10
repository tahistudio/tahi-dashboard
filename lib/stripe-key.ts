/**
 * Central accessor for the Stripe secret key.
 *
 * Secrets pasted into a dashboard (Webflow Cloud / Cloudflare) sometimes carry
 * an invisible leading byte-order-mark (U+FEFF) or surrounding whitespace. The
 * Stripe API then rejects every call with "Invalid API Key provided" even
 * though the visible characters are correct. JS `String.prototype.trim()`
 * removes U+FEFF (it is in the ECMAScript WhiteSpace set) along with ordinary
 * whitespace, so trimming here immunises every Stripe call site against that
 * class of paste error.
 *
 * Returns undefined when the key is unset or empty after trimming, preserving
 * the existing `if (!key)` / `!!key` "not configured" guards at call sites.
 */
export function stripeSecretKey(): string | undefined {
  const raw = process.env.STRIPE_SECRET_KEY
  if (!raw) return undefined
  const cleaned = raw.trim()
  return cleaned.length > 0 ? cleaned : undefined
}
