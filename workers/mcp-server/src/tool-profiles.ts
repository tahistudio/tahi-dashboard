/**
 * What each MCP profile may do, as a pure, testable table.
 *
 * Every connector session belongs to one team member with one profile
 * (team_members.mcp_profile, carried in the OAuth tokens):
 *
 *   full      exactly the server's behaviour before profiles existed: every
 *             tool, no confirmation gate.
 *   designer  read everything (finance included), work on tasks, time and
 *             requests, and make any change a client would see or receive
 *             (messages, status changes, steps, deleted files) only after
 *             the person confirmed it in chat. Time is always logged as
 *             herself, never with a rate or billable flag. Undeclared
 *             arguments are dropped. Everything else is blocked: billing and
 *             finance writes, contracts, clients and contacts, team and
 *             permissions, announcements, emails, sales, settings,
 *             migrations, crons, ManyRequests writes, and anything that
 *             writes AS a client (portal_send_message).
 *
 * DEFAULT DENY. A tool is available to the designer profile only when its
 * name is listed below. A tool added to TOOLS later is hidden from tools/list
 * and refused by tools/call for the designer until someone classifies it
 * here, so a new write can never leak through by omission.
 *
 * The same decision runs in BOTH places: tools/list hides what tools/call
 * refuses. The spec is app/api/__tests__/mcp-tool-profiles.test.ts
 * (workers/** is excluded from test collection).
 */

import type { McpProfile } from '../../../lib/mcp-identity'
import { coerceBoolean } from './coerce'

export type ToolAccess = 'read' | 'write' | 'confirm' | 'blocked'

/** Reads: no side effect beyond reading (AI drafting tools that never write count here). */
export const DESIGNER_READ_TOOLS: ReadonlySet<string> = new Set([
  // Overview, guide, reports
  'get_overview', 'get_daily_brief', 'get_dashboard_guide', 'get_reports', 'get_billing_summary', 'get_response_time',
  'get_exchange_rates',
  // Clients and contacts
  'list_clients', 'get_client', 'list_client_contacts', 'list_contact_references',
  // Requests
  'list_requests', 'get_request', 'get_request_messages', 'get_request_steps', 'list_request_time_entries',
  'list_request_files', 'list_kanban_columns', 'list_request_participants', 'list_requests_waiting_on_clients',
  'list_sub_requests', 'list_request_reads',
  // Tasks
  'list_tasks', 'get_task', 'list_task_subtasks', 'list_task_templates', 'list_task_comments',
  'list_task_suggestions', 'list_blockers', 'search_blocker_candidates', 'list_task_dependencies',
  'list_task_calls',
  // Time
  'list_time_entries', 'get_active_timer',
  // Finance (read only)
  'list_invoices', 'get_invoice', 'get_subscription', 'get_financial_health', 'get_xero_profit_loss',
  'get_xero_balance_sheet', 'get_xero_bank_summary', 'match_xero_contacts', 'get_xero_branding_themes',
  'get_invoice_aging', 'get_client_profitability', 'list_client_profitability', 'get_retainer_health',
  'get_cash_flow_forecast', 'get_utilization', 'get_studio_capacity', 'list_client_costs', 'get_expenses',
  'get_bank_balances', 'get_financial_snapshots', 'list_commitments',
  // Team and permissions (read only)
  'list_team', 'get_org_chart', 'list_permission_subjects', 'get_feature_visibility', 'get_permission_matrix',
  'get_permission_history', 'get_client_view_mode', 'list_acting_as_audit',
  // Contracts, sales, schedules, proposals (read only)
  'list_contracts', 'get_contract', 'list_contract_templates', 'list_leads', 'get_lead', 'get_lead_ai_briefing',
  'list_lead_calls', 'list_deal_calls', 'list_deals', 'get_pipeline_stages', 'get_deal', 'list_deal_activities',
  'list_deal_contacts', 'list_nudge_templates', 'list_deal_nudges', 'list_calls', 'list_all_calls',
  'list_call_transcripts', 'get_call_transcript', 'list_schedules', 'get_schedule', 'get_schedule_delivery_status',
  'list_meeting_recordings', 'get_meeting_recording',
  'get_schedule_linked_work', 'get_engagement_delivery_status', 'list_off_track_engagements', 'get_share_analytics',
  'list_schedule_templates', 'list_proposals', 'get_proposal',
  // Catalogue, docs, messages, notifications, misc
  'list_services', 'list_docs', 'get_doc', 'list_notifications', 'list_feedback_comments', 'list_messages',
  'get_message_thread', 'portal_list_conversations', 'portal_get_conversation', 'portal_kickoff_slots',
  'list_conversations', 'list_automations', 'list_reviews', 'get_settings', 'list_email_suppressions',
  'list_crons', 'list_migrations', 'buffer_get_status', 'buffer_list_posts',
  // Sitemap planning (read only)
  'list_sitemap_nodes', 'get_sitemap_node', 'export_sitemap_bundle', 'get_sitemap_site_reviews',
  // AI drafting that never writes
  'ai_task_wizard', 'ai_request_wizard', 'ai_triage_request', 'ai_draft_request_reply', 'predict_entry_fields',
  // ManyRequests reads
  'manyrequests_list_clients', 'manyrequests_get_client', 'manyrequests_list_invoices', 'manyrequests_get_invoice',
  'manyrequests_list_organizations', 'manyrequests_get_organization', 'manyrequests_list_org_brands',
  'manyrequests_get_org_brand', 'manyrequests_list_org_members', 'manyrequests_list_org_services',
])

