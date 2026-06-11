export const meta = {
  name: 'homepage-expansion-audit',
  description: 'Audit the whole dashboard for new homepage cards + design a colour/dynamics injection, then synthesize',
  phases: [
    { title: 'Audit', detail: '4 domain audits (Opus) + colour + dynamics design (Fable), in parallel' },
    { title: 'Synthesize', detail: 'Fable merges into one recommendation: new cards + colour system + dynamics + layout' },
  ],
}

const CONTEXT = `
THE TASK: Liam (founder, super-admin) wants his admin homepage (/dashboard/overview, "The Studio
Ledger") to (1) carry MORE cards and information from across the WHOLE dashboard - he specifically
named content and social media, and "whatever else is in the dashboard" - and (2) have MORE COLOUR
and DYNAMICS. His exact words: "it's lacking color and Dynamics. nothing really pops." The current
homepage went calm/restrained (Stripe/Vercel grade). Liam now wants it richer, more vibrant, more
alive, while STILL premium (not garish, not a cluttered rainbow). He likes information-DENSE
dashboards and "card behind other cards that can be sliders" / stacks (the Crextio reference).

CURRENT HOMEPAGE ("The Studio Ledger") covers agency ops + money only:
- Masthead: bare MRR + vitals (cash/runway, owed, clients, open) + one signed "Studio Note".
- Needs You: 3-row act-now queue.
- WORK: "In the Studio" worklog + Today rail (calls deck + bench tasks).
- AHEAD: merged Pipeline + capacity beakers.
- BOOKS: Cash & Runway + Receivables tide.
It does NOT yet surface: content/blog pipeline, social media, SEO/AEO, leads, reviews/testimonials,
automations, announcements, website/sitemap, deeper finance (P&L, cash-flow forecast, reserves),
docs, team, affiliates, client health.

GROUND TRUTH FOR THE INVENTORY (read these to find what DATA exists and is queryable):
- Dashboard pages: app/(dashboard)/* (each folder is a surface already built).
- Read APIs: app/api/admin/* and app/api/admin/reports/*.
- The worker MCP server workers/mcp-server/src/index.ts exposes read tools (list_*, get_*) - grep it
  for the full capability list.
- db/schema.ts for the tables.
- Memory/specs context: there is a blog/content pipeline (round-table reviewers, glossary, blog
  clusters), a Buffer social integration, an SE Ranking SEO/AEO integration, a leads + AI-enrichment
  system, a reviews/case-study outreach pipeline, automations, a website sitemap tool, and a
  financial-reports surface (cash/runway/P&L/forecast/reserves).

DESIGN SYSTEM: Manrope, brand greens (#5A824E / #425F39 / #7aab6b / #f0f7ee), warm-sand canvas
(#F7F6F3 light / #131211 dark), borders-not-shadows, leaf radius, all tokens in app/globals.css,
Recharts available for charts. Current homepage components live in components/tahi/overview/.
Reference taste: Clay/Notion/Stripe/Vercel/ElevenLabs + Donezo (poppy via GREEN) + Crextio (generous
whitespace + COLOURFUL accent blocks + people stacks + card stacking) + Okisuka (size-contrast
hierarchy). Liam's pull is now toward the Crextio/Donezo COLOUR and life and away from Stripe/Vercel
restraint - but it must still read as a $50k crafted product, not a toy.
`

const CARD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['cluster', 'candidates', 'notes'],
  properties: {
    cluster: { type: 'string' },
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'dataShown', 'source', 'valueToLiam', 'colourDomain', 'dynamicPotential', 'effort', 'recommend'],
        properties: {
          name: { type: 'string' },
          dataShown: { type: 'string', description: 'the concrete data the card would show' },
          source: { type: 'string', description: 'the endpoint(s) or MCP tool(s) / table(s) that feed it; note if data does NOT exist yet' },
          valueToLiam: { type: 'string', description: 'why a founder glancing daily would want it, and a 1-5 priority' },
          colourDomain: { type: 'string', description: 'what colour identity this domain could carry (e.g. content=violet, social=sky, money=green)' },
          dynamicPotential: { type: 'string', description: 'what would make it pop: sparkline, live ticker, count-up, chart, stack/deck, pulse' },
          effort: { type: 'string', enum: ['S', 'M', 'L'] },
          recommend: { type: 'string', enum: ['yes', 'maybe', 'no'] },
        },
      },
    },
    notes: { type: 'string', description: 'gaps where data is missing, and the single highest-value card in this cluster' },
  },
}

