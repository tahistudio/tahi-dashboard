/**
 * Import markdown docs from Tahi Studio OS into the Tahi Dashboard docs hub.
 *
 * Usage:
 *   npx tsx scripts/import-docs.ts
 *
 * Prerequisites:
 *   - Dashboard dev server running at http://localhost:3000
 *   - You must be signed in as a Tahi admin (the script needs a valid session cookie)
 *
 * Since we cannot easily pass Clerk auth cookies from CLI, this script
 * can alternatively be run by pasting the output JSON into the API manually,
 * or by setting the TAHI_SESSION_TOKEN env var.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

const DOCS_DIR = 'C:/Users/Work/Projects/Tahi Docs/tahi-studio-os'
const API_URL = 'http://localhost:3000/api/admin/docs/import'

// Map folder names to doc categories
const CATEGORY_MAP: Record<string, string> = {
  foundation: 'Brand',
  operations: 'Operations',
  marketing: 'Brand',
  legal: 'Operations',
  website: 'Product',
}

// Map folder names to parent page titles
const PARENT_MAP: Record<string, string> = {
  foundation: 'Foundation',
  operations: 'Operations',
  marketing: 'Marketing',
  legal: 'Legal',
  website: 'Website',
}

interface DocPage {
  title: string
  category: string
  content: string
  parentTitle: string | null
  position: number
}

function toTitleCase(str: string): string {
  return str
    .split(/[\s-]+/)
    .map((word) => {
      // Keep small words lowercase unless first word
      const lower = word.toLowerCase()
      if (['and', 'or', 'the', 'a', 'an', 'in', 'of', 'for', 'to', 'at'].includes(lower)) {
        return lower
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
    // Capitalize first letter always
    .replace(/^./, (c) => c.toUpperCase())
}

function extractTitle(filename: string): string {
  // Remove extension
  const base = path.basename(filename, '.md')
  // Remove leading number prefix like "01-", "02b-", "18a-"
  const withoutPrefix = base.replace(/^\d+[a-z]?-/, '')
  return toTitleCase(withoutPrefix)
}

function extractPosition(filename: string): number {
  const base = path.basename(filename, '.md')
  const match = base.match(/^(\d+)/)
  return match ? parseInt(match[1], 10) : 99
}

function collectFiles(dir: string, parentFolder: string | null): DocPage[] {
  const pages: DocPage[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      // Recurse into subdirectories, using the subfolder name as a sub-parent
      const subPages = collectFiles(fullPath, parentFolder)
      // For nested dirs (like website/copy), prefix the parent
      for (const p of subPages) {
        if (parentFolder) {
          p.parentTitle = PARENT_MAP[parentFolder] ?? toTitleCase(parentFolder)
        }
        pages.push(p)
      }
    } else if (entry.name.endsWith('.md')) {
      const title = extractTitle(entry.name)
      const content = fs.readFileSync(fullPath, 'utf-8')
      const folderName = parentFolder ?? path.basename(dir)
      const category = CATEGORY_MAP[folderName] ?? 'Operations'
      const parentTitle = PARENT_MAP[folderName] ?? null

      pages.push({
        title,
        category,
        content,
        parentTitle,
        position: extractPosition(entry.name),
      })
    }
  }

  return pages
}

async function main() {
  console.log(`Reading docs from: ${DOCS_DIR}`)

  if (!fs.existsSync(DOCS_DIR)) {
    console.error(`Directory not found: ${DOCS_DIR}`)
    process.exit(1)
  }

  const allPages: DocPage[] = []
  const topEntries = fs.readdirSync(DOCS_DIR, { withFileTypes: true })

  for (const entry of topEntries) {
    const fullPath = path.join(DOCS_DIR, entry.name)

    if (entry.isDirectory()) {
      const folderPages = collectFiles(fullPath, entry.name)
      allPages.push(...folderPages)
    } else if (entry.name.endsWith('.md')) {
      // Root-level files (like growth-priorities-2026.md)
      const title = extractTitle(entry.name)
      const content = fs.readFileSync(fullPath, 'utf-8')
      allPages.push({
        title,
        category: 'Operations',
        content,
        parentTitle: null,
        position: extractPosition(entry.name),
      })
    }
  }

  // Sort by position within each parent group
  allPages.sort((a, b) => a.position - b.position)

  console.log(`Found ${allPages.length} doc pages:`)
  for (const p of allPages) {
    const parent = p.parentTitle ? ` (under ${p.parentTitle})` : ''
    console.log(`  [${p.category}] ${p.title}${parent}`)
  }

  const payload = JSON.stringify({ pages: allPages }, null, 2)

  // Write payload to a temp file for manual import if API call fails
  const outputPath = path.join(path.dirname(DOCS_DIR), 'import-payload.json')
  fs.writeFileSync(outputPath, payload, 'utf-8')
  console.log(`\nPayload written to: ${outputPath}`)

  // Attempt API call
  const sessionToken = process.env.TAHI_SESSION_TOKEN
  if (!sessionToken) {
    console.log('\nNo TAHI_SESSION_TOKEN set. Skipping API call.')
    console.log('To import via API, either:')
    console.log('  1. Set TAHI_SESSION_TOKEN env var and re-run')
    console.log('  2. POST the payload from import-payload.json to:')
    console.log(`     ${API_URL}`)
    console.log('  3. Use the browser console or a tool like curl with your session cookie')
    return
  }

  console.log(`\nSending ${allPages.length} pages to ${API_URL}...`)

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: payload,
    })

    const result = await res.json()

    if (!res.ok) {
      console.error(`API error (${res.status}):`, result)
      process.exit(1)
    }

    console.log('Import successful:', result)
  } catch (err) {
    console.error('Failed to call API:', err)
    console.log('You can manually POST the payload from import-payload.json')
    process.exit(1)
  }
}

main()
