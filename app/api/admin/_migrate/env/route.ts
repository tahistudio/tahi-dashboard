// TEMP: env-var dump for the test -> tahi-dashboard migration. Delete this whole
// route file once the destination project has been populated. Bearer-token gated
// (TAHI_API_TOKEN). Lists keys explicitly to avoid leaking Webflow Cloud internals.

import { NextRequest, NextResponse } from 'next/server'

const KEYS = [
  'AIRWALLEX_ACCOUNT_ID',
  'AIRWALLEX_API_KEY',
  'AIRWALLEX_CLIENT_ID',
  'AIRWALLEX_ORG_ID',
  'ANTHROPIC_API_KEY',
  'BUFFER_API_KEY',
  'CLERK_SECRET_KEY',
  'ENCRYPTION_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'MAILERLITE_API_KEY',
  'NEXT_PUBLIC_BASEPATH',
  'NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL',
  'NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_CLERK_SIGN_IN_URL',
  'NEXT_PUBLIC_CLERK_SIGN_UP_URL',
  'NEXT_PUBLIC_TAHI_ORG_ID',
  'OPENAI_API_KEY',
  'OPEN_EXCHANGE_RATES_APP_ID',
  'PERPLEXITY_API_KEY',
  'REPLICATE_API_TOKEN',
  'RESEND_API_KEY',
  'RESEND_FROM_EMAIL',
  'SE_RANKING_API_KEY',
  'SE_RANKING_PROJECT_ID',
  'SLACK_APP_ID',
  'SLACK_BOT_TOKEN',
  'SLACK_CLIENT_ID',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'STRIPE_RESTRICTED_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TAHI_API_TOKEN',
  'TAHI_CRON_SECRET',
  'WEBFLOW_BLOG_COLLECTION_ID',
  'WEBFLOW_FAQ_COLLECTION_ID',
  'WEBFLOW_GLOSSARY_COLLECTION_ID',
  'WEBFLOW_SITE_ID',
  'WEBFLOW_TOKEN',
  'XERO_CLIENT_ID',
  'XERO_CLIENT_SECRET',
  'XERO_TENANT_ID',
] as const

const SECRET_KEYS = new Set([
  'AIRWALLEX_API_KEY',
  'ANTHROPIC_API_KEY',
  'BUFFER_API_KEY',
  'CLERK_SECRET_KEY',
  'ENCRYPTION_KEY',
  'GOOGLE_CLIENT_SECRET',
  'MAILERLITE_API_KEY',
  'OPENAI_API_KEY',
  'PERPLEXITY_API_KEY',
  'REPLICATE_API_TOKEN',
  'RESEND_API_KEY',
  'SE_RANKING_API_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_CLIENT_SECRET',
  'SLACK_SIGNING_SECRET',
  'STRIPE_RESTRICTED_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TAHI_CRON_SECRET',
  'WEBFLOW_TOKEN',
  'XERO_CLIENT_SECRET',
])

function quote(value: string): string {
  if (value === '') return ''
  return /[\s"#'`$\\]/.test(value) ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token || !process.env.TAHI_API_TOKEN || token !== process.env.TAHI_API_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const format = req.nextUrl.searchParams.get('format') ?? 'env'

  const values: Record<string, { value: string; secret: boolean; present: boolean }> = {}
  for (const key of KEYS) {
    const v = process.env[key] ?? ''
    values[key] = { value: v, secret: SECRET_KEYS.has(key), present: v !== '' }
  }

  if (format === 'json') {
    return NextResponse.json(values)
  }

  if (format === 'audit') {
    const lines = KEYS.map(k => {
      const e = values[k]
      const flag = e.present ? 'OK ' : 'EMPTY'
      const tag = e.secret ? 'secret' : 'plain '
      return `${flag}  ${tag}  ${k}`
    })
    return new NextResponse(lines.join('\n'), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  const text = KEYS.map(k => `${k}=${quote(values[k].value)}`).join('\n') + '\n'
  return new NextResponse(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename=".env.migration"',
    },
  })
}
