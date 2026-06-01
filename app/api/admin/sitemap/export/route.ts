/**
 * GET /api/admin/sitemap/export
 *
 * Bundle the entire sitemap (every node + its latest reviews) into a
 * single markdown document. Returned as text/markdown with a
 * Content-Disposition attachment so the browser downloads it.
 *
 * Gated to Liam + Staci.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { asc, desc } from 'drizzle-orm'
import { assertSitemapApiAccess } from '@/lib/sitemap-auth'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface Node {
  id: string
  parentId: string | null
  sortOrder: number
  nodeType: string
  title: string
  slug: string | null
  url: string | null
  purpose: string | null
  icpAudience: string | null
  primaryKeyword: string | null
  aeoIntent: string | null
  positioningVertical: string | null
  successMetric: string | null
  status: string
  specialFeatures: string | null
  designNotes: string | null
  contentNotes: string | null
  targetLaunchDate: string | null
  bodyTiptap: string | null
  updatedAt: string
}

interface Review {
  nodeId: string
  reviewerKey: string
  score: number | null
  summary: string | null
  suggestions: string | null
  critique: string | null
  createdAt: string
}

const STATUS_LABEL: Record<string, string> = {
  idea: 'Idea',
  spec_done: 'Spec done',
  design_done: 'Design done',
  webflow_done: 'Webflow done',
  live: 'Live',
  parked: 'Parked',
}

export async function GET(req: NextRequest) {
  const userId = await assertSitemapApiAccess(req)
  if (!userId) notFound()
  const database = await db()

  const nodes = (await database
    .select()
    .from(schema.sitemapNodes)
    .orderBy(asc(schema.sitemapNodes.sortOrder), asc(schema.sitemapNodes.title))) as Node[]

  const reviews = (await database
    .select()
    .from(schema.sitemapNodeReviews)
    .orderBy(desc(schema.sitemapNodeReviews.createdAt))) as Review[]

  // Latest review per (nodeId, reviewerKey)
  const latestReviewMap = new Map<string, Review>()
  for (const r of reviews) {
    const key = `${r.nodeId}::${r.reviewerKey}`
    if (!latestReviewMap.has(key)) latestReviewMap.set(key, r)
  }

  const md = renderBundle(nodes, latestReviewMap)
  const filename = `tahi-sitemap-${new Date().toISOString().slice(0, 10)}.md`

  return new NextResponse(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

function renderBundle(nodes: Node[], latestReviews: Map<string, Review>): string {
  const childrenOf = new Map<string | null, Node[]>()
  for (const n of nodes) {
    const arr = childrenOf.get(n.parentId) ?? []
    arr.push(n)
    childrenOf.set(n.parentId, arr)
  }
  for (const [, arr] of childrenOf) {
    arr.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
  }

  const lines: string[] = []
  lines.push('# Tahi Studio sitemap bundle')
  lines.push('')
  lines.push(`Exported ${new Date().toISOString()}`)
  lines.push('')
  lines.push(`Nodes: ${nodes.length}. Reviews: ${latestReviews.size}.`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // Tree overview
  lines.push('## Tree')
  lines.push('')
  function walkTree(parentId: string | null, depth: number) {
    const arr = childrenOf.get(parentId) ?? []
    for (const n of arr) {
      const indent = '  '.repeat(depth)
      const status = STATUS_LABEL[n.status] ?? n.status
      lines.push(`${indent}- **${n.title}** (${n.nodeType}, ${status})${n.slug ? ` · /${n.slug}` : ''}`)
      walkTree(n.id, depth + 1)
    }
  }
  walkTree(null, 0)
  lines.push('')
  lines.push('---')
  lines.push('')

  // Per-node detail
  lines.push('## Pages')
  lines.push('')
  for (const n of nodes) {
    lines.push(`### ${n.title}`)
    lines.push('')
    const meta: Array<[string, string | null]> = [
      ['Type', n.nodeType],
      ['Status', STATUS_LABEL[n.status] ?? n.status],
      ['Slug', n.slug],
      ['URL', n.url],
      ['Vertical', n.positioningVertical],
      ['Primary keyword', n.primaryKeyword],
      ['AEO intent', n.aeoIntent],
      ['Target launch', n.targetLaunchDate],
      ['Updated', n.updatedAt],
    ]
    for (const [k, v] of meta) {
      if (v) lines.push(`- **${k}:** ${v}`)
    }
    lines.push('')
    if (n.purpose) {
      lines.push('**Purpose**')
      lines.push('')
      lines.push(n.purpose)
      lines.push('')
    }
    if (n.icpAudience) {
      lines.push('**ICP audience**')
      lines.push('')
      lines.push(n.icpAudience)
      lines.push('')
    }
    if (n.successMetric) {
      lines.push('**Success metric**')
      lines.push('')
      lines.push(n.successMetric)
      lines.push('')
    }
    if (n.specialFeatures) {
      lines.push('**Special features**')
      lines.push('')
      lines.push(n.specialFeatures)
      lines.push('')
    }
    if (n.designNotes) {
      lines.push('**Design notes**')
      lines.push('')
      lines.push(n.designNotes)
      lines.push('')
    }
    if (n.contentNotes) {
      lines.push('**Content notes**')
      lines.push('')
      lines.push(n.contentNotes)
      lines.push('')
    }
    if (n.bodyTiptap) {
      const plain = extractTiptapText(n.bodyTiptap)
      if (plain.trim().length > 0) {
        lines.push('**Freeform notes**')
        lines.push('')
        lines.push(plain)
        lines.push('')
      }
    }

    // Reviews
    const reviewerKeys = ['seo_aeo', 'icp', 'brand_voice', 'cro', 'sales', 'marketing']
    const nodeReviews = reviewerKeys
      .map(k => latestReviews.get(`${n.id}::${k}`))
      .filter((r): r is Review => !!r)
    if (nodeReviews.length > 0) {
      lines.push('**Sub-agent reviews**')
      lines.push('')
      for (const r of nodeReviews) {
        const label = REVIEWER_LABEL[r.reviewerKey] ?? r.reviewerKey
        lines.push(`#### ${label} — ${r.score ?? '?'}/100`)
        lines.push('')
        if (r.summary) lines.push(r.summary)
        if (r.critique) {
          lines.push('')
          lines.push(r.critique)
        }
        if (r.suggestions) {
          try {
            const parsed = JSON.parse(r.suggestions) as Array<{ label: string; detail: string }>
            if (Array.isArray(parsed) && parsed.length > 0) {
              lines.push('')
              lines.push('Suggestions:')
              for (const s of parsed) {
                lines.push(`- **${s.label}** — ${s.detail}`)
              }
            }
          } catch { /* ignore */ }
        }
        lines.push('')
      }
    }

    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

const REVIEWER_LABEL: Record<string, string> = {
  seo_aeo: 'SEO + AEO',
  icp: 'ICP fit',
  brand_voice: 'Brand voice',
  cro: 'CRO',
  sales: 'Sales',
  marketing: 'Marketing',
}

function extractTiptapText(json: string): string {
  try {
    const doc = JSON.parse(json) as unknown
    const out: string[] = []
    function walk(n: unknown) {
      if (!n || typeof n !== 'object') return
      const node = n as { type?: string; text?: string; content?: unknown[] }
      if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
      if (Array.isArray(node.content)) {
        for (const child of node.content) walk(child)
        if (node.type === 'paragraph' || node.type === 'heading') out.push('\n')
      }
    }
    walk(doc)
    return out.join('').replace(/\n{3,}/g, '\n\n').trim()
  } catch {
    return ''
  }
}
