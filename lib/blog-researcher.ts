/**
 * Blog researcher — Phase I · Slice 2.
 *
 * Pre-write research pass. Asks Claude Sonnet to do 3-5 targeted web
 * searches over the idea + cluster, then returns:
 *   - researchSummary: a UK B2B-flavoured brief the writer can lean on
 *   - candidateCitations: every external URL the researcher cited,
 *     extracted via regex. These are CANDIDATES — the link validator
 *     runs next to filter them down to strict-200 only.
 *
 * Pure function, no DB writes. Caller (the drafting orchestrator)
 * persists the result onto content_drafts.
 *
 * Token budget: ~1500 max for the response itself. The web search tool
 * adds its own input tokens which the API meters separately.
 */

const MODEL = 'claude-sonnet-5'
const MAX_TOKENS = 1500
const MAX_WEB_SEARCH_USES = 5

export interface ResearcherIdea {
  title: string
  angle: string | null
  targetKeyword: string | null
  rationale: string | null
}

export interface ResearcherCluster {
  name: string
  slug: string
  description: string | null
}

export interface ResearcherInput {
  idea: ResearcherIdea
  cluster: ResearcherCluster
}

export interface ResearcherOutput {
  researchSummary: string
  candidateCitations: Array<{ url: string }>
  /** Token usage from the Anthropic response, surfaced so the cost
   *  report can attribute spend back to drafts. */
  inputTokens: number
  outputTokens: number
}

function buildSystemPrompt(cluster: ResearcherCluster): string {
  return `You are a meticulous UK B2B researcher for the "${cluster.name}" cluster on Tahi Studio's blog.

Tahi Studio is a New Zealand Webflow design + development agency targeting UK + NZ + AU enterprise + scale-up clients. Cluster description: ${cluster.description ?? '(no description provided)'}.

YOUR JOB
Use the web_search tool 3-5 times. Build a tight research brief the article writer can lean on. Surface concrete numbers, dated statements, and named sources. Prefer:
  - Government data (gov.uk, ons.gov.uk, stats.govt.nz, abs.gov.au)
  - Industry bodies (Nielsen Norman Group, Baymard Institute, Webflow's own research, Edelman Trust Barometer)
  - Peer-reviewed studies (Nature, ACM, IEEE) when relevant
  - Established trade press (Smashing Magazine, A List Apart, The Verge, FT, Bloomberg)
Avoid SEO-spam roundups, vendor white papers without methodology, and reposts of older stats.

RELIABILITY RULES
1. Every claim MUST cite a real URL you actually opened. Never invent URLs. If you cannot find a source for a claim, drop the claim.
2. "Unknown" is an allowed answer. Hallucination is not.
3. UK English (colour, organise, centre). No em or en dashes — use commas, colons, or full stops.
4. Cite a URL inline next to the claim it supports, in parentheses, like "(https://example.com/page)". The drafting pipeline parses these out.

OUTPUT FORMAT
Plain text, structured as:

<brief>
## Snapshot
2-3 sentences. The state of the topic right now. Include 1-2 concrete numbers with their source URLs in parentheses.

## Key data points
- Bullet 1 with figure + (URL)
- Bullet 2 with figure + (URL)
- Bullet 3 with figure + (URL)
- (4-8 bullets total)

## Tensions / debates
2-3 sentences. Where do credible sources disagree, what is the open question, who's saying what.

## Tahi angle
2-3 sentences. Given the cluster + idea, what is the unique angle Tahi (a NZ Webflow agency working with UK + AU + NZ enterprise) should bring. No marketing fluff — concrete framing.
</brief>

Do not include any text outside the <brief>...</brief> tags. Do not summarise your search process. The next agent only reads what is inside the brief tags plus the URLs you cited.`
}

function buildUserMessage(input: ResearcherInput): string {
  const lines: string[] = []
  lines.push(`Idea title: ${input.idea.title}`)
  if (input.idea.angle) lines.push(`Angle: ${input.idea.angle}`)
  if (input.idea.targetKeyword) lines.push(`Target keyword: ${input.idea.targetKeyword}`)
  if (input.idea.rationale) lines.push(`Rationale: ${input.idea.rationale}`)
  lines.push('')
  lines.push('Run the research and produce the brief.')
  return lines.join('\n')
}

/** Extract candidate citation URLs from the research brief.
 *  Conservative regex — http(s) only, stops at whitespace / closing punct
 *  that commonly trails a URL. Dedupes case-sensitively because URLs are
 *  case-sensitive after the hostname. */
function extractUrls(text: string): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  const re = /https?:\/\/[^\s)>"'`\]]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    // Trim common trailing punctuation that often follows an inline URL
    // in prose — full stop, comma, semicolon, colon. Round brackets are
    // already excluded by the character class above.
    let url = m[0].replace(/[.,;:!?]+$/, '')
    // Drop any stray closing bracket that snuck in.
    url = url.replace(/\]+$/, '')
    if (seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

export async function researchIdea(input: ResearcherInput): Promise<ResearcherOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: buildSystemPrompt(input.cluster),
    messages: [{ role: 'user', content: buildUserMessage(input) }],
    tools: [{
      type: 'web_search_20250305' as const,
      name: 'web_search',
      max_uses: MAX_WEB_SEARCH_USES,
    }],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as { text: string }).text)
    .join('\n')

  // Pull out the inside of <brief>...</brief> if present. If the model
  // returns plain prose without the tags, fall back to the full text.
  const briefMatch = text.match(/<brief>([\s\S]*?)<\/brief>/i)
  const researchSummary = (briefMatch ? briefMatch[1] : text).trim()

  const candidateUrls = extractUrls(researchSummary)
  const candidateCitations = candidateUrls.map(url => ({ url }))

  const usage = response.usage as { input_tokens: number; output_tokens: number }
  return {
    researchSummary,
    candidateCitations,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  }
}
