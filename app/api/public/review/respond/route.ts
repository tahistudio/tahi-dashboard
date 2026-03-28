import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// GET /api/public/review/respond?token=X&answer=yes|defer|no
// Handles the three email CTA actions.
// - yes: marks as in_progress, redirects to review form page
// - defer: sets nextAskAt to +7 days, redirects to a thank-you page
// - no: sets neverAsk=1, redirects to a thank-you page
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const answer = url.searchParams.get('answer')

  if (!token || !answer) {
    return NextResponse.json({ error: 'Missing token or answer' }, { status: 400 })
  }

  if (!['yes', 'defer', 'no'].includes(answer)) {
    return NextResponse.json({ error: 'Invalid answer. Must be yes, defer, or no.' }, { status: 400 })
  }

  const database = await db()

  const submissions = await database
    .select()
    .from(schema.caseStudySubmissions)
    .where(eq(schema.caseStudySubmissions.submissionToken, token))
    .limit(1)

  if (submissions.length === 0) {
    return new Response(htmlPage('Invalid Link', 'This review link is not valid or has expired.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const submission = submissions[0]

  // Check expiry
  if (submission.tokenExpiresAt && new Date(submission.tokenExpiresAt) < new Date()) {
    return new Response(htmlPage('Link Expired', 'This review link has expired. Please contact Tahi Studio for a new link.'), {
      status: 410,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const now = new Date().toISOString()

  if (answer === 'no') {
    await database
      .update(schema.caseStudySubmissions)
      .set({
        outreachStatus: 'declined',
        neverAsk: 1,
        updatedAt: now,
      })
      .where(eq(schema.caseStudySubmissions.id, submission.id))

    return new Response(
      htmlPage('Thank You', 'No worries at all. We appreciate your time working with us. You will not receive any further review requests.'),
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    )
  }

  if (answer === 'defer') {
    const nextAsk = new Date(Date.now() + 7 * 86400000).toISOString()
    await database
      .update(schema.caseStudySubmissions)
      .set({
        outreachStatus: 'deferred',
        nextAskAt: nextAsk,
        updatedAt: now,
      })
      .where(eq(schema.caseStudySubmissions.id, submission.id))

    return new Response(
      htmlPage('No Problem', 'We will check in again in about a week. Thanks for considering it!'),
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    )
  }

  // answer === 'yes'
  await database
    .update(schema.caseStudySubmissions)
    .set({
      outreachStatus: 'in_progress',
      updatedAt: now,
    })
    .where(eq(schema.caseStudySubmissions.id, submission.id))

  // Redirect to the review form page
  const baseUrl = url.origin
  return NextResponse.redirect(`${baseUrl}/review/${token}`)
}

function htmlPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} - Tahi Studio</title>
  <style>
    body {
      font-family: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background-color: #f5f7f5;
      color: #121A0F;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1rem;
    }
    .card {
      background: #ffffff;
      border-radius: 0.75rem;
      padding: 2.5rem;
      max-width: 28rem;
      text-align: center;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.08);
    }
    h1 { font-size: 1.5rem; margin: 0 0 0.75rem; font-weight: 700; color: #5A824E; }
    p { color: #5a6657; font-size: 0.9375rem; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`
}
