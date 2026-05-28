/**
 * Centralised Claude model IDs.
 *
 * Hardcoding model strings across 17 files means a model bump (e.g. Opus
 * 4.7 -> 4.8) is a risky 17-file find-replace where one typo'd ID 404s
 * every call. Instead everything reads from here, and each is overridable
 * by an env var so a model swap is a single Webflow env change with zero
 * code edits + zero deploy.
 *
 * Defaults stay on the known-good IDs. To move the content engine to a
 * new Opus, set ANTHROPIC_OPUS_MODEL to the exact published ID (confirm
 * it in console.anthropic.com / the model docs first — a wrong ID breaks
 * every call) and it propagates everywhere that imports OPUS_MODEL.
 */

export const OPUS_MODEL = process.env.ANTHROPIC_OPUS_MODEL ?? 'claude-opus-4-7'
export const SONNET_MODEL = process.env.ANTHROPIC_SONNET_MODEL ?? 'claude-sonnet-4-6'
export const HAIKU_MODEL = process.env.ANTHROPIC_HAIKU_MODEL ?? 'claude-haiku-4-5'