const COLOUR_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['direction', 'perDomainPalette', 'whereColourLives', 'guardrails', 'darkMode'],
  properties: {
    direction: { type: 'string', description: 'one-paragraph colour direction that makes the page pop while staying premium' },
    perDomainPalette: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['domain', 'accent', 'usage'], properties: { domain: { type: 'string' }, accent: { type: 'string', description: 'a concrete OKLCH or hex + token name' }, usage: { type: 'string' } } } },
    whereColourLives: { type: 'array', items: { type: 'string' }, description: 'the specific places colour goes (card accents, charts, category blocks, status, hero tiles) and where it must NOT' },
    guardrails: { type: 'array', items: { type: 'string' }, description: 'rules so it is vibrant not garish (max accents per viewport, green stays signal, etc.)' },
    darkMode: { type: 'string', description: 'how the palette holds up in the 4-level dark elevation' },
  },
}

const DYNAMICS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['direction', 'dynamicMoments', 'chartsAndViz', 'motionAdditions', 'guardrails'],
  properties: {
    direction: { type: 'string', description: 'one paragraph on what makes the page feel alive vs the current calm' },
    dynamicMoments: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['moment', 'where', 'technique', 'popFactor'], properties: { moment: { type: 'string' }, where: { type: 'string' }, technique: { type: 'string' }, popFactor: { type: 'string' } } } },
    chartsAndViz: { type: 'array', items: { type: 'string' }, description: 'specific charts/sparklines/visualisations to add and where (Recharts is available)' },
    motionAdditions: { type: 'array', items: { type: 'string' }, description: 'specific micro-animations / live tickers / hover delight / count-ups beyond the current restrained set' },
    guardrails: { type: 'array', items: { type: 'string' }, description: 'rules so motion stays premium + reduced-motion safe, not a casino' },
  },
}

const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['headline', 'recommendedNewCards', 'colourSystem', 'dynamicsSystem', 'asciiLayout', 'openDecisions', 'buildPhases'],
  properties: {
    headline: { type: 'string', description: 'the one-paragraph direction resolving MORE + COLOUR + POP while premium' },
    recommendedNewCards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'why', 'source', 'colour', 'dynamic', 'placement', 'priority'], properties: { name: { type: 'string' }, why: { type: 'string' }, source: { type: 'string' }, colour: { type: 'string' }, dynamic: { type: 'string' }, placement: { type: 'string' }, priority: { type: 'string', enum: ['now', 'next', 'later'] } } } },
    colourSystem: { type: 'string', description: 'the agreed colour evolution (per-domain accents + where it lives + guardrails), concrete' },
    dynamicsSystem: { type: 'string', description: 'the agreed dynamics/motion/charts system, concrete' },
    asciiLayout: { type: 'string', description: 'ASCII of the expanded homepage layout' },
    openDecisions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'options', 'recommendation'], properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, recommendation: { type: 'string' } } } },
    buildPhases: { type: 'array', items: { type: 'string' } },
  },
}

