import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface SuggestBody {
  requestTitle?: string
  requestDescription?: string
  category?: string
}

interface AiSuggestion {
  estimatedHours: number
  suggestedPriority: string
  suggestedSteps: string[]
  summary: string
}

/**
 * POST /api/admin/ai/suggest
 *
 * Returns AI-generated suggestions for a request.
 * Currently returns heuristic-based mock data.
 * Wire to Claude API when ready.
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as SuggestBody
  const title = (body.requestTitle ?? '').toLowerCase()
  const desc = (body.requestDescription ?? '').toLowerCase()
  const category = (body.category ?? '').toLowerCase()
  const combined = `${title} ${desc} ${category}`

  // Heuristic estimation based on keywords
  let hours = 6
  let priority: string = 'standard'
  let steps: string[] = []
  let summary = ''

  // Design tasks
  if (combined.includes('design') || combined.includes('ui') || combined.includes('ux') || combined.includes('mockup') || combined.includes('wireframe')) {
    hours = combined.includes('redesign') || combined.includes('overhaul') ? 16 : 8
    priority = combined.includes('urgent') || combined.includes('asap') ? 'urgent' : 'high'
    steps = [
      'Review current design and requirements',
      'Create wireframes or mood board',
      'Build high-fidelity mockup in Figma',
      'Internal design review',
      'Present to client for feedback',
      'Apply revisions and finalize',
    ]
    summary = `This looks like a ${hours > 10 ? 'complex' : 'standard'} design task. Recommend allocating a small track slot.`
  }
  // Development tasks
  else if (combined.includes('develop') || combined.includes('build') || combined.includes('code') || combined.includes('implement') || combined.includes('feature')) {
    hours = combined.includes('complex') || combined.includes('integration') ? 24 : 12
    priority = combined.includes('urgent') || combined.includes('critical') ? 'urgent' : 'high'
    steps = [
      'Review requirements and acceptance criteria',
      'Technical planning and architecture',
      'Implementation',
      'Write unit tests',
      'Code review',
      'QA testing',
      'Deploy to staging',
      'Client sign-off and production deploy',
    ]
    summary = `This appears to be a development task requiring approximately ${hours} hours. Recommend using a large track slot.`
  }
  // Content tasks
  else if (combined.includes('content') || combined.includes('copy') || combined.includes('blog') || combined.includes('write')) {
    hours = 4
    priority = 'standard'
    steps = [
      'Research and outline',
      'Write first draft',
      'Internal review and editing',
      'Client review',
      'Final revisions and publish',
    ]
    summary = 'This is a content task with a relatively short turnaround. Small track is appropriate.'
  }
  // SEO tasks
  else if (combined.includes('seo') || combined.includes('search') || combined.includes('ranking') || combined.includes('keywords')) {
    hours = 8
    priority = 'standard'
    steps = [
      'Keyword research and competitor analysis',
      'On-page SEO audit',
      'Content optimization plan',
      'Implement technical SEO changes',
      'Monitor and report results',
    ]
    summary = 'SEO work typically needs ongoing attention. Consider scheduling a follow-up review in 2-4 weeks.'
  }
  // Default / general
  else {
    hours = 6
    priority = combined.includes('urgent') ? 'urgent' : combined.includes('important') ? 'high' : 'standard'
    steps = [
      'Review requirements with client',
      'Plan approach and timeline',
      'Execute deliverables',
      'Internal QA review',
      'Client review and feedback',
      'Final delivery',
    ]
    summary = `Based on the request details, this looks like a standard task. Estimated at ${hours} hours on a small track.`
  }

  // Adjust for urgency keywords
  if (combined.includes('rush') || combined.includes('urgent') || combined.includes('asap')) {
    priority = 'urgent'
  }

  const suggestion: AiSuggestion = {
    estimatedHours: hours,
    suggestedPriority: priority,
    suggestedSteps: steps,
    summary,
  }

  return NextResponse.json(suggestion)
}
