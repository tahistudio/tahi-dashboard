/**
 * The MCP profile table (workers/mcp-server/src/tool-profiles.ts): what the
 * designer profile can see and call, the confirmation gate on client-visible
 * messages, and default deny for anything unclassified. workers/** is not
 * collected by Vitest, so the spec imports across.
 */
import { describe, it, expect } from 'vitest'
import { TOOLS } from '../../../workers/mcp-server/src/index'
import {
  CONDITIONAL_CONFIRM_TOOLS,
  CONFIRM_ARG,
  DESIGNER_CONFIRM_TOOLS,
  DESIGNER_READ_TOOLS,
  DESIGNER_WRITE_TOOLS,
  classifyTool,
  gateToolCall,
  instructionsForProfile,
  toolsForProfile,
} from '../../../workers/mcp-server/src/tool-profiles'

const toolNames = new Set(TOOLS.map((t) => t.name))

describe('classification table', () => {
  it('names only tools that exist (a typo would silently block a tool)', () => {
    for (const set of [DESIGNER_READ_TOOLS, DESIGNER_WRITE_TOOLS, DESIGNER_CONFIRM_TOOLS]) {
      for (const name of set) expect(toolNames.has(name), name).toBe(true)
    }
  })

  it('puts no tool in two classes', () => {
    const seen = new Map<string, number>()
    for (const set of [DESIGNER_READ_TOOLS, DESIGNER_WRITE_TOOLS, DESIGNER_CONFIRM_TOOLS]) {
      for (const name of set) seen.set(name, (seen.get(name) ?? 0) + 1)
    }
    for (const [name, count] of seen) expect(count, name).toBe(1)
  })

  it('reads are reads: every get_ and list_ tool is readable by the designer', () => {
    for (const name of toolNames) {
      if (/^(get|list)_/.test(name)) expect(classifyTool(name, 'designer'), name).toBe('read')
    }
  })

  it('blocks a tool nobody has classified yet (default deny)', () => {
    expect(classifyTool('brand_new_write_tool', 'designer')).toBe('blocked')
    expect(classifyTool('brand_new_write_tool', 'full')).toBe('write')
  })

  it.each([
    'create_invoice', 'update_invoice', 'send_invoice_email', 'create_stripe_invoice', 'import_stripe_invoices',
    'import_stripe_payments', 'recover_paid_stripe_invoice', 'dedupe_stripe_charge_twins',
    'dedupe_manyrequests_invoice_twins', 'import_xero_invoices', 'sync_xero_payments', 'sync_xero_pnl',
    'sync_xero_balances', 'auto_generate_invoices', 'stamp_time_invoiced', 'backfill_invoice_numbers',
    'update_subscription', 'change_billing_cycle', 'delete_subscription', 'add_client_cost', 'delete_client_cost',
    'add_commitment', 'update_commitment', 'delete_commitment', 'snapshot_fill_month', 'refresh_exchange_rates',
    'fire_retainer_alerts',
    'create_contract', 'update_contract', 'delete_contract', 'send_contract', 'add_contract_signer',
    'remove_contract_signer', 'revoke_contract_share', 'resend_contract_signed_pdf', 'create_contract_template',
    'create_client', 'update_client', 'delete_client', 'merge_client', 'create_client_contact',
    'update_client_contact', 'delete_client_contact', 'merge_client_contacts', 'invite_client_contact',
    'set_contact_portal_role', 'assign_client_pm', 'send_welcome_email',
    'create_team_member', 'update_team_member', 'delete_team_member', 'assign_team_role', 'set_team_access_scope',
    'copy_access', 'set_feature_visibility', 'set_client_view_mode',
    'create_announcement', 'update_announcement', 'delete_announcement', 'send_announcement', 'send_nudge',
    'create_deal', 'update_deal', 'delete_deal', 'create_lead', 'update_lead', 'delete_lead', 'promote_lead',
    'create_proposal', 'update_proposal', 'publish_proposal', 'share_proposal', 'delete_proposal',
    'update_settings', 'run_migration', 'cleanup_dummy_data', 'import_manyrequests',
    'cron_daily_summary', 'cron_delivery_watch', 'run_lead_ai_cron',
    'manyrequests_create_client', 'manyrequests_update_client', 'manyrequests_delete_client',
    'manyrequests_mark_invoice_paid', 'manyrequests_add_org_member',
    'portal_send_message',
  ])('blocks %s for the designer', (name) => {
    expect(toolNames.has(name), `${name} should exist`).toBe(true)
    expect(classifyTool(name, 'designer')).toBe('blocked')
  })

  it.each([
    'create_task', 'update_task', 'delete_task', 'create_task_subtask', 'post_task_comment', 'add_blocker',
    'create_task_template', 'start_timer', 'stop_timer', 'log_time_entry', 'update_request_fields',
    'add_request_participant', 'hand_off_to_developer',
  ])('lets the designer write with %s', (name) => {
    expect(classifyTool(name, 'designer')).toBe('write')
  })

  it('gives the full profile every tool, untouched', () => {
    expect(toolsForProfile(TOOLS, 'full')).toEqual(TOOLS)
  })
})

