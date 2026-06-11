export const meta = {
  name: 'homepage-redesign-exploration',
  description: 'Per-card design exploration + composition stances + Fable synthesis for the Tahi admin homepage',
  phases: [
    { title: 'Explore', detail: '17 per-card designers (Opus) + 3 composition stances (Fable), in parallel' },
    { title: 'Synthesize', detail: 'Fable merges everything into one recommended redesign + open decisions' },
  ],
}

// ── Shared grounding ─────────────────────────────────────────────────────────
const CONTEXT = `
TAHI ADMIN HOMEPAGE REDESIGN — GROUNDING

WHAT THIS IS: The admin "Overview" homepage of the Tahi Dashboard. Primary user is
Liam, founder/super-admin of Tahi Studio (a 2-founder premium New Zealand Webflow
studio: Liam + Staci, no other staff). He opens this to glance at his whole business:
money, clients, requests, deals, calls, capacity, tasks. It is a DAILY DRIVER and also
a SHOWCASE that must feel like a $50,000 purchase.

THE AUDIENCE'S TASTE (the bar to clear): Tahi sells to enterprise marketing leaders /
CMOs at Stripe / ElevenLabs-tier SaaS (AI, data, healthtech, dev tools, cybersecurity).
They ship products where "the home page is essentially a product surface" and "the
marketing site has to look as good as the product and behave like real software." They
are stressed, time-poor, attribution-murky, and they value craft + evidence that real
humans are doing real work. They love Linear, Stripe, Vercel, Attio, Raycast, Mercury,
Ramp. They instantly smell "AI slop" (generic icon + number + label cards, purple
gradients, evenly-weighted everything, no point of view).

BRAND + DESIGN SYSTEM (hard constraints — design WITHIN these, do not invent a new look):
- Font: Manrope (200-800). Figures use tabular-nums.
- Colour: brand greens (#5A824E / #425F39 / #7aab6b / #f0f7ee). Warm-sand canvas
  (#F7F6F3 light, #131211 dark). Cards a clean step off the canvas. ONE accent does the
  work; green is the signal colour. Amber = warning only, red = error/overdue only.
- Depth: BORDERS NOT SHADOWS. Alpha borders (rgba ink). No drop shadows on in-flow cards
  (shadows reserved for true floating overlays). Dark mode is a real 4-level elevation.
- Leaf radius: 0 1rem 0 1rem (the signature asymmetric corner) for icon backings, hero
  tiles, primary CTAs. Not every card.
- Motion ladder: 70 / 110 / 150 / 240 / 400 ms with --ease-productive cubic-bezier(0.2,0,0.38,0.9).
  Reveal-up stagger ONCE per session. CountUp on LEAD numbers only. tahi-border-trace
  (a clockwise conic border light on hover) exists as a SCARCE signature — at most one
  card wears it. Animated lucide icons on hover, used sparingly.
- Privacy: Private mode blurs every [data-private] element. Every client name and every
  money figure must be able to carry data-private.
- Tokens only. No hardcoded hex outside the token vocabulary. No em/en dashes anywhere.
- Fully responsive: 375px (no horizontal scroll, 44px touch targets) and dark mode must
  both stay premium.

PERSONALITY SEED BANK (Tahi-true ideas already specced — draw on these for character,
do not feel limited to them): Edition Numbers (every delivery sequentially numbered, "No.
014"), Growing Leaf (a single-stroke leaf glyph that draws itself as work advances),
Workshop Light ("in the studio right now" live pulse when a timer runs), While You Slept
(overnight delta ribbon — NZ works while US/EU clients sleep), Annual Rings (engagement
as tree growth rings), Two Clocks (NZ + client timezone), Board-Ready Receipts, Studio
Notes (margin notes from Liam/Staci), Southern Seasons (NZ-hemisphere seasonal empty
states), Command palette (Cmd+K), Instant Second Visit (never-skeleton warm loads). The
leaf is the brand mark; New Zealand / Southern-hemisphere / real-craft is the soul.

VISUAL REFERENCES the user explicitly loves (translate the FEELING, not the literal style).
THE NORTH-STAR SET — the user named these directly as "great things": Clay, Notion, Stripe,
Vercel, ElevenLabs.
- Clay (the CRM): warm, tactile, almost editorial. Soft gradient texture, human presence,
  relationship-first, feels personal and crafted rather than corporate. The closest match
  to Tahi's "real humans, warmth, craft" goal. Steal: warmth + texture + people-forward.
- Notion: calm, content-first, friendly, flexible, never shouty. Steal: quiet confidence,
  generous type, nothing fighting for attention.
- Stripe: precision and restraint. World-class typography, immaculate spacing, subtle
  purposeful motion, money rendered beautifully. Steal: typographic craft + tabular money.
- Vercel: stark, confident, minimal. High contrast, crisp edges, monochrome with one
  decisive accent. Steal: bold confidence + ruthless reduction.
- ElevenLabs (an actual Tahi ICP exemplar): modern product-surface polish; the marketing
  site behaves like the product. Steal: product-grade fit-and-finish.
- Donezo task dashboard: calm task cards, crisp hierarchy, one clear next-action per card.
- Crextio HR dashboard: big confident numbers, avatar/people stacks, organized-but-playful,
  generous whitespace.
THE TENSION TO RESOLVE: Stripe/Vercel pull toward restraint; Clay/Crextio pull toward warmth
and personality. Tahi lives where those meet: restrained craft with genuine warmth and a
New Zealand studio soul. Not cold, not cute.

THE 17 SURFACES CURRENTLY ON THE HOMEPAGE (the inventory):
1. greeting — "Welcome back, Liam" + date + quick actions (New Request / Add Client / Log Time). Form: plain header row.
2. next_call — the next upcoming meeting (contact email, datetime, duration, join link). Form: forest-green gradient tile, top-left of two top tiles.
3. closing_month — deals expected to close this month (often "Nothing closing yet"). Form: light-green tile, top-right.
4. mrr — monthly recurring revenue (NZ$). Form: FILLED forest-green hero KPI tile, CountUp + border-trace. gate: financial_reports.
5. active_clients — count of active clients. Form: light KPI tile. gate: clients.
6. open_requests — count open + count in progress. Form: light KPI tile. gate: requests.
7. outstanding — outstanding invoices (NZ$). Form: light KPI tile. gate: invoices.
8. ai_briefing — AI-generated one-line "what needs attention today". Form: full-width strip, refresh + expand. gate: overview.
9. off_track — engagements/schedules that have slipped (alert). gate: schedules.
10. recent_requests — last 5 requests (status, title, org, type, priority, updated). Form: list card, 7-col. gate: requests.
11. upcoming_calls — next few calls (contact, datetime, join). Form: list card, 5-col. gate: calls.
12. pipeline_summary — pipeline value / weighted value / closing this month (3 stat cells). gate: deals.
13. pipeline_forecast — weighted upfront, weighted MRR, active deals, 12-mo expected + per-stage probability bars. Form: card, 7-col. gate: deals.
14. team_capacity — available/pipeline/forecast hours + ProgressRing % + per-member rows. Form: card, 5-col. gate: capacity.
15. cash_position — total cash, runway months, monthly burn. Form: 3 stat tiles, 7-col (NEW). gate: financial_reports.
16. receivables — total outstanding + oldest-overdue badge + aged bucket bars. Form: card, 5-col (NEW). gate: invoices.
17. open_tasks — up to 6 open internal tasks (title, org, priority, due) as a 3-up chip grid, 12-col (NEW). gate: tasks.

EVERY card is permission-gated (a <Gate feature="...">). Liam (super_admin) sees all.
The grid is a 12-col dense bento today. The honest problem: it reads like a competent
SaaS dashboard, not like a $50k crafted studio product. It lacks a point of view,
hierarchy beyond the MRR tile, and any real personality.

FILES you may Read for exact fidelity (use them):
- app/(dashboard)/overview/overview-content.tsx (current implementation)
- app/globals.css (every token + the delight keyframes)
- SPECS/dashboard-delight-first-run.md (the full design spec + 12-concept bank)
`

