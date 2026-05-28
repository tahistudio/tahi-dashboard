/**
 * Replicate API client — Phase I · Slice 9 cover generator.
 *
 * Used to generate blog post cover images via Flux 1.1 Pro. The output
 * is a PNG/JPG URL hosted temporarily by Replicate; the caller is
 * responsible for downloading + persisting to R2.
 *
 * If `REPLICATE_API_TOKEN` is not set we return a stub URL so the
 * pipeline runs end-to-end. The orchestrator checks `isReplicateConfigured`
 * and surfaces a settings banner if not.
 *
 * Cost: ~$0.04 per image (Flux 1.1 Pro). Tracked via lib/ai-cost.ts.
 *
 * Note: Replicate's API is asynchronous — we submit a prediction, then
 * poll `prediction.status` until it's `succeeded` or `failed`. We use a
 * tight 60s budget and 1.5s polling interval because Flux is fast.
 */

export interface FluxImageResult {
  url: string
  width: number
  height: number
  predictionId: string
  mocked?: boolean
}

export function isReplicateConfigured(): boolean {
  return Boolean(process.env.REPLICATE_API_TOKEN)
}

export class ReplicateError extends Error {
  constructor(status: number, body: string) {
    super(`Replicate API ${status}: ${body.slice(0, 300)}`)
    this.name = 'ReplicateError'
  }
}

interface FluxOptions {
  /** Square is the default cover ratio for our blog. */
  aspectRatio?: '1:1' | '16:9' | '4:3' | '3:2' | '2:3' | '3:4' | '9:16'
  /** Output format. JPG is smaller but PNG keeps transparency where it appears.
   *  Webflow handles both. */
  outputFormat?: 'webp' | 'jpg' | 'png'
  /** Quality 1-100. 80 is a good blog-cover default. */
  outputQuality?: number
  /** Brand seed. Pass a stable integer per cluster to keep style consistent
   *  across articles in the same series. */
  seed?: number
  /** Hard cap for the poll loop. Default 60s. */
  timeoutMs?: number
}

// Tuned to the hand-designed reference covers: deep forest base, brand
// green diamond gradient, abstract flat editorial illustration, gold +
// Webflow-blue + cream accents, generous negative space, and absolutely
// no text (Flux can't render clean type — text is the #1 failure mode).
const BRAND_PROMPT_PREFIX = [
  'Minimal flat vector editorial illustration for a premium blog cover.',
  'Deep forest green background (#2A3626) with a soft diamond-shaped radial gradient glow in sage and brand greens (#7AAB6B, #5A824E, #425F39).',
  'A single clean abstract scene built from simple geometric shapes (rounded cards, browser frame, soft rounded rectangles, circles, gentle arcs).',
  'Accent sparingly with warm gold (#D2A838), Webflow blue (#146EF5), and off-white cream (#E3E6E2).',
  'Calm, considered, lots of negative space, balanced asymmetric composition, subtle depth.',
  'Strictly NO text, NO words, NO letters, NO numbers, NO logos, NO UI screenshots, NO faces, NO people.',
  'Style: modern SaaS brand illustration, flat 2D, crisp edges, no gradients on shapes beyond the background glow.',
].join(' ')

const NEGATIVE_PROMPT = [
  'text, words, letters, numbers, typography, captions, labels, watermark, signature, logo,',
  'photorealistic, photograph, 3d render, realistic,',
  'faces, people, hands,',
  'cluttered, busy, noisy, low quality, blurry, distorted, jpeg artifacts,',
  'ui mockup, screenshot, dashboard,',
].join(' ')

/** Submit a Flux image generation prediction and poll until ready.
 *  `prompt` should be the post's specific subject — the brand prefix
 *  is prepended automatically. */
export async function generateCover(prompt: string, options: FluxOptions = {}): Promise<FluxImageResult> {
  if (!isReplicateConfigured()) {
    return {
      url: 'https://placehold.co/1200x1200/5A824E/ffffff/png?text=Mock+cover',
      width: 1200,
      height: 1200,
      predictionId: 'mock',
      mocked: true,
    }
  }

  const apiKey = process.env.REPLICATE_API_TOKEN
  const fullPrompt = `${BRAND_PROMPT_PREFIX} subject: ${prompt}`
  const aspectRatio = options.aspectRatio ?? '1:1'
  const timeoutMs = options.timeoutMs ?? 60_000

  // 1) Submit prediction.
  const submitRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=30',  // tell Replicate to hold the connection briefly
    },
    body: JSON.stringify({
      input: {
        prompt: fullPrompt,
        aspect_ratio: aspectRatio,
        output_format: options.outputFormat ?? 'jpg',
        output_quality: options.outputQuality ?? 85,
        ...(options.seed != null ? { seed: options.seed } : {}),
        // Negative prompt is supported by some Flux variants — Flux Pro
        // doesn't, but we keep the helper-prompt approach.
      },
    }),
  })
  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => '')
    throw new ReplicateError(submitRes.status, body)
  }
  type Prediction = {
    id: string
    status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
    output?: string | string[]
    error?: string
    urls?: { get?: string }
  }
  let prediction = await submitRes.json() as Prediction
  const predictionId = prediction.id

  // 2) Poll if not done.
  const deadline = Date.now() + timeoutMs
  while (
    prediction.status !== 'succeeded' &&
    prediction.status !== 'failed' &&
    prediction.status !== 'canceled' &&
    Date.now() < deadline
  ) {
    await new Promise(r => setTimeout(r, 1500))
    const getUrl = prediction.urls?.get ?? `https://api.replicate.com/v1/predictions/${predictionId}`
    const pollRes = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!pollRes.ok) {
      const body = await pollRes.text().catch(() => '')
      throw new ReplicateError(pollRes.status, body)
    }
    prediction = await pollRes.json() as Prediction
  }

  if (prediction.status !== 'succeeded') {
    throw new ReplicateError(0, `Prediction ended in status=${prediction.status}: ${prediction.error ?? ''}`)
  }
  const out = prediction.output
  const url = Array.isArray(out) ? out[0] : out
  if (!url) throw new ReplicateError(0, 'Prediction succeeded but no output URL returned')

  // Flux 1.1 Pro returns aspect-ratio-correct images at ~1024 base.
  // We don't get exact dimensions back unless we HEAD the image; for now
  // hardcode based on aspectRatio because covers downstream just need
  // approximate width/height for schema. Refine later if needed.
  const dimsForRatio: Record<string, { width: number; height: number }> = {
    '1:1':  { width: 1024, height: 1024 },
    '16:9': { width: 1344, height: 768 },
    '4:3':  { width: 1152, height: 896 },
    '3:2':  { width: 1216, height: 832 },
    '2:3':  { width: 832, height: 1216 },
    '3:4':  { width: 896, height: 1152 },
    '9:16': { width: 768, height: 1344 },
  }
  const dims = dimsForRatio[aspectRatio] ?? { width: 1024, height: 1024 }
  return {
    url,
    width: dims.width,
    height: dims.height,
    predictionId,
  }
}
