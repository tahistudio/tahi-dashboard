/**
 * POST /api/admin/content/cover/generate
 *
 * Generates a blog cover SVG, uploads it to R2, and returns both the
 * inline SVG body and the dashboard-served URL.
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
 *   {
 *     svg: string,                    // inline body for direct paste / preview
 *     svgUrl: string,                 // dashboard serve URL
 *     storageKey: string,             // R2 key (blog-covers/<slug>-<hash>.svg)
 *     template: CoverTemplate,
 *     filename: string
 *   }
 *
 * Admin-only.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import {
  buildBlogCover,
  getMirroredBrandSvg,
  uploadCoverToR2,
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

    const { env } = await getCloudflareContext({ async: true })
    if (!env?.STORAGE) {
      return NextResponse.json(
        { error: 'Object storage (STORAGE) not configured' },
        { status: 503 },
      )
    }
    const storage = env as unknown as { STORAGE: R2Bucket }

    let brandLogoSvg: string | undefined
    if (body.brandLogoSlug) {
      const mirrored = await getMirroredBrandSvg(
        storage,
        body.brandLogoSlug,
        body.accentColour,
      )
      brandLogoSvg = mirrored ?? undefined
    }

    const out = buildBlogCover({
      title,
      template,
      brandLogoSvg,
      accentColour: body.accentColour,
    })

    const slugForKey = out.filename.replace(/\.svg$/i, '')
    const { storageKey, url } = await uploadCoverToR2(storage, slugForKey, out.svg)

    return NextResponse.json({
      svg: out.svg,
      svgUrl: url,
      storageKey,
      template: out.template,
      filename: out.filename,
    })
  } catch (err) {
    console.error('Cover generate error:', err)
    return NextResponse.json(
      { error: 'Failed to generate cover' },
      { status: 500 },
    )
  }
}
