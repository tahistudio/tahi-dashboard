/**
 * OpenAI API client — Phase I · Slice 9 duplicate detection.
 *
 * Used to compute embeddings for blog ideas + existing posts so we can
 * flag near-copies during ideation. We use `text-embedding-3-small`
 * (1536-dim, $0.02 per 1M tokens) because:
 *   - It's the cheapest embedding model that still ranks well on
 *     semantic-similarity benchmarks for short text (titles + summaries).
 *   - 1536 dim is small enough to store in D1 without hitting row limits.
 *   - Pricing is so low it's effectively free at our volume (~$0.0001
 *     per article).
 *
 * If `OPENAI_API_KEY` is not set we return a deterministic stub vector
 * derived from the text hash so the duplicate-detection pipeline can
 * still run end-to-end. The stub uses random-looking but stable values
 * keyed on the text so comparisons are at least self-consistent.
 */

export interface EmbeddingResult {
  vector: number[]
  inputTokens: number
  mocked?: boolean
}

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}

export class OpenAIError extends Error {
  constructor(status: number, body: string) {
    super(`OpenAI API ${status}: ${body.slice(0, 300)}`)
    this.name = 'OpenAIError'
  }
}

const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIM = 1536

/** Compute an embedding for a single text. For batch usage call
 *  `embedBatch` to amortise the request overhead. */
export async function embed(text: string): Promise<EmbeddingResult> {
  const [result] = await embedBatch([text])
  return result
}

/** Compute embeddings for many texts in one call. OpenAI accepts up to
 *  2048 inputs per request, but we cap at 100 to stay well under the
 *  request body size limits in CF Workers. */
export async function embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return []

  if (!isOpenAIConfigured()) {
    return texts.map(t => ({
      vector: deterministicStubVector(t),
      inputTokens: 0,
      mocked: true,
    }))
  }

  const apiKey = process.env.OPENAI_API_KEY
  const out: EmbeddingResult[] = []
  for (let i = 0; i < texts.length; i += 100) {
    const slice = texts.slice(i, i + 100)
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: slice,
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new OpenAIError(res.status, body)
    }
    const data = await res.json() as {
      data?: Array<{ embedding: number[]; index: number }>
      usage?: { prompt_tokens?: number }
    }
    const items = data.data ?? []
    const inputTokensTotal = data.usage?.prompt_tokens ?? 0
    const perItemTokens = items.length > 0 ? Math.ceil(inputTokensTotal / items.length) : 0
    // Sort by index so the output order matches the input order.
    items.sort((a, b) => a.index - b.index)
    for (const item of items) {
      out.push({
        vector: item.embedding,
        inputTokens: perItemTokens,
      })
    }
  }
  return out
}

/** Cosine similarity between two equal-length vectors. Returns a number
 *  in [-1, 1]; 1 = identical direction, 0 = orthogonal, -1 = opposite. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`)
  }
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

/** Stable, low-quality stub vector for the no-API-key path. NOT semantic
 *  — only useful so the rest of the pipeline runs and exercises the
 *  comparison code. Real duplicate detection requires the live API. */
function deterministicStubVector(text: string): number[] {
  let seed = 0
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) | 0
  const v = new Array<number>(EMBEDDING_DIM)
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    seed = (seed * 1103515245 + 12345) | 0
    v[i] = ((seed >>> 0) / 0xffffffff - 0.5) * 2
  }
  // Normalise to unit length so cosine similarity behaves predictably.
  let mag = 0
  for (const x of v) mag += x * x
  mag = Math.sqrt(mag)
  if (mag === 0) return v
  for (let i = 0; i < v.length; i++) v[i] /= mag
  return v
}
