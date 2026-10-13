const PREVIEW_TTL_MS = 10 * 60 * 1000
const encoder = new TextEncoder()

async function signingKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

function previewMessage(actorId: string, preview: unknown, expiresAt: number) {
  return encoder.encode(JSON.stringify({ purpose: 'stripe_customer_link', actorId, expiresAt, preview }))
}

/** Bind approval to the preview, caller and a short lifetime without storing a new secret or row. */
export async function signStripeCustomerLinkPreview(secret: string, actorId: string, preview: unknown): Promise<string> {
  const expiresAt = Date.now() + PREVIEW_TTL_MS
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), previewMessage(actorId, preview, expiresAt))
  const hex = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')
  return `${expiresAt}.${hex}`
}

export async function verifyStripeCustomerLinkPreview(secret: string, actorId: string, preview: unknown, token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || !/^\d{13}\.[0-9a-f]{64}$/.test(token)) return false
  const [expires, hex] = token.split('.')
  const expiresAt = Number(expires)
  const now = Date.now()
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + PREVIEW_TTL_MS) return false
  const signature = Uint8Array.from(hex.match(/../g) ?? [], byte => parseInt(byte, 16))
  return crypto.subtle.verify('HMAC', await signingKey(secret), signature, previewMessage(actorId, preview, expiresAt))
}
