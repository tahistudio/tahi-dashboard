/**
 * lib/wizard-hour-estimates.ts
 *
 * The studio's own baseline hours per category and size, used two ways by
 * the request wizard routes: as the HOUR ESTIMATES the system prompt shows
 * the model, and as the number actually written to a draft's
 * `estimatedHours` once the model has picked a category and a type.
 *
 * The second use is the one that matters. A model asked to estimate hours
 * for a fifteen to twenty page design plus a Webflow build plus content
 * once answered "8 hours" for a large task, which is the kind of arithmetic
 * a chat model gets wrong with total confidence. Rather than trust whatever
 * number came back in the JSON block, the routes overwrite it with this
 * table: the model still decides category and size (design vs development,
 * small vs large), but the hours are always the studio's own numbers, never
 * invented.
 *
 * Single source for both wizard routes, which used to carry two copies of
 * this same table (one per file) that could drift apart silently.
 */

export type WizardRequestCategory = 'design' | 'development' | 'content' | 'strategy'
export type WizardRequestType = 'small_task' | 'large_task' | 'bug_fix' | 'new_feature'

const HOURS_BY_CATEGORY_AND_SIZE: Record<WizardRequestCategory, { small: number; large: number }> = {
  design:      { small: 8,  large: 32 },
  development: { small: 12, large: 46 },
  content:     { small: 6,  large: 18 },
  strategy:    { small: 6,  large: 23 },
}

/** bug_fix maps to the small side of its category (a regression is scoped
 *  like a small fix, never like a full rebuild); new_feature maps to large
 *  (a genuinely new capability is never a one-day task). */
export function isLargeWizardType(type: WizardRequestType): boolean {
  return type === 'large_task' || type === 'new_feature'
}

/** The studio's baseline hours for a category and type. Never a guess: this
 *  is the number every draft's estimatedHours is set to, replacing whatever
 *  the model proposed. */
export function estimateRequestHours(category: WizardRequestCategory, type: WizardRequestType): number {
  const bucket = HOURS_BY_CATEGORY_AND_SIZE[category] ?? HOURS_BY_CATEGORY_AND_SIZE.design
  return isLargeWizardType(type) ? bucket.large : bucket.small
}

/** The HOUR ESTIMATES block both system prompts show the model, generated
 *  from the same table so the prompt copy and the enforced number can never
 *  disagree about what "large development" means. */
export function wizardHourEstimatesPromptBlock(): string {
  const lines = (Object.keys(HOURS_BY_CATEGORY_AND_SIZE) as WizardRequestCategory[]).map((category) => {
    const { small, large } = HOURS_BY_CATEGORY_AND_SIZE[category]
    return `- ${category} small: ${small} hours | ${category} large: ${large} hours`
  })
  return lines.join('\n')
}
