/**
 * lib/import/manyrequests/protected-orgs.ts
 *
 * The organisations nothing in this slice may archive, delete or sweep,
 * whatever a caller asks for. The QA client is explicitly kept (it is how the
 * studio smoke-tests the portal) and org_tahi is the internal marker every
 * "is this us" check reads.
 *
 * It lives in its own module so both the org cleanup and the residue sweep can
 * read it without importing each other. cleanup.ts re-exports all three names,
 * so every existing importer keeps working unchanged.
 */

export const PROTECTED_ORG_IDS: readonly string[] = ['org_tahi']
export const PROTECTED_ORG_ID_PREFIXES: readonly string[] = ['d468fd7e']

export function isProtectedOrg(orgId: string): boolean {
  if (PROTECTED_ORG_IDS.includes(orgId)) return true
  return PROTECTED_ORG_ID_PREFIXES.some((prefix) => orgId.startsWith(prefix))
}