// ── The 17 cards to fan out over ─────────────────────────────────────────────
const CARDS = [
  ['greeting', 'Greeting + quick actions', 'user name, date, primary actions (New Request / Add Client / Log Time)'],
  ['next_call', 'Next call', 'the single next upcoming meeting: who, when, duration, join link'],
  ['closing_month', 'Closing this month', 'deals expected to close this month (value + count, often empty)'],
  ['mrr', 'MRR (monthly recurring revenue)', 'one big money figure; today the green hero tile'],
  ['active_clients', 'Active clients', 'a single count of active clients'],
  ['open_requests', 'Open requests', 'count of open requests, with how many are in progress'],
  ['outstanding', 'Outstanding invoices', 'total unpaid invoices in NZ$'],
  ['ai_briefing', 'AI Daily Briefing', 'an AI-written one-liner of what needs attention today'],
  ['off_track', 'Off-track engagements', 'delivery schedules that have slipped past plan (an alert)'],
  ['recent_requests', 'Recent requests', 'last 5 requests: status, title, client, type, priority, last-updated'],
  ['upcoming_calls', 'Upcoming calls', 'the next few scheduled calls: who, when, join'],
  ['pipeline_summary', 'Pipeline summary', 'pipeline value, probability-weighted value, value closing this month'],
  ['pipeline_forecast', 'Pipeline forecast', 'weighted upfront + weighted MRR + active deal count + 12-mo expected, plus per-stage probability bars'],
  ['team_capacity', 'Team capacity', 'available vs allocated hours, a utilisation %, and a per-team-member roster'],
  ['cash_position', 'Cash position', 'total bank cash, months of runway, trailing monthly burn'],
  ['receivables', 'Receivables (AR aging)', 'total outstanding, the oldest overdue invoice, and amounts bucketed by age'],
  ['open_tasks', 'Open tasks', 'up to 6 open internal Tahi tasks: title, client, priority, due date'],
]