const CLUSTERS = [
  { key: 'content-social-search', brief: 'Content, Social & Search: the blog/content pipeline (round-table reviewers, drafts, scheduled, published, clusters), the Buffer social integration (queued/scheduled posts, channels, status), SE Ranking SEO/AEO (keyword rankings, AI-search visibility, audits), the glossary, and the website sitemap/project. This is the cluster Liam explicitly named ("content, maybe social media"). Find the highest-value glanceable cards here.' },
  { key: 'sales-growth', brief: 'Sales & Growth: leads (AI-scored, new inbound, enrichment), deals/pipeline beyond what is already shown, discovery calls, proposals (sent/viewed/share analytics), reviews + testimonials + case-study outreach pipeline, affiliates/partnerships. What would a founder want to see daily that the current pipeline card does not already cover?' },
  { key: 'delivery-ops', brief: 'Delivery & Ops: requests + tasks beyond the worklog, time tracking + utilisation/billable hours, capacity, schedules/delivery spine, contracts (status, expiring), automations (active rules, recent fires), announcements, team activity. What operational signal belongs on the homepage?' },
  { key: 'finance-clients', brief: 'Finance & Clients: deeper finance beyond cash/runway - P&L, cash-flow forecast, reserves, profit, take-home vs target, bank balances trend, invoice aging beyond the tide; plus client health/profitability, onboarding states, docs hub. What money + client-health signal should a founder see daily?' },
]

// ── Phase: Audit + design (one barrier) ──────────────────────────────────────
phase('Audit')
log(`Auditing ${CLUSTERS.length} domain clusters (Opus) + designing colour + dynamics (Fable)`)

const auditThunks = CLUSTERS.map(c => () =>
  agent(
    `${CONTEXT}

YOU ARE AUDITING ONE DOMAIN CLUSTER of the Tahi dashboard to find NEW homepage cards for Liam.

CLUSTER: ${c.key}
${c.brief}

Read the relevant app/(dashboard)/* pages, app/api/admin/* endpoints, and grep workers/mcp-server/src/index.ts
for the read tools that cover this cluster, and db/schema.ts for the tables. For EACH candidate homepage
card: name it, say exactly what data it shows, cite the real source (endpoint / MCP tool / table - and
flag clearly if the data does NOT exist yet and would need building), judge its value to a founder
glancing daily (1-5 + why), propose a colour identity for the domain, and say what would make it POP
(sparkline / live ticker / count-up / chart / stack-deck / pulse). Be concrete and honest about what is
real today vs aspirational. Return ONLY the structured object.`,
    { label: `audit:${c.key}`, phase: 'Audit', model: 'opus', schema: CARD_SCHEMA },
  ).then(r => (r ? { kind: 'audit', cluster: c.key, result: r } : null)),
)

const colourThunk = () =>
  agent(
    `${CONTEXT}

YOU ARE THE COLOUR LEAD. Liam says the homepage is "lacking color... nothing really pops." Design a
COLOUR EVOLUTION that makes it vibrant and alive while staying a premium $50k product (not a garish
rainbow). Study how Crextio and Donezo use colourful accent blocks with restraint. Read app/globals.css
for the existing token system and dark-mode elevation, and components/tahi/overview/ledger-masthead.tsx
for the current (too-calm) treatment. Decide: should each business DOMAIN carry its own accent identity
(e.g. money=green, content=violet, social=sky, sales=amber, delivery=teal)? Where exactly does colour
live (card top-accents, charts, category chips, hero tiles, the leaf) and where must it NOT? How does it
hold in the 4-level dark mode? Give concrete colour values (OKLCH or hex) + token names + guardrails.
Return ONLY the structured object.`,
    { label: 'design:colour', phase: 'Audit', model: 'fable', schema: COLOUR_SCHEMA },
  ).then(r => (r ? { kind: 'colour', result: r } : null))

