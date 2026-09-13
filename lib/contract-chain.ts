/**
 * lib/contract-chain.ts
 *
 * The pure hash-chain math behind a contract's signature ledger, factored out
 * of the public sign route so it can be unit tested without a fake D1 and so
 * every caller shares the exact same digest.
 *
 * Chain rule: chainHash = sha256(prevChainHash | signerId | signatureDataUrl |
 * timestamp | bodyHash), where bodyHash = sha256(contract.bodyHtml) AT THE
 * MOMENT OF SIGNING. Folding the body into the chain is what makes an edit to
 * the contract body AFTER a signature detectable: recomputing sha256 of the
 * body now and comparing it to the bodyHash stored on that signature answers
 * "is this still the document they signed?" without needing the old body text
 * anywhere else.
 *
 * FORWARD-ONLY. Signatures taken before contract_signatures.body_hash existed
 * (migration 0099) have body_hash = NULL, and bodyMatchesSignedHash treats
 * that as "unverifiable", never as a false pass or a false tamper flag: there
 * is no historic body snapshot to check them against.
 */

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface ChainStepInput {
  prevChainHash: string
  signerId: string
  signatureDataUrl: string
  timestamp: string
  bodyHash: string
}

/**
 * One link in the signature chain. The order of the parts, and the pipe
 * separator between them, is the contract every caller and every test must
 * agree on: changing it silently invalidates every chain already stored.
 */
export async function computeChainHash(input: ChainStepInput): Promise<string> {
  return sha256Hex(
    `${input.prevChainHash}|${input.signerId}|${input.signatureDataUrl}|${input.timestamp}|${input.bodyHash}`,
  )
}

/**
 * Has the contract body changed since this signature was taken?
 *
 * Returns:
 *   - null  the signature predates the body-hash column, nothing to compare
 *   - true  the current body still hashes to what this signature anchored
 *   - false the body has diverged since this signature was taken
 */
export async function bodyMatchesSignedHash(
  currentBodyHtml: string,
  storedBodyHash: string | null | undefined,
): Promise<boolean | null> {
  if (!storedBodyHash) return null
  const hash = await sha256Hex(currentBodyHtml)
  return hash === storedBodyHash
}
