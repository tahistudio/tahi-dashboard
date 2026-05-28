/**
 * POST /api/admin/content/cover/preview
 *
 * Generates a blog cover SVG and returns it inline (no R2 upload).
 * Used by the dashboard preview UI before Liam commits to uploading.
 *
 * Body:
 *   {
 *     title: string,                  // required, drives template auto-pick
 *     template?: CoverTemplate,       // optional override
 *     brandLogoSlug?: string,         // optional Simple Icons slug
 *     accentColour?: string           // optional hex (with or without #)
 *   }
 *
 * Returns:
 *   { svg: string, template: CoverTemplate, filename: string }
 *
 * Admin-only.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import {
  buildBlogCover,
  getMirroredBrandSvg,
  type CoverTemplate,
} from '@/lib/blog-cover'

export const dynamic = 'force-dynamic'

const VALID_TEMPLATES: ReadonlySet<CoverTemplate> = new Set<CoverTemplate>([
  'shield',
  'stacked-cards',
  'agency-list',
  'pricing-compare',
  'abstract-flow',
])

interface RequestBody {
  title?: string
  template?: string
  brandLogoSlug?: string
  accentColour?: string
}

export async function POST(req: NextRequest) {
  try {
    const { userId, orgId } = await getRequestAuth(req)
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    }
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as RequestBody
    const title = (body.title ?? '').trim()
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    let template: CoverTemplate | undefined
    if (body.template) {
      if (!VALID_TEMPLATES.has(body.template as CoverTemplate)) {
        return NextResponse.json(
          { error: `Invalid template. One of: ${[...VALID_TEMPLATES].join(', ')}` },
          { status: 400 },
        )
      }
      template = body.template as CoverTemplate
    }

    let brandLogoSvg: string | undefined
    if (body.brandLogoSlug) {
      const { env } = await getCloudflareContext({ async: true })
      if (env?.STORAGE) {
        const mirrored = await getMirroredBrandSvg(
          env as unknown as { STORAGE: R2Bucket },
          body.brandLogoSlug,
          body.accentColour,
        )
        brandLogoSvg = mirrored ?? undefined
      }
    }

    const out = buildBlogCover({
      title,
      template,
      brandLogoSvg,
      accentColour: body.accentColour,
    })

    return NextResponse.json({
      svg: out.svg,
      template: out.template,
      filename: out.filename,
    })
  } catch (err) {
    console.error('Cover preview error:', err)
    return NextResponse.json(
      { error: 'Failed to generate cover preview' },
      { status: 500 },
    )
  }
}