const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cardId', 'verdict', 'isCardRightContainer', 'recommendedForm', 'formRationale', 'personalityTrait', 'microinteraction', 'oneLine'],
  properties: {
    cardId: { type: 'string' },
    verdict: { type: 'string', description: 'a sharp, specific critique of the current treatment of THIS card' },
    isCardRightContainer: { type: 'string', description: 'is a bordered card even the right container for this data? card / stat-tile / inline-strip / full-bleed / merged-into-another / other, with one line why' },
    recommendedForm: { type: 'string', description: 'the single best way to present this data (be concrete: layout, what is the hero element, what is secondary)' },
    formRationale: { type: 'string' },
    alternativeForms: { type: 'array', items: { type: 'string' }, description: '1-3 other forms considered and why rejected' },
    personalityTrait: { type: 'string', description: 'the ONE signature/unique element that gives this card Tahi character and would make a CMO say "real software, made by people who care"' },
    microinteraction: { type: 'string', description: 'the specific hover/load/state-change motion, with token timings' },
    dataChanges: { type: 'string', description: 'what data to add, drop, or compute that would make this more useful' },
    emptyState: { type: 'string', description: 'what the empty/zero state should be' },
    mobileNote: { type: 'string', description: 'how it adapts at 375px' },
    oneLine: { type: 'string', description: 'one-sentence summary of the redesign' },
  },
}