const dynamicsThunk = () =>
  agent(
    `${CONTEXT}

YOU ARE THE MOTION / DYNAMICS LEAD. Liam says the homepage is "lacking... Dynamics. nothing really
pops." The current motion is deliberately restrained (one count-up, one reveal, one border-trace).
Liam now wants it to feel ALIVE. Design a DYNAMICS system: which charts/sparklines/visualisations to add
and where (Recharts is available), which live tickers / count-ups / pulses / hover-delight /
micro-animations to add beyond the restrained set, and how the card-deck/stack motif can carry more
data with motion. Make it feel like a living command center, not a static report - but keep it premium
and reduced-motion safe (not a casino). Read components/tahi/overview/ and app/globals.css for what
exists. Be concrete about technique + where each moment lives + why it pops. Return ONLY the structured
object.`,
    { label: 'design:dynamics', phase: 'Audit', model: 'fable', schema: DYNAMICS_SCHEMA },
  ).then(r => (r ? { kind: 'dynamics', result: r } : null))

const all = (await parallel([...auditThunks, colourThunk, dynamicsThunk])).filter(Boolean)
const audits = all.filter(x => x.kind === 'audit')
const colour = all.find(x => x.kind === 'colour')
const dynamics = all.find(x => x.kind === 'dynamics')
log(`Got ${audits.length} cluster audits + colour + dynamics. Synthesizing...`)

// ── Phase: Synthesize ────────────────────────────────────────────────────────
phase('Synthesize')

const auditBlock = audits.map(a => `### Cluster: ${a.cluster}\n${(a.result.candidates || []).map(c => `- ${c.name} [${c.recommend}, ${c.effort}, val:${c.valueToLiam}] shows: ${c.dataShown} | source: ${c.source} | colour: ${c.colourDomain} | pop: ${c.dynamicPotential}`).join('\n')}\nNOTES: ${a.result.notes}`).join('\n\n')
const colourBlock = colour ? `DIRECTION: ${colour.result.direction}\nPALETTE: ${(colour.result.perDomainPalette || []).map(p => `${p.domain}=${p.accent} (${p.usage})`).join(' | ')}\nWHERE: ${(colour.result.whereColourLives || []).join(' | ')}\nGUARDRAILS: ${(colour.result.guardrails || []).join(' | ')}\nDARK: ${colour.result.darkMode}` : 'none'
const dynamicsBlock = dynamics ? `DIRECTION: ${dynamics.result.direction}\nMOMENTS: ${(dynamics.result.dynamicMoments || []).map(m => `${m.moment}@${m.where} (${m.technique})`).join(' | ')}\nCHARTS: ${(dynamics.result.chartsAndViz || []).join(' | ')}\nMOTION: ${(dynamics.result.motionAdditions || []).join(' | ')}\nGUARDRAILS: ${(dynamics.result.guardrails || []).join(' | ')}` : 'none'

const synthesis = await agent(
  `${CONTEXT}

You are the DESIGN DIRECTOR. Four domain audits and a colour lead and a dynamics lead have reported.
Synthesize ONE recommendation that gives Liam what he asked for: MORE cards/information from across the
dashboard (especially content + social, plus the best of the rest) AND more COLOUR and DYNAMICS so it
POPS - while keeping it a premium, glanceable, not-cluttered $50k product. Resolve the tension between
"more + louder" and "premium + calm": decide what earns a place and what stays one glance away.

CLUSTER AUDITS (candidate cards):
${auditBlock}

COLOUR LEAD:
${colourBlock}

DYNAMICS LEAD:
${dynamicsBlock}

Produce:
- headline direction (one paragraph).
- recommendedNewCards: the cards to ADD, each ranked now/next/later, with why, the real data source
  (flag if data must be built), its colour, its dynamic/pop treatment, and where it goes on the page.
- the colourSystem to adopt (concrete) and the dynamicsSystem to adopt (concrete).
- asciiLayout: the expanded homepage with the new cards placed, zones labelled, colour noted.
- openDecisions: the real choices for Liam (how much colour, how dense, which cards now), each with
  options + your recommendation.
- buildPhases: a shippable build order.
Be concrete and opinionated. Return ONLY the structured object.`,
  { label: 'synthesis', phase: 'Synthesize', model: 'fable', schema: SYNTH_SCHEMA },
)

return { synthesis, audits, colour, dynamics }
