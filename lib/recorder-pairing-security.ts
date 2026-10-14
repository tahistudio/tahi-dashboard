import { isUsableIdentitySecret } from '@/lib/mcp-identity'

/** IPv4 addresses are individual keys; IPv6 privacy addresses share their /64. */
export function recorderPairingIpPrefix(address: string | null): string {
  const value = address?.trim().toLowerCase() ?? ''
  const ipv4 = value.split('.')
  if (ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    return `ipv4:${ipv4.map(Number).join('.')}`
  }
  try {
    // URL's IPv6 parser validates and canonicalizes compressed and mapped forms.
    const hostname = new URL(`http://[${value}]/`).hostname
    const [before, after] = hostname.slice(1, -1).split('::')
    const left = before ? before.split(':') : []
    const right = after ? after.split(':') : []
    const groups = after === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
    return `ipv6:${groups.slice(0, 4).map(group => group.padStart(4, '0')).join(':')}/64`
  } catch {
    return 'unknown'
  }
}

/** Domain-separated HMAC makes stored rate keys resistant to IP enumeration. */
export async function hashRecorderPairingIp(address: string | null): Promise<string> {
  const secret = [process.env.MCP_IDENTITY_SECRET, process.env.CLERK_SECRET_KEY].find(isUsableIdentitySecret)
  if (!secret) throw new Error('Recorder pairing requires an existing server identity secret.')
  const encoder = new TextEncoder()
  const source = await crypto.subtle.importKey('raw', encoder.encode(secret.trim()), 'HKDF', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256',
    salt: encoder.encode('tahi-recorder-pairing-v1'), info: encoder.encode('ip-prefix-hmac'),
  }, source, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'])
  const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(recorderPairingIpPrefix(address)))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