const COMPOSITION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stance', 'topElement', 'orderedSections', 'asciiBento', 'cardVsInline', 'signatureMoves', 'density', 'mobileStrategy', 'rationale'],
  properties: {
    stance: { type: 'string' },
    topElement: { type: 'string', description: 'what sits at the VERY top and exactly why (greeting? the money? next meeting? the AI briefing? something else?)' },
    orderedSections: {
      type: 'array',
      description: 'the full top-to-bottom order of the homepage',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'cols', 'why'],
        properties: { section: { type: 'string' }, cols: { type: 'string', description: 'column span / sizing' }, why: { type: 'string' } },
      },
    },
    asciiBento: { type: 'string', description: 'an ASCII sketch of the 12-col bento layout, desktop' },
    cardVsInline: { type: 'array', items: { type: 'string' }, description: 'which surfaces should NOT be bordered cards (made inline / strip / merged) and why' },
    signatureMoves: { type: 'array', items: { type: 'string' }, description: '3 to 5 personality / uniqueness moves that give the whole page a point of view' },
    density: { type: 'string', description: 'overall density + whitespace philosophy' },
    mobileStrategy: { type: 'string' },
    rationale: { type: 'string', description: 'why this composition serves a stressed founder + impresses a CMO' },
  },
}

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'topOfPage', 'asciiBento', 'orderedPlan', 'perCard', 'signatureSystem', 'openDecisions', 'buildSlices'],
  properties: {
    headline: { type: 'string', description: 'the one-paragraph design direction' },
    topOfPage: { type: 'string', description: 'the decided answer to "what goes at the top" with rationale' },
    asciiBento: { type: 'string', description: 'the recommended 12-col bento layout as ASCII' },
    orderedPlan: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['section', 'cols', 'note'], properties: { section: { type: 'string' }, cols: { type: 'string' }, note: { type: 'string' } } },
    },
    perCard: {
      type: 'array',
      description: 'final direction for each of the 17 cards',
      items: { type: 'object', additionalProperties: false, required: ['cardId', 'form', 'trait', 'oneLine'], properties: { cardId: { type: 'string' }, form: { type: 'string' }, trait: { type: 'string' }, oneLine: { type: 'string' } } },
    },
    signatureSystem: { type: 'array', items: { type: 'string' }, description: 'the 3-5 unique traits that run ACROSS the whole homepage and make it unmistakably Tahi' },
    openDecisions: {
      type: 'array',
      description: 'the real choices that need Liam to decide',
      items: { type: 'object', additionalProperties: false, required: ['question', 'options', 'recommendation'], properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, recommendation: { type: 'string' } } },
    },
    buildSlices: { type: 'array', items: { type: 'string' }, description: 'a phased, shippable build order' },
  },
}

const STANCES = [
  {
    name: 'The Calm Executive Glance',
    brief: 'Ruthless signal over noise. A stressed founder opens this for 8 seconds. The money and the one-thing-that-needs-me-now dominate; everything else is quiet, collapsed, or earns its place. Generous whitespace, very few accents, Mercury/Stripe-grade restraint. Hierarchy so strong you read it in one saccade.',
  },
  {
    name: 'The Characterful Studio',
    brief: 'Personality-forward and warm. The leaf, real human presence (Liam + Staci avatars, studio voice, "in the studio now"), Southern-hemisphere soul, edition numbers, growing-leaf progress. Organized-but-playful like Crextio. The page should feel hand-made by a real NZ studio, not generated. This is the stance that most answers "it feels boring / it needs uniqueness and traits."',
  },
  {
    name: 'The Operational Command Center',
    brief: 'Density + speed, Linear / Attio / Raycast-grade. Command palette (Cmd+K), keyboard-first, lots of live data exquisitely organized and scannable, fast warm loads (never-skeleton second visit), a real information architecture. Impressive to a senior product person who lives in tools like this. Earns its density through craft, never clutter.',
  },
]

// ── Phase: Explore (cards + compositions in one barrier) ─────────────────────
phase('Explore')
log(`Spawning ${CARDS.length} per-card designers (Opus) + ${STANCES.length} composition stances (Fable)`)

const cardThunks = CARDS.map(([id, title, data]) => () =>
  agent(
    `${CONTEXT}

YOU ARE THE DEDICATED DESIGNER FOR EXACTLY ONE CARD. Think about nothing else.

CARD: ${id} — "${title}"
DATA IT SHOWS: ${data}

Reconsider this card from first principles for the audience and brand above:
- Is a bordered card even the right container, or should this be a stat tile, an inline
  strip, a full-bleed band, or merged into a neighbour?
- What is the single most useful AND most beautiful way to present this data to a
  time-poor founder glancing at it, that also makes a Stripe/ElevenLabs-tier CMO think
  "this is real, crafted software"?
- Give it ONE signature personality trait, true to Tahi (NZ studio, the leaf, real humans,
  craft, warmth) and drawn from or inspired by the personality seed bank. Avoid AI-slop
  (generic icon + number + label). Be bold and specific, not safe.
- Specify the microinteraction with real token timings, the empty/zero state, the mobile
  adaptation, and any data you would add or drop.

You may Read app/(dashboard)/overview/overview-content.tsx and app/globals.css for exact
current treatment and available tokens. Return ONLY the structured object.`,
    { label: `card:${id}`, phase: 'Explore', model: 'opus', schema: CARD_SCHEMA },
  ).then(r => (r ? { kind: 'card', cardId: id, title, result: r } : null)),
)