/** Writes the designer may make without a confirmation step. */
export const DESIGNER_WRITE_TOOLS: ReadonlySet<string> = new Set([
  // Tasks, checklist items, comments, dependencies, blockers, templates
  'create_task', 'update_task', 'delete_task', 'bulk_update_tasks', 'create_task_subtask', 'toggle_task_subtask',
  'delete_task_subtask', 'post_task_comment', 'add_task_dependency', 'remove_task_dependency', 'add_blocker',
  'remove_blocker', 'create_task_from_template', 'create_task_template', 'update_task_template',
  'delete_task_template',
  // Timers and time logging
  'start_timer', 'pause_timer', 'resume_timer', 'edit_timer', 'stop_timer', 'log_time', 'log_time_entry',
  'log_request_time',
  // Requests: status, fields, people, steps, files, structure
  'update_request_fields', 'assign_request', 'bulk_assign_requests', 'add_request_participant',
  'remove_request_participant', 'mark_request_read', 'hand_back_request', 'nest_request',
  'reorder_sub_requests', 'flag_scope_creep', 'unflag_scope_creep',
  // Read cursors
  'mark_message_thread_read',
  // Developer handoff (both profiles)
  'hand_off_to_developer',
])

/**
 * Tools with a client-visible effect: allowed for the designer only with
 * `confirmed: true` when the call actually reaches a client (see
 * reachesClient). portal_send_message is deliberately absent: it writes AS
 * the client, which is impersonation, so it stays blocked; studio messages
 * go through post_request_message or post_message instead.
 */
export const DESIGNER_CONFIRM_TOOLS: ReadonlySet<string> = new Set([
  'post_request_message', 'post_message', 'send_message', 'hand_off_request', 'update_request_status',
  'create_request_step', 'update_request_step', 'delete_request_step', 'delete_file',
])

/**
 * Writes that are allowed outright but turn client-visible for some
 * arguments; those calls need confirmation too.
 */
export const CONDITIONAL_CONFIRM_TOOLS: ReadonlySet<string> = new Set(['update_request_fields'])

/** Explicit restricted writes, in addition to default deny for all unlisted tools. */
export const DESIGNER_BLOCKED_TOOLS: ReadonlySet<string> = new Set([
  // Finance sync writes stay with the full profile.
  'sync_airwallex',
  // Shared brief cache regeneration stays with the full profile.
  'refresh_daily_brief',
  'link_stripe_customer', 'confirm_xero_contact',
  // Recorder devices can capture calls, so their management stays with admins.
  'list_recorder_devices', 'revoke_recorder_device',
  // Paid transcription and its manual fallback stay with an administrator.
  'transcribe_meeting_recording',
])

const INTERNAL_WHEN_FLAGGED: ReadonlySet<string> = new Set(['post_request_message', 'post_message', 'send_message'])

/** Time tools: always logged as the person, never with a rate or billable flag. */
const TIME_TOOLS: ReadonlySet<string> = new Set(['log_time', 'log_time_entry', 'log_request_time'])
const TIME_ARGS_DROPPED = ['billable', 'hourlyRate'] as const

/** The argument that carries the person's explicit go-ahead. */
export const CONFIRM_ARG = 'confirmed'

export function classifyTool(name: string, profile: McpProfile): ToolAccess {
  if (profile === 'full') return 'write'
  if (DESIGNER_BLOCKED_TOOLS.has(name)) return 'blocked'
  if (DESIGNER_READ_TOOLS.has(name)) return 'read'
  if (DESIGNER_WRITE_TOOLS.has(name)) return 'write'
  if (DESIGNER_CONFIRM_TOOLS.has(name)) return 'confirm'
  // link_meeting_recording changes client identity and stays blocked for designers.
  return 'blocked'
}

interface ToolLike {
  name: string
  description: string
  inputSchema: { type: string; properties?: Record<string, unknown>; required?: string[] }
}

const CONFIRM_DESCRIPTION =
  'Set true only after the person you are working for has seen exactly what will change or be sent, and who will see it, and said yes in this chat. Not needed for internal notes.'

/**
 * The tools/list answer for a profile: blocked tools removed, and the
 * confirmation-gated ones given a `confirmed` argument plus a sentence saying
 * what it means. The full profile gets the list untouched.
 */