describe('tools/list for the designer', () => {
  const listed = toolsForProfile(TOOLS, 'designer')
  const listedNames = new Set(listed.map((t) => t.name))

  it('hides exactly the blocked tools', () => {
    for (const name of toolNames) {
      expect(listedNames.has(name), name).toBe(classifyTool(name, 'designer') !== 'blocked')
    }
  })

  it('confirmation tools do not already declare the flag for some other purpose', () => {
    for (const tool of TOOLS) {
      if (DESIGNER_CONFIRM_TOOLS.has(tool.name)) expect(tool.inputSchema.properties ?? {}, tool.name).not.toHaveProperty(CONFIRM_ARG)
    }
  })

  it('adds the confirmation argument to client-visible message tools (start_timer keeps its own)', () => {
    for (const tool of listed) {
      if (tool.name === 'start_timer') continue
      const hasConfirm = Boolean(tool.inputSchema.properties && CONFIRM_ARG in tool.inputSchema.properties)
      expect(hasConfirm, tool.name).toBe(DESIGNER_CONFIRM_TOOLS.has(tool.name) || CONDITIONAL_CONFIRM_TOOLS.has(tool.name))
    }
  })

  it('does not mutate the shared TOOLS definitions', () => {
    const original = TOOLS.find((t) => t.name === 'post_message')
    expect(original?.inputSchema.properties).not.toHaveProperty(CONFIRM_ARG)
  })
})

