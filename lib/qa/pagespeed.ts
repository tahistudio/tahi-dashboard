/** PageSpeed Insights summary for SQA round pages. Parser is pure; runPageSpeed wraps one fetch. */

export interface PsiSummary { score: number | null; lcpMs: number | null; cls: number | null; inpMs: number | null; tbtMs: number | null; source: 'field' | 'lab'; fetchedAt: string }

type Json = Record<string, unknown>
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {})

export function parsePageSpeed(body: unknown, now = new Date().toISOString()): PsiSummary {
  const root = obj(body)
  const lh = obj(root.lighthouseResult)
  const perf = obj(obj(lh.categories).performance)
  const audits = obj(lh.audits)
  const field = obj(obj(root.loadingExperience).metrics)
  const fieldLcp = num(obj(field.LARGEST_CONTENTFUL_PAINT_MS).percentile)
  const fieldCls = num(obj(field.CUMULATIVE_LAYOUT_SHIFT_SCORE).percentile)
  const fieldInp = num(obj(field.INTERACTION_TO_NEXT_PAINT).percentile)
  const hasField = fieldLcp !== null
  const scoreRaw = num(perf.score)
  return {
    score: scoreRaw === null ? null : Math.round(scoreRaw * 100),
    lcpMs: hasField ? fieldLcp : num(obj(audits['largest-contentful-paint']).numericValue),
    cls: hasField ? (fieldCls === null ? null : fieldCls / 100) : num(obj(audits['cumulative-layout-shift']).numericValue),
    inpMs: hasField ? fieldInp : null,
    tbtMs: num(obj(audits['total-blocking-time']).numericValue),
    source: hasField ? 'field' : 'lab',
    fetchedAt: now,
  }
}

const PSI_TIMEOUT_MS = 60_000

export async function runPageSpeed(url: string, strategy: 'mobile' | 'desktop', apiKey: string | undefined): Promise<PsiSummary> {
  const q = new URLSearchParams({ url, strategy, category: 'performance' })
  if (apiKey) q.set('key', apiKey)
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q.toString()}`, { signal: AbortSignal.timeout(PSI_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`PageSpeed returned ${res.status}`)
  return parsePageSpeed(await res.json())
}
