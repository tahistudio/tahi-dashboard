/**
 * lib/dashboard-guide.ts - the "how this works" guide.
 *
 * Short, plain-language sections explaining the dashboard's model: requests
 * versus tasks, statuses, tracks and plans, hand-offs, blockers, participant
 * roles, comments, invoices, and what the MCP server can do. Read by humans
 * at /help (app/(dashboard)/help/page.tsx) through both
 * GET /api/admin/guide and GET /api/portal/guide, and by an AI assistant
 * through the worker's get_dashboard_guide tool
 * (workers/mcp-server/src/index.ts).
 *
 * Body text is plain markdown, bold and lists only (no headings, no code
 * fences, no links), matching lib/chat-markdown.ts's small parser: the same
 * one the AI wizards already use, rendered here through
 * components/tahi/chat-markdown.tsx.
 *
 * The "What the MCP can do and why" section names real tool families. Every
 * name inside a **bold** span there must be a registered tool on the worker;
 * see app/api/__tests__/dashboard-guide.test.ts, which parses this file and
 * fails the build if one drifts.
 */

/** 'team' sections are studio-only (nothing a client would act on); 'client'
 *  sections are portal-relevant; 'both' show up on both audiences.
 *  GET /api/portal/guide only ever returns 'client' or 'both' rows;
 *  GET /api/admin/guide returns every row. */
export type GuideAudience = 'team' | 'client' | 'both'

export interface GuideSection {
  key: string
  title: string
  audience: GuideAudience
  body: string
}

