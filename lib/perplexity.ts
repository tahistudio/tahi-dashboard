/**
 * Perplexity API client — Phase I · Slice 9 researcher.
 *
 * Used in the Research phase of the round-table drafting pipeline to
 * gather fresh, citation-backed information for a target topic before
 * the Strategist sets the article brief.
 *
 * Sonar Pro is the right model for blog research:
 *   - returns citations (URLs) alongside the synthesised answer
 *   - latest web index, not a frozen training cutoff
 *   - structured-friendly: respond_format JSON works
 *
 * If `PERPLEXITY_API_KEY` is not set we return a stub response so the
 * pipeline can still run end-to-end with `MOCK_AI=true`. The orchestrator
 * checks `isPerplexityConfigured()` and surfaces a settings banner if not.
 *
 * Cost: tracked via lib/ai-cost.ts — input/output token usage is in
 * the Perplexity response under `usage.{prompt_tokens, completion_tokens}`.
 */

export interface PerplexityCitation {
  url: string
  title?: string
}

export interface PerplexityResponse {
  content: string
  citations: PerplexityCitation[]
  usage: {
    inputTokens: number
    outputTokens: number
  }
  mocked?: boolean
}

export function isPerplexityConfigured(): boolean {
  return Boolean(process.env.PERPLEXITY_API_KEY)
}

export class PerplexityError extends Error {
  constructor(status: number, body: string) {
    super(`Perplexity API ${status}: ${body.slice(0, 300)}`)
    this.name = 'PerplexityError'
  }
}

interface AskOptions {
  /** Sonar Pro by default. Use 'sonar' for cheaper non-pro lookups. */
  model?: 'sonar-pro' | 'sonar'
  /** Soft cap, default 1200 tokens. Sonar usually returns less. */
  maxOutputTokens?: number
  /** Optional system prompt; defaults to a research-focused one. */
  system?: string
  /** Search recency cap (e.g. 'month' biases toward fresh sources). */
  searchRecency?: 'day' | 'week' | 'month' | 'year'
}

const DEFAULT_SYSTEM = [
  'You are a senior research assistant gathering source material for a Webflow agency\'s blog.',
  'Return concise, factual findings backed by citations from authoritative sources.',
  'Prefer sources from the last 12 months unless evergreen.',
  'If the question is ambiguous, narrow to the angle most useful for an article aimed at decision-makers (CTOs, founders, marketing heads).',
  'Do not include opinion or speculation.',
].join(' ')

/** Single research query. Returns the synthesised answer + list of
 *  cited URLs. Use multiple calls for a multi-angle research brief. */
export async function ask(question: string, options: AskOptions = {}): Promise<PerplexityResponse> {
  if (!isPerplexityConfigured()) {
    return {
      content: `[MOCK] Research findings for: ${question}\n\nIn production this would return fresh web-sourced findings with citations.`,
      citations: [
        { url: 'https://www.tahi.studio', title: 'Tahi Studio (mock citation)' },
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
      mocked: true,
    }
  }

  const apiKey = process.env.PERPLEXITY_API_KEY
  const model = options.model ?? 'sonar-pro'
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: options.system ?? DEFAULT_SYSTEM },
        { role: 'user', content: question },
      ],
      max_tokens: options.maxOutputTokens ?? 1200,
      temperature: 0.2,
      ...(options.searchRecency
        ? { search_recency_filter: options.searchRecency }
        : {}),
      return_citations: true,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new PerplexityError(res.status, body)
  }
  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>
    citations?: string[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const content = data.choices?.[0]?.message?.content ?? ''
  const citationUrls = data.citations ?? []
  return {
    content,
    citations: citationUrls.map((u: string) => ({ url: u })),
    usage: {
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    },
  }
}

/** Research brief — runs N targeted queries in parallel and aggregates
 *  findings + dedupes citations. The orchestrator calls this once per
 *  draft before handing to the Strategist. */
export async function buildResearchBrief(topic: string, angle?: string): Promise<{
  topic: string
  angle: string | null
  sections: Array<{ question: string; content: string; citations: PerplexityCitation[] }>
  allCitations: PerplexityCitation[]
  totalUsage: { inputTokens: number; outputTokens: number }
  mocked: boolean
}> {
  const angleFragment = angle ? ` (angle: ${angle})` : ''
  const questions = [
    `What are the most recent statistics, surveys, or studies on ${topic}${angleFragment}? Cite each.`,
    `What are the top-ranking articles on Google for "${topic}" right now? Summarise their angles and what they cover well vs poorly.`,
    `What recent news, product launches, or industry shifts in the last 6 months are relevant to ${topic}?`,
    `What are the most-asked questions about ${topic} on Reddit, forums, and "People Also Ask"? List the top 8.`,
    `What unique angle on ${topic} would a senior decision-maker find valuable that competitors haven't covered well?`,
  ]
  const results = await Promise.all(questions.map(q => ask(q, { searchRecency: 'month' })))
  const allCitations = new Map<string, PerplexityCitation>()
  for (const r of results) {
    for (const c of r.citations) allCitations.set(c.url, c)
  }
  return {
    topic,
    angle: angle ?? null,
    sections: questions.map((question, i) => ({
      question,
      content: results[i].content,
      citations: results[i].citations,
    })),
    allCitations: Array.from(allCitations.values()),
    totalUsage: results.reduce(
      (sum, r) => ({
        inputTokens: sum.inputTokens + r.usage.inputTokens,
        outputTokens: sum.outputTokens + r.usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    ),
    mocked: results.some(r => r.mocked === true),
  }
}
