/**
 * Signed view tokens for the qa-view proxy worker. Pure WebCrypto, so the
 * dashboard (signs) and the worker (verifies) share this file.
 * Format: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payloadPart)).
 */
import type { QaViewTokenPayload } from './types'

function toB64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

async function hmac(data: string, secret: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)))
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function isPayload(v: unknown): v is QaViewTokenPayload {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return typeof r.o === 'string' && typeof r.p === 'string' && typeof r.exp === 'number'
}

export async function signViewToken(payload: QaViewTokenPayload, secret: string): Promise<string> {
  const body = toB64Url(new TextEncoder().encode(JSON.stringify(payload)))
  return `${body}.${toB64Url(await hmac(body, secret))}`
}

export function decodeViewTokenPayload(token: string): QaViewTokenPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const bytes = fromB64Url(parts[0])
  if (!bytes) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return isPayload(parsed) ? parsed : null
  } catch {
    return null
  }
}

export async function verifyViewToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<QaViewTokenPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const sig = fromB64Url(parts[1])
  if (!sig) return null
  if (!timingSafeEqual(sig, await hmac(parts[0], secret))) return null
  const payload = decodeViewTokenPayload(token)
  if (!payload || payload.exp < nowSeconds) return null
  return payload
}

export const QA_VIEW_TOKEN_TTL_SECONDS = 12 * 60 * 60
