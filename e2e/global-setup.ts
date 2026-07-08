import { clerkSetup } from '@clerk/testing/playwright'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

/**
 * Load .env.local into process.env (Playwright's runner does not read it the way
 * `next dev` does). Only fills keys that are not already set, so CI secrets win.
 */
function loadEnvLocal(): void {
  const file = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(file)) return
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

export default async function globalSetup(): Promise<void> {
  loadEnvLocal()
  // clerkSetup looks for CLERK_PUBLISHABLE_KEY + CLERK_SECRET_KEY. Mirror the
  // Next public var if only that is present.
  if (!process.env.CLERK_PUBLISHABLE_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    process.env.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  }
  // If keys are absent (e.g. a CI job without Clerk secrets), skip: the persona
  // specs guard on the same condition and will skip rather than hard-fail.
  if (!process.env.CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    console.warn('[e2e] Clerk keys not found; Clerk-dependent specs will skip.')
    return
  }
  await clerkSetup()
}
