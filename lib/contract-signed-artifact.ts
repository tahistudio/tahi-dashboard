/**
 * lib/contract-signed-artifact.ts
 *
 * R2 storage for a contract's stamped signed PDF, plus the key convention
 * every caller shares: the fully-signed email sender
 * (lib/contract-fully-signed-emails.ts), the admin download/resend route
 * (app/api/admin/contracts/[id]/signed-pdf), and the token-scoped public
 * signer download (app/api/public/contracts/[token]/signed-pdf).
 *
 * WHY THIS EXISTS. Before this file the signed PDF existed only as one
 * fire-and-forget email attachment: lib/contract-fully-signed-emails.ts built
 * it, attached it, and threw the bytes away. A lost or filtered email meant
 * no copy of the signed agreement existed anywhere, for anyone, ever again.
 * The PDF is now written to R2 the moment it is built and re-servable from
 * either the admin or the public side, and every route that once had to
 * regenerate it from scratch can now do a straight R2 read instead.
 *
 * REGENERATE ON THE FLY covers two cases: a contract signed before this
 * change exists (signedStorageKey is null) and a stored object that has since
 * gone missing from R2. Either way `resolveContractSignedPdfBytes` rebuilds
 * the PDF from the document + its signers/signatures and best-effort backfills
 * the storage key so the next read is a straight R2 hit.
 */
import { and, asc, eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { buildSignedPdfBase64 } from '@/lib/contract-signed-pdf'
import { publicUrl } from '@/lib/app-url'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export function contractSignedPdfKey(contractId: string): string {
  return `contracts/${contractId}/signed.pdf`
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** A fresh, non-shared ArrayBuffer copy of a base64 PDF, for NextResponse's BodyInit. */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bytes = base64ToBytes(base64)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** Puts the base64 PDF at the contract's key. Returns the key it landed at. */
export async function putContractSignedPdf(
  env: { STORAGE: R2Bucket },
  contractId: string,
  pdfBase64: string,
): Promise<string> {
  const key = contractSignedPdfKey(contractId)
  await env.STORAGE.put(key, base64ToBytes(pdfBase64), {
    httpMetadata: { contentType: 'application/pdf' },
  })
  return key
}

/**
 * Reads the raw PDF bytes at `key`. Null when the object is missing.
 *
 * Returns a genuine ArrayBuffer (not a Uint8Array view) because that is what
 * `new NextResponse(body)` accepts as BodyInit without a type error under
 * this project's TypeScript/lib combination (matches
 * app/api/uploads/serve/route.ts's own object.arrayBuffer() read).
 */
export async function getContractSignedPdf(
  env: { STORAGE: R2Bucket },
  key: string,
): Promise<ArrayBuffer | null> {
  const obj = await env.STORAGE.get(key)
  if (!obj) return null
  return obj.arrayBuffer()
}

/** The columns resolveContractSignedPdfBytes needs from contract_documents. */
export interface SignedPdfDocRow {
  id: string
  name: string
  type: string
  bodyHtml: string
  signedAt: string | null
  finalHash: string | null
  publicShareToken: string | null
  signedStorageKey: string | null
}

/**
 * The signed PDF's bytes, from R2 when a stored key resolves there, otherwise
 * rebuilt from the document's current signers and signatures. A successful
 * rebuild is best-effort persisted back to R2 and stamped onto the row so the
 * next caller reads it straight, but a failure to persist never blocks the
 * bytes this call already has in hand.
 */
export async function resolveContractSignedPdfBytes(
  database: D1,
  env: { STORAGE?: R2Bucket } | null | undefined,
  doc: SignedPdfDocRow,
): Promise<ArrayBuffer> {
  if (doc.signedStorageKey && env?.STORAGE) {
    const existing = await getContractSignedPdf({ STORAGE: env.STORAGE }, doc.signedStorageKey)
    if (existing) return existing
  }

  const signers = await database
    .select({
      id: schema.contractSigners.id,
      name: schema.contractSigners.name,
      email: schema.contractSigners.email,
      role: schema.contractSigners.role,
      signedAt: schema.contractSigners.signedAt,
    })
    .from(schema.contractSigners)
    .where(eq(schema.contractSigners.contractId, doc.id))
    .orderBy(asc(schema.contractSigners.position))

  const signatures = await database
    .select({
      signerId: schema.contractSignatures.signerId,
      signatureDataUrl: schema.contractSignatures.signatureDataUrl,
      signedAt: schema.contractSignatures.signedAt,
    })
    .from(schema.contractSignatures)
    .where(eq(schema.contractSignatures.contractId, doc.id))
  const sigBySigner = new Map(signatures.map((s) => [s.signerId, s]))

  const publicViewerUrl = doc.publicShareToken
    ? publicUrl(`/p/contract/${doc.publicShareToken}`)
    : publicUrl(`/contracts/${doc.id}`)

  // Never today's date. A missing signedAt falls back to the latest
  // signature's own timestamp (the moment the contract became fully signed),
  // and to no date at all when even that is missing. The routes that call
  // this refuse a contract marked signed by hand before getting here
  // (lib/contract-signing-state.ts).
  const latestSignatureAt = signatures
    .map((s) => s.signedAt)
    .filter((t): t is string => !!t)
    .sort()
    .at(-1) ?? null

  const base64 = buildSignedPdfBase64({
    contractName: doc.name,
    contractType: doc.type,
    signedAt: doc.signedAt ?? latestSignatureAt,
    finalHash: doc.finalHash,
    publicViewerUrl,
    bodyHtml: doc.bodyHtml,
    signers: signers.map((s) => {
      const sig = sigBySigner.get(s.id)
      return {
        id: s.id,
        name: s.name,
        email: s.email,
        role: s.role,
        signedAt: sig?.signedAt ?? s.signedAt ?? null,
        signatureDataUrl: sig?.signatureDataUrl ?? null,
      }
    }),
  })

  if (env?.STORAGE) {
    try {
      const key = await putContractSignedPdf({ STORAGE: env.STORAGE }, doc.id, base64)
      await database.update(schema.contractDocuments)
        .set({ signedStorageKey: key, updatedAt: new Date().toISOString() })
        .where(and(eq(schema.contractDocuments.id, doc.id)))
    } catch (err) {
      // The bytes we already built are returned regardless; a backfill that
      // fails to persist costs the NEXT read a rebuild, not this one.
      console.error('[contract-signed-artifact] R2 backfill failed:', err)
    }
  }

  return base64ToArrayBuffer(base64)
}