export const GUIDE_SECTIONS: ReadonlyArray<GuideSection> = [
  {
    key: 'what-this-is',
    title: 'What Tahi Dashboard is for',
    audience: 'both',
    body:
      'Tahi Dashboard is the one place Tahi Studio and its clients work together. Requests come in, work gets scheduled and delivered, and invoices get paid, all in one thread instead of scattered emails.\n\n' +
      '**For the studio**: manage every client, request, invoice, task and team member in one system.\n' +
      '**For clients**: submit requests, track progress, message the team, and see invoices and files, all scoped to your own organisation.',
  },
  {
    key: 'requests-vs-tasks',
    title: 'Requests versus tasks',
    audience: 'both',
    body:
      'A **request** is client-facing work: something a client asked for, or something the studio is doing for them. Every request belongs to one client organisation and the client can see its status.\n\n' +
      'A **task** is internal-only: the studio\'s own to-do list for running the business. Tasks never appear in the client portal, even to an org admin.\n\n' +
      '- A request can spawn internal tasks, but a task is never itself client-visible.\n' +
      '- Requests carry the status a client sees; tasks carry the studio\'s own priority and level instead.',
  },
  {
    key: 'request-statuses',
    title: 'Request statuses, and what they mean for the client',
    audience: 'both',
    body:
      'A request moves through one status at a time. Here is what each means for the client watching it:\n\n' +
      '- **Draft** - not sent yet, only the studio can see it.\n' +
      '- **Submitted** - received, waiting for the studio to start.\n' +
      '- **In review** - the studio is scoping or triaging the request.\n' +
      '- **In progress** - active work is underway.\n' +
      '- **Client review** - the studio is waiting on the client for something. See Hand-offs below.\n' +
      '- **Delivered** - the work is finished and handed over.\n' +
      '- **Archived** - closed out, kept for the record.',
  },
  {
    key: 'tracks-and-plans',
    title: 'Tracks and plans',
    audience: 'both',
    body:
      'Retainer clients (plan types **maintain** and **scale**) get one or more **tracks**, a small or large capacity slot that queues their requests in order. One-off engagements use **projects** instead and are billed per project rather than per month.\n\n' +
      '- A **small** track takes lighter requests; a **large** track takes bigger ones.\n' +
      '- Plan type decides billing cadence and how many tracks a client holds, not which features they can see.',
  },
  {
    key: 'hand-offs',
    title: 'Hand-offs: waiting on a client',
    audience: 'both',
    body:
      'A request keeps its Tahi owner the whole time, but at any moment it can be handed to one named client contact who needs to do something before the studio can move again.\n\n' +
      '- **Reasons**: approval, content, access, a decision, or a file, each with a plain sentence like **Needs your approval**.\n' +
      '- **What happens**: that person sees it in their own Waiting on you list with one clear action, and an org admin sees the org-wide list too.\n' +
      '- **The nudge**: if nobody acts after a few days, one reminder email goes out, then the studio waits again.\n' +
      '- **Hand-back**: the moment the named person acts (approves, uploads, or replies), the request lets go automatically and the studio is notified. Anyone involved can also hand it back manually with a note.',
  },
  {
    key: 'blockers',
    title: 'Blockers',
    audience: 'both',
    body:
      'A blocker says one task or request cannot move until another one finishes. It is different from a hand-off: a blocker points at another piece of work, a hand-off points at a person.\n\n' +
      '- A request or task can carry more than one blocker.\n' +
      '- When a client contact is the thing being waited on, the Blocked by card shows that as a line too, so the reason is visible in one place even though no separate blocker row is written for it.',
  },
  {
    key: 'participants-and-roles',
    title: 'Participants and roles',
    audience: 'both',
    body:
      'Every request carries a list of participants, each with one role:\n\n' +
      '- **Owner** - the Tahi team member accountable for the work.\n' +
      '- **Assignee** - who is actually doing it right now, often the same person as the owner.\n' +
      '- **Approver** - a client contact whose sign-off the work needs.\n' +
      '- **Contributor** - a client contact who needs to supply something: content, access, a file, or a decision.\n' +
      '- **Watcher** - anyone who just wants to follow along, with no action expected of them.',
  },
  {
    key: 'comments',
    title: 'Comments and the comment ball',
    audience: 'both',
    body:
      'Every request has its own message thread, where the studio and the client talk about that piece of work. Client replies show up the same way a team reply does.\n\n' +
      'Separately, the small floating comment ball in the corner of every studio screen is a Tahi-only feedback tool: click it, then click anything on the page, to leave a note (with a screenshot) about the dashboard itself. It is not visible to clients and has nothing to do with a request\'s own thread.',
  },
  {
    key: 'invoices-and-plans',
    title: 'Invoices and plans',
    audience: 'both',
    body:
      'Retainer clients are billed on a recurring cycle tied to their plan type; project clients get one invoice per project. Every invoice is scoped to its own client organisation, carries its own pay link, and its status (**draft**, **sent**, **paid**, **overdue**, and so on) is what the client sees in their own Invoices list, never an internal draft.',
  },
  {
    key: 'mcp-guide',
    title: 'What the MCP can do, and why',
    audience: 'team',
    body:
      'The Tahi Dashboard MCP server lets an AI assistant work the dashboard the same way a person would, through the same access rules, so nothing it does bypasses what a Tahi admin is allowed to do. Tool families, by name:\n\n' +
      '- **get_overview, get_reports, get_billing_summary, get_response_time** - the numbers: KPIs, reports, billing and response-time summaries.\n' +
      '- **list_requests, get_request, create_request, update_request_fields, update_request_status, assign_request, post_request_message** - read, create and move work requests, and talk in their threads.\n' +
      '- **hand_off_request, hand_back_request, list_requests_waiting_on_clients** - point a request at a client contact, hand it back, and see everything currently waiting on someone.\n' +
      '- **list_clients, get_client, create_client, update_client, list_client_contacts** - client organisations and the people at them.\n' +
      '- **list_tasks, get_task, create_task, update_task** - the studio\'s internal to-do list.\n' +
      '- **list_task_suggestions, decide_task_suggestion** - the call-suggestions inbox: read what a transcribed call proposed for tasks and requests, and approve, tweak, snooze or reject it.\n' +
      '- **add_blocker, remove_blocker, list_blockers** - link and unlink blocking work.\n' +
      '- **list_invoices, get_invoice, create_invoice, update_invoice** - billing records.\n' +
      '- **list_time_entries, log_time, start_timer, stop_timer** - time tracking.\n' +
      '- **list_team, create_team_member, update_team_member** - the studio\'s own people.\n' +
      '- **list_docs, get_doc, create_doc, update_doc** - the internal knowledge hub.\n' +
      '- **get_dashboard_guide** - this guide itself, read back by an assistant instead of a person.',
  },
  {
    key: 'suggestions-from-calls',
    title: 'Suggestions from calls',
    audience: 'team',
    body:
      'When a call gets transcribed, the studio reads it and proposes suggestions: a new task, an update to an existing one, marking something done, or a plain note, and for client calls, a new request, an update to an existing request, a hand-off to a client contact, or a note on a request\'s thread. Nothing is created or changed until someone decides.\n\n' +
      'Each suggestion carries the exact words it rests on, so nothing is invented. Find them on the **Suggestions** view on /tasks, or from the studio home\'s "Suggestions from calls" card once any are waiting.\n\n' +
      '- **Approve** applies it as written.\n' +
      '- **Tweak** opens it for editing first; saving approves the edited version.\n' +
      '- **Snooze** (tonight or this week) brings it back later.\n' +
      '- **Reject** dismisses it.\n\n' +
      'A new task or request is checked against what already exists before anything is created. A close match shows on the row with a "Use it instead" button, which attaches the suggestion to that existing item as a note rather than creating a copy. A very close match asks for a second confirm, and Approve reads "Approve anyway" until that confirm is given.\n\n' +
      'An applied suggestion posts as "Tahi bot" in the task\'s own thread, with the quote it came from, so it never reads as something Liam or Staci typed themselves.',
  },
]

const BY_KEY = new Map(GUIDE_SECTIONS.map(s => [s.key, s]))

/** One section by key, or undefined if the key does not exist. */
export function getGuideSection(key: string): GuideSection | undefined {
  return BY_KEY.get(key)
}

/** Sections visible to a given audience. 'client' gets only 'both' and
 *  'client' rows; 'team' gets everything, since every row is written to make
 *  sense to a studio reader too. */
export function guideSectionsFor(audience: 'team' | 'client'): GuideSection[] {
  if (audience === 'team') return [...GUIDE_SECTIONS]
  return GUIDE_SECTIONS.filter(s => s.audience === 'both' || s.audience === 'client')
}