const compositionThunks = STANCES.map((s, i) => () =>
  agent(
    `${CONTEXT}

YOU ARE A LEAD PRODUCT DESIGNER proposing the WHOLE homepage composition from one distinct
stance. Commit fully to your stance; do not hedge toward the others.

YOUR STANCE: "${s.name}"
${s.brief}

Decide and justify, for the 17 surfaces above:
- TOP OF PAGE: what sits at the very top and why. Challenge the current default
  (greeting + two meeting/closing tiles + KPI row). Should the money lead? The next
  meeting? An AI briefing? A "while you slept" delta? Be opinionated.
- ORDER: the full top-to-bottom sequence and the column sizing of each block.
- BENTO OR NOT: is a dense 12-col bento right, or a calmer rhythm of full-width sections,
  or a hybrid? Sketch the desktop layout in ASCII.
- CARD OR NOT: which surfaces should stop being bordered cards (become inline strips,
  bands, or merge). A wall of equal cards is the current weakness.
- PERSONALITY: 3 to 5 signature moves that give the page a point of view and make it
  unmistakably Tahi, not a generic admin panel.
- Density philosophy, and the 375px mobile strategy.

You may Read the files listed above. Return ONLY the structured object.`,
    { label: `compose:${s.name}`, phase: 'Explore', model: 'fable', schema: COMPOSITION_SCHEMA },
  ).then(r => (r ? { kind: 'composition', stance: s.name, result: r } : null)),
)

const explored = (await parallel([...cardThunks, ...compositionThunks])).filter(Boolean)
const cardConcepts = explored.filter(x => x.kind === 'card')
const compositions = explored.filter(x => x.kind === 'composition')
log(`Got ${cardConcepts.length} card concepts + ${compositions.length} compositions. Synthesizing...`)

// ── Phase: Synthesize (Fable) ────────────────────────────────────────────────
phase('Synthesize')

const cardsBlock = cardConcepts.map(c => `### ${c.cardId} ("${c.title}")
- verdict: ${c.result.verdict}
- container: ${c.result.isCardRightContainer}
- recommended form: ${c.result.recommendedForm}
- personality trait: ${c.result.personalityTrait}
- microinteraction: ${c.result.microinteraction}
- data changes: ${c.result.dataChanges}
- one line: ${c.result.oneLine}`).join('\n\n')

const compositionsBlock = compositions.map(c => `### Stance: ${c.stance}
- top element: ${c.result.topElement}
- ascii:
${c.result.asciiBento}
- card-vs-inline: ${(c.result.cardVsInline || []).join(' | ')}
- signature moves: ${(c.result.signatureMoves || []).join(' | ')}
- density: ${c.result.density}
- rationale: ${c.result.rationale}`).join('\n\n')

const synthesis = await agent(
  `${CONTEXT}

You are the DESIGN DIRECTOR. ${cardConcepts.length} dedicated per-card designers and
${compositions.length} composition leads have reported. Merge everything into ONE coherent,
buildable redesign of the Tahi admin homepage. Take the strongest idea wherever it comes
from; resolve conflicts with a clear point of view. The result must feel like a $50k
crafted studio product, give a stressed founder instant signal, and carry genuine Tahi
personality and uniqueness (the user explicitly said the current homepage "feels boring"
and wants "uniqueness and personality and traits").

THREE COMPOSITION STANCES:
${compositionsBlock}

SEVENTEEN PER-CARD CONCEPTS:
${cardsBlock}

Produce the synthesis:
- headline direction (one paragraph).
- the decided top-of-page and why.
- the recommended 12-col bento as ASCII, plus the ordered plan with column sizing.
- a per-card final direction (form + signature trait + one line) for all 17.
- the signature SYSTEM: the 3 to 5 unique traits that run across the whole page and make
  it unmistakably Tahi (these are the spine of the redesign).
- the real open decisions that need Liam to choose, each with options and your recommendation.
- a phased, shippable build order (slices).

Be concrete and opinionated. Return ONLY the structured object.`,
  { label: 'synthesis', phase: 'Synthesize', model: 'fable', schema: SYNTH_SCHEMA },
)

return { synthesis, cardConcepts, compositions }