export function toolsForProfile<T extends ToolLike>(tools: readonly T[], profile: McpProfile): T[] {
  if (profile === 'full') return [...tools]
  return tools
    .filter((tool) => classifyTool(tool.name, profile) !== 'blocked')
    .map((tool) => {
      const gated = classifyTool(tool.name, profile) === 'confirm' || CONDITIONAL_CONFIRM_TOOLS.has(tool.name)
      if (!gated) return tool
      return {
        ...tool,
        description: `${tool.description} CLIENT VISIBLE: show the person exactly what will change or be sent and ask them to confirm in chat first, then call with ${CONFIRM_ARG}: true.`,
        inputSchema: {
          ...tool.inputSchema,
          properties: {
            ...(tool.inputSchema.properties ?? {}),
            [CONFIRM_ARG]: { type: 'boolean', description: CONFIRM_DESCRIPTION },
          },
        },
      }
    })
}

export type GateResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; message: string }

/** Does this call change something a client sees or receives? */
function reachesClient(name: string, args: Record<string, unknown>): boolean {
  if (INTERNAL_WHEN_FLAGGED.has(name)) return coerceBoolean(args.isInternal) !== true
  if (name === 'update_request_status') return args.status !== 'archived'
  // Flipping isInternal either way changes what the portal shows.
  if (name === 'update_request_fields') return args.isInternal !== undefined && args.isInternal !== null
  return true
}

function blockedResult(name: string, personName: string): GateResult {
  return {
    ok: false,
    message: `${name} is not available on the designer profile. Billing, finance, clients, contracts, sales, team, settings and email changes stay with Liam, and messages are never sent as a client. If this needs doing, tell ${personName} and suggest hand_off_to_developer or a note to Liam.`,
  }
}

export interface GateContext {
  /** The tool's declared argument names. The designer profile drops anything else. */
  declaredArgs?: readonly string[]
  /** The person's team_members.id, which designer time entries are pinned to. */
  teamMemberId?: string | null
}

/**
 * The tools/call gate. Returns the arguments to dispatch or the refusal text
 * the model reads back. The `confirmed` flag is stripped from the tools that
 * own it so it never reaches the dashboard; other tools that declare an
 * argument of the same name for their own purpose (start_timer stops the
 * running timer first) keep theirs.
 */
export function gateToolCall(
  name: string,
  args: Record<string, unknown>,
  profile: McpProfile,
  personName: string,
  context: GateContext = {},
): GateResult {
  const ownsFlag = DESIGNER_CONFIRM_TOOLS.has(name) || CONDITIONAL_CONFIRM_TOOLS.has(name)
  const { [CONFIRM_ARG]: confirmedRaw, ...withoutFlag } = args
  const dispatchArgs = ownsFlag ? withoutFlag : args

  if (profile === 'full') return { ok: true, args: dispatchArgs }

  if (classifyTool(name, profile) === 'blocked') return blockedResult(name, personName)

  // Mass-assignment guard: only the arguments the tool declares go through.
  let out: Record<string, unknown> = dispatchArgs
  if (context.declaredArgs) {
    const allowed = new Set(context.declaredArgs)
    out = Object.fromEntries(Object.entries(dispatchArgs).filter(([key]) => allowed.has(key)))
  }

  if (TIME_TOOLS.has(name)) {
    if (!context.teamMemberId) {
      return { ok: false, message: `${name} needs a named person on this profile. Reconnect the connector and try again.` }
    }
    out = { ...out, teamMemberId: context.teamMemberId }
    for (const key of TIME_ARGS_DROPPED) delete out[key]
  }

  if (ownsFlag && reachesClient(name, out) && coerceBoolean(confirmedRaw) !== true) {
    return {
      ok: false,
      message: `Not done. ${name} changes something a client sees or receives. Show ${personName} exactly what will change or be sent and who will see it, ask them to confirm in this chat, and only after they say yes call ${name} again with the same arguments plus ${CONFIRM_ARG}: true. Do not set ${CONFIRM_ARG} without their explicit yes.`,
    }
  }

  return { ok: true, args: out }
}

/** Standing instructions returned in the MCP initialize response. */
export function instructionsForProfile(profile: McpProfile, personName: string): string {
  if (profile === 'full') {
    return [
      `You are connected to the Tahi Studio dashboard as ${personName} with full access.`,
      'Read get_dashboard_guide when you need the vocabulary. Confirm with the person before anything that emails a client, sends money or deletes data.',
    ].join(' ')
  }
  return [
    `You are connected to the Tahi Studio dashboard as ${personName}, a designer and co-founder who works with Liam (the developer and founder).`,
    `Default to ${personName}'s own work: when asked about tasks, start with tasks ${personName} created or is assigned to, unless asked for more.`,
    'You may read anything, including finance, clients and sales, freely.',
    'Never attempt billing, invoice, subscription, Stripe, Xero, contract, client, team, permission, settings or email changes; those tools are not available on this profile. Time is always logged as yourself, without rates or billable flags.',
    `Anything a client would see or receive needs ${personName}'s explicit confirmation in this chat first: messages, request status changes, request steps, making a request client visible or internal, and deleting files. Show exactly what will change or be sent and who sees it, wait for a yes, then call with confirmed: true. Internal notes need no confirmation. Messages always go out as the studio, never as a client.`,
    'When work needs a developer, use hand_off_to_developer with the task or request id and a short note saying what is needed; it adds Liam and leaves him an internal note.',
  ].join(' ')
}