describe('tools/call gate', () => {
  it('refuses a blocked tool for the designer and points at the handoff', () => {
    const result = gateToolCall('create_invoice', { orgId: 'o1' }, 'designer', 'Staci')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain('hand_off_to_developer')
  })

  it('lets the full profile call anything, stripping the flag only from message tools', () => {
    expect(gateToolCall('create_invoice', { orgId: 'o1' }, 'full', 'Liam')).toEqual({ ok: true, args: { orgId: 'o1' } })
    expect(gateToolCall('post_message', { id: 'r', body: 'x', confirmed: true }, 'full', 'Liam')).toEqual({ ok: true, args: { id: 'r', body: 'x' } })
    expect(gateToolCall('post_message', { id: 'r', body: 'x' }, 'full', 'Liam').ok).toBe(true)
  })

  it('refuses a client-visible message without confirmation and says how to confirm', () => {
    const result = gateToolCall('post_request_message', { requestId: 'r1', content: 'Hi' }, 'designer', 'Staci')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toContain('Show Staci exactly what will change or be sent')
      expect(result.message).toContain(`${CONFIRM_ARG}: true`)
    }
  })

  it('treats confirmed "false" or a string other than true as unconfirmed', () => {
    expect(gateToolCall('send_message', { conversationId: 'c', body: 'x', confirmed: false }, 'designer', 'S').ok).toBe(false)
    expect(gateToolCall('send_message', { conversationId: 'c', body: 'x', confirmed: 'yes please' }, 'designer', 'S').ok).toBe(false)
  })

  it('sends with confirmed true (boolean or the string a connector sends) and strips the flag', () => {
    expect(gateToolCall('post_message', { source: 'request', id: 'r', body: 'x', confirmed: true }, 'designer', 'S')).toEqual({
      ok: true,
      args: { source: 'request', id: 'r', body: 'x' },
    })
    expect(gateToolCall('send_message', { conversationId: 'c', body: 'x', confirmed: 'true' }, 'designer', 'S').ok).toBe(true)
  })

  it('lets internal notes through without confirmation', () => {
    expect(gateToolCall('post_request_message', { requestId: 'r', content: 'x', isInternal: true }, 'designer', 'S').ok).toBe(true)
    expect(gateToolCall('post_message', { source: 'request', id: 'r', body: 'x', isInternal: 'true' }, 'designer', 'S').ok).toBe(true)
  })

  it('never treats the client-only paths as internal', () => {
    expect(gateToolCall('portal_send_message', { body: 'x', isInternal: true, confirmed: true }, 'designer', 'S').ok).toBe(false)
    expect(gateToolCall('hand_off_request', { request_id: 'r', contact_id: 'c', reason: 'approval', isInternal: true }, 'designer', 'S').ok).toBe(false)
  })

  it('confirms every client-visible request change (security review M1)', () => {
    for (const [name, args] of [
      ['update_request_status', { requestId: 'r', status: 'delivered' }],
      ['update_request_status', { requestId: 'r', status: 'in_progress' }],
      ['create_request_step', { requestId: 'r', title: 'Wireframes' }],
      ['update_request_step', { requestId: 'r', stepId: 's', completed: true }],
      ['delete_request_step', { requestId: 'r', stepId: 's' }],
      ['delete_file', { fileId: 'f' }],
      ['update_request_fields', { requestId: 'r', isInternal: false }],
      ['update_request_fields', { requestId: 'r', isInternal: true }],
    ] as const) {
      expect(gateToolCall(name, { ...args }, 'designer', 'S').ok, name).toBe(false)
      expect(gateToolCall(name, { ...args, confirmed: true }, 'designer', 'S').ok, name).toBe(true)
    }
  })

  it('lets archiving and ordinary field edits through without confirmation', () => {
    expect(gateToolCall('update_request_status', { requestId: 'r', status: 'archived' }, 'designer', 'S').ok).toBe(true)
    expect(gateToolCall('update_request_fields', { requestId: 'r', priority: 'high' }, 'designer', 'S').ok).toBe(true)
  })

  it('drops undeclared arguments on the designer profile only', () => {
    const designer = gateToolCall('update_task', { taskId: 't', title: 'x', orgId: 'evil' }, 'designer', 'S', { declaredArgs: ['taskId', 'title'] })
    expect(designer).toEqual({ ok: true, args: { taskId: 't', title: 'x' } })
    const full = gateToolCall('update_task', { taskId: 't', orgId: 'kept' }, 'full', 'L', { declaredArgs: ['taskId'] })
    expect(full).toEqual({ ok: true, args: { taskId: 't', orgId: 'kept' } })
  })

  it('pins designer time to the person and drops rates and billable (security review L4)', () => {
    for (const name of ['log_time', 'log_time_entry', 'log_request_time']) {
      const result = gateToolCall(name, { hours: 1, teamMemberId: 'other', hourlyRate: 300, billable: false }, 'designer', 'S', { teamMemberId: 'tm_staci' })
      expect(result).toEqual({ ok: true, args: { hours: 1, teamMemberId: 'tm_staci' } })
    }
    expect(gateToolCall('log_time', { hours: 1 }, 'designer', 'S').ok).toBe(false)
  })

  it('passes the start_timer confirmed flag through untouched on both profiles', () => {
    expect(gateToolCall('start_timer', { taskId: 't', confirmed: true }, 'designer', 'S')).toEqual({ ok: true, args: { taskId: 't', confirmed: true } })
    expect(gateToolCall('start_timer', { taskId: 't', confirmed: true }, 'full', 'L')).toEqual({ ok: true, args: { taskId: 't', confirmed: true } })
  })

  it('lets reads and allowed writes straight through', () => {
    expect(gateToolCall('get_bank_balances', {}, 'designer', 'S').ok).toBe(true)
    expect(gateToolCall('update_task', { taskId: 't' }, 'designer', 'S').ok).toBe(true)
  })
})

describe('standing instructions', () => {
  it('tells the designer the rules', () => {
    const text = instructionsForProfile('designer', 'Staci')
    expect(text).toContain('Staci')
    expect(text).toContain('hand_off_to_developer')
    expect(text).toContain('confirmed: true')
    expect(text).toMatch(/billing/i)
  })

  it('keeps the full profile brief and neutral', () => {
    const text = instructionsForProfile('full', 'Liam')
    expect(text).toContain('full access')
    expect(text.length).toBeLessThan(400)
  })

  it('has no em or en dashes', () => {
    for (const profile of ['full', 'designer'] as const) {
      expect(instructionsForProfile(profile, 'X')).not.toMatch(/[–—]/)
    }
  })
})
