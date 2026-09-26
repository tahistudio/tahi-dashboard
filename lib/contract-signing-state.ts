/**
 * lib/contract-signing-state.ts
 *
 * Two facts about a contract document that every surface has to state the
 * same way: the public viewer, the admin preview, the contract detail and
 * list, the client Papers tab, the signed-PDF routes and the fully-signed
 * email. Pure functions with no database or server imports, so client
 * components and API routes read them from one place.
 *
 * PAST EXPIRY. `expiresAt` is the deadline for signing. Once it passes, a
 * contract nobody has finished signing can no longer be signed, whether or
 * not anything has written 'expired' onto the row yet: the sign route flips
 * the status lazily, on the first signature attempt after the deadline, so
 * a lapsed contract can still read 'sent' or 'partially_signed' for as long
 * as nobody tries. A signed or cancelled contract is never "expired"; its
 * outcome was decided before the clock mattered. Same shape as the proposal
 * read route's isPastExpiry (app/api/public/proposals/[token]/route.ts),
 * with the contract statuses in place of the proposal ones.
 *
 * MARKED SIGNED. A contract reaches 'signed' two ways. The sign route flips
 * it when the last pending signer signs, and stamps signedAt and finalHash
 * in that same write. An admin PATCH (the dashboard, or the MCP
 * update_contract tool) can also set 'signed' directly, for an agreement
 * the parties executed somewhere else; that write touches neither column,
 * and the signers it skipped have no signature rows. finalHash has been
 * written by every in-flow completion since contracts shipped (b49dadd4), so
 * 'signed' without it means marked by hand. Such a contract has no signing
 * date, no hash chain and no signed PDF on file, and no surface may invent
 * one.
 */

export function isContractPastExpiry(
  status: string,
  expiresAt: string | null,
  now: number = Date.now(),
): boolean {
  if (status === 'expired') return true
  if (status === 'signed' || status === 'cancelled') return false
  if (!expiresAt) return false
  const deadline = new Date(expiresAt).getTime()
  return Number.isFinite(deadline) && deadline < now
}

export function isMarkedSigned(doc: { status: string; finalHash: string | null }): boolean {
  return doc.status === 'signed' && !doc.finalHash
}
