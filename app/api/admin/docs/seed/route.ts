import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

// Tahi Studio OS docs to seed into the Docs Hub
const TAHI_DOCS: Array<{ title: string; category: string; content: string }> = [
  {
    title: 'Brand DNA',
    category: 'Foundation',
    content: `# Brand DNA\n\nTahi Studio is a Webflow design and development studio based in New Zealand. Founded by Liam Miller and Staci Bonnie.\n\nMission: Build exceptional digital experiences for businesses that value quality, clarity, and long-term partnership.\n\nValues: Quality over quantity. Transparency. Long-term thinking. Premium positioning.\n\nTahi means "one" in Te Reo Maori, representing the idea of being the one partner a client needs for their digital presence.`,
  },
  {
    title: 'Team and Structure',
    category: 'Foundation',
    content: `# Team and Structure\n\n## Current Team\n- **Liam Miller** (Co-founder, CEO): Sales, PM, Lead Developer, Client Success, Partnerships, Finance\n- **Staci Bonnie** (Co-founder, Creative Director): Design, Brand, Marketing, Events\n\n## Planned Hires\n1. Mid-level Webflow Developer (first hire priority)\n2. Designer (second hire)\n3. PM / Client Success (third hire)\n\n## Structure\nLiam handles all client-facing and technical work. Staci handles all creative and brand work. As the team grows, responsibilities will be delegated to new hires.`,
  },
  {
    title: 'Ideal Client Profile',
    category: 'Foundation',
    content: `# Ideal Client Profile\n\nTarget: Marketers at companies with 50+ employees (NZ/AU) or 100+ employees (UK/US).\n\nIndustries: Technology, Healthcare, Professional Services, E-commerce.\n\nBudget: Minimum engagement value that justifies the quality of work delivered.\n\nSigns of a good fit: Values quality, has budget allocated, needs ongoing support not just a one-off build, decision maker is involved early.`,
  },
  {
    title: 'Competitive Positioning',
    category: 'Foundation',
    content: `# Competitive Positioning\n\nTahi Studio positions as a premium Webflow partner, not the cheapest option.\n\nDifferentiators: Deep Webflow expertise, design-led approach, NZ-based with global clients, long-term retainer model, both founders are Webflow Global Leaders.`,
  },
  {
    title: 'Services and Pricing',
    category: 'Operations',
    content: `# Services and Pricing\n\n## Plans\n- **Maintain**: Ongoing support, small tasks, content updates. 1 small track.\n- **Scale**: Full design + development capacity. 2 small + 1 large track.\n- **Launch**: One-off project builds. Fixed scope and timeline.\n- **Hourly**: Ad-hoc work billed by the hour.\n\n## Pricing\nRetainer plans are billed monthly. Launch projects are fixed price. Hourly rate varies by complexity.\n\nBilling currencies: NZD, USD, AUD, GBP, EUR. Prefer USD where possible for consistency.`,
  },
  {
    title: 'Financial Overview',
    category: 'Operations',
    content: `# Financial Overview\n\nRevenue model: Recurring retainer subscriptions (Maintain, Scale) + one-off project fees (Launch) + hourly billing.\n\nTools: Stripe for billing, Xero for accounting, ManyRequests (being replaced by Tahi Dashboard) for client management.\n\nCurrency: Bill in client's regional currency but prefer USD. Xero handles multi-currency reconciliation.`,
  },
  {
    title: 'Sales Strategy',
    category: 'Operations',
    content: `# Sales Strategy\n\n## Philosophy\nWe qualify, we don't push. A bad-fit client costs more than a lost deal.\n\n## Pipeline Stages\n1. Inquiry (lead came in)\n2. Contacted (responded, engaged)\n3. Discovery (call or email exchange complete)\n4. Proposal Sent (quote delivered)\n5. Won / Lost / Stalled\n\n## Lead Sources\n1. Referrals (dominant channel, highest close rate)\n2. LinkedIn (Liam posts, StraightIn outreach)\n3. Website (organic/SEO)\n4. Cold outreach (StraightIn, ICP-targeted)\n\n## Properties per Deal\nSource, estimated value, currency, notes.\n\n## Target Metrics\nClose rate by stage, close rate by source, avg deal size, avg sales cycle length.`,
  },
  {
    title: 'Client Experience and Delivery',
    category: 'Operations',
    content: `# Client Experience and Delivery\n\nOnboarding: Welcome email, access to portal, kickoff call, brand asset collection.\n\nDelivery: Requests submitted through the portal, tracked through kanban stages (Submitted, In Progress, Client Review, Delivered).\n\nCommunication: All project communication happens in the dashboard. Status updates are visible in real-time.\n\nQuality: Every deliverable goes through internal review before client handoff.`,
  },
  {
    title: 'Tools and Tech Stack',
    category: 'Operations',
    content: `# Tools and Tech Stack\n\n- **Design**: Figma, Adobe Creative Suite\n- **Development**: Webflow, custom code (JS, CSS, APIs)\n- **Project Management**: Tahi Dashboard (replacing ManyRequests)\n- **Billing**: Stripe, Xero\n- **Communication**: Dashboard messaging, email\n- **CRM**: HubSpot (being replaced by Tahi Dashboard CRM)\n- **Marketing**: LinkedIn, Mailerlite, SEO tools\n- **Storage**: Cloudflare R2\n- **Hosting**: Webflow, Cloudflare Workers`,
  },
  {
    title: 'Partnerships and Affiliates',
    category: 'Operations',
    content: `# Partnerships and Affiliates\n\nWebflow Partner: Both founders are Webflow Global Leaders. Receive partner leads through Webflow's agency finder.\n\nRewardful: Affiliate programme for referral tracking.\n\nTool partnerships: Various SaaS tools used in client delivery.`,
  },
  {
    title: 'Marketing Strategy',
    category: 'Marketing',
    content: `# Marketing Strategy\n\nPrimary channels: LinkedIn (Liam and Staci), website/blog, SEO/AEO.\n\nContent pillars: Technical Webflow content, business strategy, design thinking, case studies.\n\nGoal: Build authority in the Webflow ecosystem and attract inbound leads from the ICP.`,
  },
  {
    title: 'Content Guidelines',
    category: 'Marketing',
    content: `# Content Guidelines\n\nTone: Professional but approachable. Clear, not corporate. Confident, not arrogant.\n\nFormat: Long-form posts on LinkedIn, blog articles, video walkthroughs.\n\nFrequency: Consistent posting schedule, quality over quantity.`,
  },
  {
    title: 'SEO and AEO Strategy',
    category: 'Marketing',
    content: `# SEO and AEO Strategy\n\nFocus: Technical SEO for client sites and Tahi's own site. Answer Engine Optimization for AI visibility.\n\nApproach: Schema markup, structured data, comprehensive content, fast performance scores.`,
  },
  {
    title: 'Case Studies and Proof',
    category: 'Marketing',
    content: `# Case Studies and Proof\n\nProcess: After successful delivery, request testimonial and case study permission from client.\n\nFormat: Problem, approach, solution, results. Include screenshots and metrics where possible.\n\nDistribution: Website, LinkedIn, proposals.`,
  },
  {
    title: 'Legal Documentation',
    category: 'Legal',
    content: `# Legal Documentation\n\nContracts: MSA (Master Service Agreement), SOW (Statement of Work), NDA as needed.\n\nPayment terms: Net 14 or Net 30 depending on client.\n\nIP: Client owns all deliverables upon final payment.`,
  },
  {
    title: 'Growth Priorities 2026',
    category: 'Strategy',
    content: `# Growth Priorities 2026\n\n1. Replace ManyRequests with Tahi Dashboard\n2. Build CRM into dashboard (replace HubSpot)\n3. First developer hire\n4. Grow retainer client base\n5. Improve sales process and tracking\n6. Build case study portfolio`,
  },
]

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const now = new Date().toISOString()
  let created = 0

  for (const doc of TAHI_DOCS) {
    const id = crypto.randomUUID()
    const versionId = crypto.randomUUID()

    const slug = doc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    await database.insert(schema.docPages).values({
      id,
      title: doc.title,
      category: doc.category,
      slug,
      contentTiptap: doc.content,
      contentText: doc.content,
      authorId: 'system',
      createdAt: now,
      updatedAt: now,
    })

    await database.insert(schema.docVersions).values({
      id: versionId,
      pageId: id,
      contentTiptap: doc.content,
      savedById: 'system',
      savedAt: now,
    })

    created++
  }

  return NextResponse.json({ success: true, created })
}
