import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { listCollectionItems } from '@/lib/webflow'

export const dynamic = 'force-dynamic'

const BLOG_POSTS_COLLECTION_ID = '685941c739fa006940c9b4de'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { items } = await listCollectionItems(BLOG_POSTS_COLLECTION_ID, { limit: 1, offset: 0 })
  const first = items[0]
  if (!first) return NextResponse.json({ error: 'no items' })
  const keys = Object.keys(first.fieldData ?? {})
  const sample: Record<string, string> = {}
  for (const k of keys) {
    const v = (first.fieldData as Record<string, unknown>)[k]
    sample[k] = typeof v === 'string'
      ? `${v.slice(0, 80)}${v.length > 80 ? '...' : ''} (len=${v.length})`
      : `<${typeof v}>`
  }
  return NextResponse.json({ webflowId: first.id, keys, sample })
}
