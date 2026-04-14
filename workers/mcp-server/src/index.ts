/**
 * Tahi Dashboard MCP Server (Cloudflare Worker)
 *
 * Implements MCP JSON-RPC 2.0 over HTTP transport.
 * Proxies tool calls to the Tahi Dashboard API at Webflow Cloud.
 *
 * Full feature parity with the stdio MCP server (mcp-server/index.ts).
 */

interface Env {
  TAHI_API_TOKEN: string
  OAUTH_CLIENT_ID: string
  OAUTH_CLIENT_SECRET: string
}

const DASHBOARD_URL =
  'https://fdd08ec9-43a5-4c62-aa6d-309da23e3d0f.wf-app-prod.cosmic.webflow.services/dashboard'

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function corsResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

// ---------------------------------------------------------------------------
// Dashboard API proxy
// ---------------------------------------------------------------------------

async function apiFetch(
  path: string,
  token: string,
  opts?: { method?: string; body?: Record<string, unknown>; params?: Record<string, string> },
): Promise<unknown> {
  const url = new URL(`${DASHBOARD_URL}${path}`)
  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v) url.searchParams.set(k, v)
    }
  }

  const res = await fetch(url.toString(), {
    method: opts?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${opts?.method ?? 'GET'} ${path} returned ${res.status}: ${text}`)
  }

  return res.json()
}

/** Shorthand: GET with optional query params */
function apiGet(path: string, token: string, params?: Record<string, string>) {
  return apiFetch(path, token, { params })
}

/** Shorthand: POST/PATCH/PUT/DELETE with body */
function apiWrite(path: string, token: string, method: string, body?: Record<string, unknown>) {
  return apiFetch(path, token, { method, body: body ?? {} })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ToolDef = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

function prop(type: string, description: string, extra?: Record<string, unknown>) {
  return { type, description, ...extra }
}

function tool(name: string, description: string, properties: Record<string, unknown> = {}, required?: string[]): ToolDef {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, ...(required ? { required } : {}) },
  }
}

// ---------------------------------------------------------------------------
// Tool definitions (60+ tools, matching stdio server)
// ---------------------------------------------------------------------------

const TOOLS: ToolDef[] = [
  // ── Read: Overview & Reports ──────────────────────────────────────────
  tool('get_overview', 'Get dashboard overview: KPIs, recent requests, revenue summary'),
  tool('get_reports', 'Get aggregate reports: total clients, requests, billable hours, trends'),
  tool('get_billing_summary', 'Get billing summary: revenue, outstanding invoices, trends'),
  tool('get_response_time', 'Get response time report with averages and breakdowns'),
  tool('get_exchange_rates', 'Get cached exchange rates'),
  tool('refresh_exchange_rates', 'Refresh exchange rates from external provider'),

  // ── Read: Clients ─────────────────────────────────────────────────────
  tool('list_clients', 'List all client organisations with status, plan, health score', {
    status: prop('string', 'Filter by status', { enum: ['prospect', 'active', 'paused', 'churned', 'archived'] }),
    planType: prop('string', 'Filter by plan type (maintain, scale, tune, launch, hourly)'),
  }),
  tool('get_client', 'Get full detail for a client: org info, contacts, subscription, tracks, requests', {
    clientId: prop('string', 'Client organisation ID'),
  }, ['clientId']),
  tool('list_client_contacts', 'List contacts for a specific client organisation', {
    clientId: prop('string', 'Client organisation ID'),
  }, ['clientId']),

  // ── Write: Clients ────────────────────────────────────────────────────
  tool('create_client', 'Create a new client organisation', {
    name: prop('string', 'Client company name'),
    website: prop('string', 'Client website URL'),
    industry: prop('string', 'Industry sector'),
    planType: prop('string', 'Plan type: maintain, scale, tune, launch, hourly, custom, none'),
    primaryContactEmail: prop('string', 'Primary contact email address'),
    primaryContactName: prop('string', 'Primary contact full name'),
  }, ['name']),
  tool('update_client', 'Update a client organisation', {
    clientId: prop('string', 'Client organisation ID'),
    name: prop('string', 'Updated company name'),
    status: prop('string', 'Updated status'),
    planType: prop('string', 'Updated plan type'),
    industry: prop('string', 'Updated industry'),
    website: prop('string', 'Updated website URL'),
    internalNotes: prop('string', 'Internal notes about the client'),
  }, ['clientId']),
  tool('create_client_contact', 'Create a new contact at a client organisation', {
    clientId: prop('string', 'Client organisation ID'),
    name: prop('string', 'Contact full name'),
    email: prop('string', 'Contact email address'),
    role: prop('string', 'Contact role at the company'),
  }, ['clientId', 'name', 'email']),
  tool('assign_client_pm', 'Assign a project manager to a client organisation', {
    clientId: prop('string', 'Client organisation ID'),
    teamMemberId: prop('string', 'Team member ID to assign as PM'),
  }, ['clientId', 'teamMemberId']),
  tool('send_welcome_email', 'Send a welcome/onboarding email to a client', {
    clientId: prop('string', 'Client organisation ID'),
  }, ['clientId']),

  // ── Read: Requests ────────────────────────────────────────────────────
  tool('list_requests', 'List work requests with optional filtering', {
    status: prop('string', 'Filter by status (submitted, in_review, in_progress, client_review, delivered)'),
    clientId: prop('string', 'Filter by client ID'),
    limit: prop('number', 'Limit results (default 50, max 100)'),
  }),
  tool('get_request', 'Get full detail for a request: metadata, messages, files, steps', {
    requestId: prop('string', 'Request ID'),
  }, ['requestId']),
  tool('get_request_messages', 'Get all messages for a specific request', {
    requestId: prop('string', 'Request ID'),
  }, ['requestId']),
  tool('get_request_steps', 'Get the workflow steps for a specific request', {
    requestId: prop('string', 'Request ID'),
  }, ['requestId']),

  // ── Write: Requests ───────────────────────────────────────────────────
  tool('create_request', 'Create a new request (work item) for a client', {
    title: prop('string', 'Title of the request'),
    clientOrgId: prop('string', 'Client organisation ID'),
    category: prop('string', 'Category: design, development, content, strategy, admin, bug'),
    priority: prop('string', 'Priority: standard or high'),
    type: prop('string', 'Type: small_task, large_task, bug_fix, content_update, new_feature, consultation, custom'),
    description: prop('string', 'Description of the request'),
    dueDate: prop('string', 'Due date in YYYY-MM-DD format'),
  }, ['title', 'clientOrgId']),
  tool('update_request_status', 'Update the status of a request', {
    requestId: prop('string', 'Request ID'),
    status: prop('string', 'New status: draft, submitted, in_review, in_progress, client_review, delivered, archived'),
  }, ['requestId', 'status']),
  tool('assign_request', 'Assign a team member to a request', {
    requestId: prop('string', 'Request ID'),
    assigneeId: prop('string', 'Team member ID to assign'),
  }, ['requestId', 'assigneeId']),
  tool('delete_request', 'Delete a request', {
    requestId: prop('string', 'Request ID'),
  }, ['requestId']),
  tool('post_request_message', 'Post a message on a request thread', {
    requestId: prop('string', 'Request ID'),
    content: prop('string', 'Message content'),
    isInternal: prop('boolean', 'Whether the message is internal (team only)'),
  }, ['requestId', 'content']),

  // ── Read: Tasks ───────────────────────────────────────────────────────
  tool('list_tasks', 'List tasks with optional filters', {
    status: prop('string', 'Filter by task status'),
    type: prop('string', 'Filter by type: client_external, internal_client, tahi_internal'),
    orgId: prop('string', 'Filter by client organisation ID'),
  }),
  tool('get_task', 'Get full detail for a specific task', {
    taskId: prop('string', 'Task ID'),
  }, ['taskId']),
  tool('list_task_subtasks', 'List subtasks for a specific task', {
    taskId: prop('string', 'Parent task ID'),
  }, ['taskId']),
  tool('list_task_templates', 'List all task templates'),

  // ── Write: Tasks ──────────────────────────────────────────────────────
  tool('create_task', 'Create a new task', {
    title: prop('string', 'Task title'),
    description: prop('string', 'Task description'),
    type: prop('string', 'Task type: client_external, internal_client, tahi_internal'),
    priority: prop('string', 'Priority: low, medium, high, urgent'),
    orgId: prop('string', 'Client organisation ID'),
    assigneeId: prop('string', 'Team member ID to assign'),
    dueDate: prop('string', 'Due date in YYYY-MM-DD format'),
  }, ['title', 'type']),
  tool('update_task', 'Update an existing task', {
    taskId: prop('string', 'Task ID'),
    status: prop('string', 'New status'),
    priority: prop('string', 'New priority: low, medium, high, urgent'),
    assigneeId: prop('string', 'New assignee team member ID'),
    description: prop('string', 'Updated description'),
    dueDate: prop('string', 'Updated due date in YYYY-MM-DD format'),
  }, ['taskId']),
  tool('create_task_subtask', 'Create a subtask under a task', {
    taskId: prop('string', 'Parent task ID'),
    title: prop('string', 'Subtask title'),
  }, ['taskId', 'title']),
  tool('toggle_task_subtask', 'Toggle the completion status of a subtask', {
    taskId: prop('string', 'Parent task ID'),
    subId: prop('string', 'Subtask ID'),
    isCompleted: prop('boolean', 'Whether the subtask is completed'),
  }, ['taskId', 'subId', 'isCompleted']),
  tool('add_task_dependency', 'Add a dependency to a task', {
    taskId: prop('string', 'Task ID'),
    dependsOnTaskId: prop('string', 'ID of the task this one depends on'),
  }, ['taskId', 'dependsOnTaskId']),
  tool('remove_task_dependency', 'Remove a dependency from a task', {
    taskId: prop('string', 'Task ID'),
    depId: prop('string', 'Dependency ID to remove'),
  }, ['taskId', 'depId']),
  tool('create_task_from_template', 'Create a new task from a template', {
    templateId: prop('string', 'Task template ID'),
    orgId: prop('string', 'Client organisation ID'),
    assigneeId: prop('string', 'Team member ID to assign'),
  }, ['templateId']),

  // ── Read: Invoices ────────────────────────────────────────────────────
  tool('list_invoices', 'List all invoices with status, amount, client, dates', {
    status: prop('string', 'Filter by status (draft, sent, overdue, paid)'),
  }),
  tool('get_invoice', 'Get full detail for a specific invoice including line items', {
    invoiceId: prop('string', 'Invoice ID'),
  }, ['invoiceId']),

  // ── Write: Invoices ───────────────────────────────────────────────────
  tool('create_invoice', 'Create a new invoice for a client', {
    orgId: prop('string', 'Client organisation ID'),
    amountUsd: prop('number', 'Invoice amount in USD'),
    totalUsd: prop('number', 'Total amount in USD (after tax/discount)'),
    notes: prop('string', 'Invoice notes'),
    dueDate: prop('string', 'Due date in YYYY-MM-DD format'),
  }, ['orgId', 'amountUsd', 'totalUsd']),
  tool('update_invoice', 'Update an existing invoice', {
    invoiceId: prop('string', 'Invoice ID'),
    status: prop('string', 'Updated status: draft, sent, overdue, paid, cancelled'),
    amount: prop('number', 'Updated amount'),
    dueDate: prop('string', 'Updated due date in YYYY-MM-DD format'),
  }, ['invoiceId']),
  tool('send_invoice_email', 'Send an invoice email to the client', {
    invoiceId: prop('string', 'Invoice ID'),
  }, ['invoiceId']),

  // ── Time Tracking ─────────────────────────────────────────────────────
  tool('list_time_entries', 'List time entries logged by team members'),
  tool('log_time', 'Log a time entry for a team member', {
    orgId: prop('string', 'Client organisation ID'),
    teamMemberId: prop('string', 'Team member ID'),
    hours: prop('number', 'Number of hours worked'),
    date: prop('string', 'Date of work in YYYY-MM-DD format'),
    requestId: prop('string', 'Associated request ID'),
    notes: prop('string', 'Description of work done'),
    billable: prop('boolean', 'Whether the time is billable (default true)'),
  }, ['orgId', 'teamMemberId', 'hours', 'date']),

  // ── Read: Team ────────────────────────────────────────────────────────
  tool('list_team', 'List all team members with roles, capacity, and skills'),
  tool('get_org_chart', 'Get the team org chart with reporting structure'),

  // ── Write: Team ───────────────────────────────────────────────────────
  tool('create_team_member', 'Create a new team member', {
    name: prop('string', 'Team member full name'),
    email: prop('string', 'Team member email'),
    role: prop('string', 'Role: admin, project_manager, designer, developer, content_writer'),
    title: prop('string', 'Job title'),
  }, ['name', 'email']),
  tool('update_team_member', 'Update a team member', {
    teamMemberId: prop('string', 'Team member ID'),
    name: prop('string', 'Updated name'),
    email: prop('string', 'Updated email'),
    role: prop('string', 'Updated role'),
    title: prop('string', 'Updated job title'),
    skills: prop('string', 'Updated skills (comma-separated)'),
  }, ['teamMemberId']),
  tool('delete_team_member', 'Delete a team member', {
    teamMemberId: prop('string', 'Team member ID'),
  }, ['teamMemberId']),

  // ── Contracts ─────────────────────────────────────────────────────────
  tool('list_contracts', 'List all contracts across clients'),
  tool('create_contract', 'Create a new contract for a client', {
    orgId: prop('string', 'Client organisation ID'),
    name: prop('string', 'Contract name'),
    type: prop('string', 'Contract type: nda, sla, msa, sow, other'),
    status: prop('string', 'Contract status: draft, sent, signed, expired, cancelled'),
  }, ['orgId', 'name', 'type']),
  tool('update_contract', 'Update an existing contract', {
    contractId: prop('string', 'Contract ID'),
    status: prop('string', 'Updated status'),
    name: prop('string', 'Updated name'),
    type: prop('string', 'Updated type'),
  }, ['contractId']),
  tool('delete_contract', 'Delete a contract', {
    contractId: prop('string', 'Contract ID'),
  }, ['contractId']),

  // ── Deals / Pipeline ──────────────────────────────────────────────────
  tool('list_deals', 'List all sales pipeline deals with stage, value, owner, company'),
  tool('get_pipeline_stages', 'Get all pipeline stages'),
  tool('create_deal', 'Create a new deal in the sales pipeline', {
    title: prop('string', 'Deal title'),
    orgId: prop('string', 'Client organisation ID'),
    value: prop('number', 'Deal value in dollars'),
    currency: prop('string', 'Currency code (e.g. USD, NZD)'),
    stageId: prop('string', 'Pipeline stage ID'),
    source: prop('string', 'Lead source'),
  }, ['title']),
  tool('update_deal', 'Update a deal in the sales pipeline', {
    dealId: prop('string', 'Deal ID'),
    stageId: prop('string', 'New pipeline stage ID'),
    value: prop('number', 'Updated deal value'),
    status: prop('string', 'Updated status'),
    ownerId: prop('string', 'New owner team member ID'),
    orgId: prop('string', 'Client organisation ID to link'),
    source: prop('string', 'Lead source'),
    notes: prop('string', 'Deal notes'),
    engagementType: prop('string', 'Engagement type: project or retainer'),
    totalHours: prop('number', 'Total project hours'),
    hoursPerMonth: prop('number', 'Monthly retainer hours'),
    engagementStartDate: prop('string', 'Engagement start date (YYYY-MM-DD)'),
    engagementEndDate: prop('string', 'Engagement end date (YYYY-MM-DD)'),
    autoNudgesDisabled: prop('boolean', 'Disable auto-nudges for this deal'),
  }, ['dealId']),
  tool('delete_deal', 'Delete a deal from the sales pipeline', {
    dealId: prop('string', 'Deal ID'),
  }, ['dealId']),

  // ── Nudge Emails ──────────────────────────────────────────────────────
  tool('list_nudge_templates', 'List all nudge email templates'),
  tool('create_nudge_template', 'Create a nudge email template', {
    name: prop('string', 'Template name'),
    subject: prop('string', 'Email subject (supports {{dealTitle}} variable)'),
    bodyHtml: prop('string', 'Email body HTML'),
    category: prop('string', 'Category: follow_up, check_in, proposal, intro, custom'),
  }, ['name', 'subject', 'bodyHtml']),
  tool('send_nudge', 'Send a nudge email to deal contacts', {
    dealId: prop('string', 'Deal ID'),
    contactEmails: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
    subject: prop('string', 'Email subject'),
    bodyHtml: prop('string', 'Email body HTML'),
    sendNow: prop('boolean', 'Send immediately (true) or save as draft (false)'),
    scheduledAt: prop('string', 'ISO timestamp to schedule send (alternative to sendNow)'),
  }, ['dealId', 'contactEmails', 'subject', 'bodyHtml']),
  tool('list_deal_nudges', 'List all nudges for a specific deal', {
    dealId: prop('string', 'Deal ID'),
  }, ['dealId']),

  // ── Calls ─────────────────────────────────────────────────────────────
  tool('list_calls', 'List all scheduled calls'),
  tool('create_call', 'Schedule a new call with a client', {
    orgId: prop('string', 'Client organisation ID'),
    title: prop('string', 'Call title'),
    scheduledAt: prop('string', 'Scheduled date/time in ISO format'),
    durationMinutes: prop('number', 'Call duration in minutes (default 30)'),
  }, ['orgId', 'title', 'scheduledAt']),
  tool('update_call', 'Update a scheduled call', {
    callId: prop('string', 'Call ID'),
    status: prop('string', 'Updated status: scheduled, completed, cancelled, no_show'),
    notes: prop('string', 'Call notes'),
    recordingUrl: prop('string', 'Recording URL'),
  }, ['callId']),

  // ── Subscriptions ─────────────────────────────────────────────────────
  tool('get_subscription', 'Get detail for a specific subscription', {
    subscriptionId: prop('string', 'Subscription ID'),
  }, ['subscriptionId']),
  tool('update_subscription', 'Update a subscription', {
    subscriptionId: prop('string', 'Subscription ID'),
    billingInterval: prop('string', 'Billing interval: monthly, quarterly, annual'),
    includedAddons: prop('string', 'Included add-ons as JSON string'),
  }, ['subscriptionId']),
  tool('change_billing_cycle', 'Change the billing cycle of a subscription', {
    subscriptionId: prop('string', 'Subscription ID'),
    newCycle: prop('string', 'New billing cycle: monthly, quarterly, annual'),
  }, ['subscriptionId', 'newCycle']),

  // ── Docs ──────────────────────────────────────────────────────────────
  tool('list_docs', 'List all knowledge hub documentation pages'),
  tool('get_doc', 'Get a specific documentation page with full content', {
    docId: prop('string', 'Doc page ID'),
  }, ['docId']),
  tool('create_doc', 'Create a new documentation page', {
    title: prop('string', 'Page title'),
    category: prop('string', 'Category for the doc page'),
    contentMd: prop('string', 'Markdown content for the page'),
  }, ['title', 'category']),
  tool('update_doc', 'Update a documentation page', {
    docId: prop('string', 'Doc page ID'),
    title: prop('string', 'Updated title'),
    contentMd: prop('string', 'Updated markdown content'),
    category: prop('string', 'Updated category'),
  }, ['docId']),
  tool('delete_doc', 'Delete a documentation page', {
    docId: prop('string', 'Doc page ID'),
  }, ['docId']),

  // ── Messaging ─────────────────────────────────────────────────────────
  tool('list_conversations', 'List all messaging conversations with unread counts'),
  tool('create_conversation', 'Create a new messaging conversation', {
    type: prop('string', 'Conversation type: direct, group, org_channel, request_thread'),
    participantIds: { type: 'array', items: { type: 'string' }, description: 'Array of participant IDs' },
    name: prop('string', 'Conversation name (for group or channel types)'),
  }, ['type', 'participantIds']),
  tool('send_message', 'Send a message in a conversation', {
    conversationId: prop('string', 'Conversation ID'),
    body: prop('string', 'Message body (plain text or Tiptap JSON)'),
    isInternal: prop('boolean', 'Whether the message is internal (team only)'),
  }, ['conversationId', 'body']),

  // ── Announcements ─────────────────────────────────────────────────────
  tool('create_announcement', 'Create a new announcement banner for clients', {
    title: prop('string', 'Announcement title'),
    body: prop('string', 'Announcement body text'),
    type: prop('string', 'Type: info, warning, success, maintenance'),
    targetType: prop('string', 'Target: all, plan_type, org'),
    targetValue: prop('string', 'Plan type or org ID when targeting specific audience'),
  }, ['title', 'body']),
  tool('send_announcement', 'Send an announcement to its target audience via email', {
    announcementId: prop('string', 'Announcement ID'),
  }, ['announcementId']),

  // ── Automations ───────────────────────────────────────────────────────
  tool('list_automations', 'List all automation rules'),
  tool('create_automation', 'Create a new automation rule', {
    name: prop('string', 'Automation rule name'),
    triggerType: prop('string', 'Trigger type: request_created, status_changed, overdue, etc.'),
    steps: prop('string', 'Automation steps as JSON string'),
  }, ['name', 'triggerType', 'steps']),

  // ── Reviews ───────────────────────────────────────────────────────────
  tool('list_reviews', 'List all client reviews and testimonial submissions'),

  // ── Settings ──────────────────────────────────────────────────────────
  tool('get_settings', 'Get all dashboard settings'),
  tool('update_settings', 'Update a dashboard setting', {
    key: prop('string', 'Setting key'),
    value: prop('string', 'Setting value'),
  }, ['key', 'value']),

  // ── AI ────────────────────────────────────────────────────────────────
  // ── Financial / Xero ───────────────────────────────────────────────
  tool('get_financial_health', 'Get financial health: invoice totals, pipeline projections, MRR, Xero P&L, bank balances'),
  tool('import_xero_invoices', 'Import all ACCREC invoices from Xero into dashboard with auto-match to clients'),
  tool('sync_xero_payments', 'Sync invoice payment statuses from Xero'),
  tool('get_xero_profit_loss', 'Get Xero Profit and Loss report', {
    fromDate: prop('string', 'Start date YYYY-MM-DD'),
    toDate: prop('string', 'End date YYYY-MM-DD'),
  }),
  tool('get_xero_balance_sheet', 'Get Xero Balance Sheet report'),
  tool('get_xero_bank_summary', 'Get Xero bank account balances'),
  tool('auto_generate_invoices', 'Auto-generate draft invoices for hourly clients from billable time entries', {
    month: prop('string', 'Month to invoice (YYYY-MM), defaults to previous month'),
    dryRun: prop('boolean', 'Preview only without creating invoices'),
  }),
  tool('match_xero_contacts', 'List Xero contacts with suggested dashboard client matches'),
  tool('import_stripe_invoices', 'Import all invoices from Stripe into dashboard'),
  tool('import_stripe_payments', 'Import one-off Stripe payments (charges without invoices) as paid records'),
  tool('create_stripe_invoice', 'Create a Stripe invoice from a local invoice and get payment link', {
    invoiceId: prop('string', 'Local invoice ID to create Stripe invoice from'),
  }, ['invoiceId']),
  tool('get_xero_branding_themes', 'Get available Xero branding themes'),

  // ── AI ────────────────────────────────────────────────────────────
  tool('ai_task_wizard', 'Use AI to break down work into tasks, estimate effort, and suggest assignments', {
    messages: { type: 'array', items: { type: 'object', properties: { role: { type: 'string' }, content: { type: 'string' } } }, description: 'Conversation messages for the AI wizard' },
    context: prop('string', 'Additional context about the client or project'),
  }, ['messages']),
]

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  token: string,
): Promise<string> {
  const json = (data: unknown) => JSON.stringify(data, null, 2)
  const s = (key: string) => args[key] ? String(args[key]) : undefined

  switch (name) {
    // ── Overview & Reports ────────────────────────────────────────────
    case 'get_overview':
      return json(await apiGet('/api/admin/overview', token))
    case 'get_reports':
      return json(await apiGet('/api/admin/reports/overview', token))
    case 'get_billing_summary':
      return json(await apiGet('/api/admin/reports/billing-summary', token))
    case 'get_response_time':
      return json(await apiGet('/api/admin/reports/response-time', token))
    case 'get_exchange_rates':
      return json(await apiGet('/api/admin/exchange-rates', token))
    case 'refresh_exchange_rates':
      return json(await apiWrite('/api/admin/exchange-rates', token, 'POST'))

    // ── Clients ───────────────────────────────────────────────────────
    case 'list_clients': {
      const p: Record<string, string> = {}
      if (s('status')) p.status = s('status')!
      if (s('planType')) p.planType = s('planType')!
      return json(await apiGet('/api/admin/clients', token, p))
    }
    case 'get_client':
      return json(await apiGet(`/api/admin/clients/${s('clientId')}`, token))
    case 'list_client_contacts':
      return json(await apiGet(`/api/admin/clients/${s('clientId')}/contacts`, token))
    case 'create_client':
      return json(await apiWrite('/api/admin/clients', token, 'POST', args as Record<string, unknown>))
    case 'update_client': {
      const { clientId, ...body } = args
      return json(await apiWrite(`/api/admin/clients/${clientId}`, token, 'PATCH', body))
    }
    case 'create_client_contact': {
      const { clientId, ...body } = args
      return json(await apiWrite(`/api/admin/clients/${clientId}/contacts`, token, 'POST', body))
    }
    case 'assign_client_pm':
      return json(await apiWrite(`/api/admin/clients/${s('clientId')}/pm`, token, 'PUT', { teamMemberId: s('teamMemberId') }))
    case 'send_welcome_email':
      return json(await apiWrite(`/api/admin/clients/${s('clientId')}/welcome-email`, token, 'POST'))

    // ── Requests ──────────────────────────────────────────────────────
    case 'list_requests': {
      const p: Record<string, string> = {}
      if (s('status')) p.status = s('status')!
      if (s('clientId')) p.orgId = s('clientId')!
      if (s('limit')) p.limit = s('limit')!
      return json(await apiGet('/api/admin/requests', token, p))
    }
    case 'get_request':
      return json(await apiGet(`/api/admin/requests/${s('requestId')}`, token))
    case 'get_request_messages':
      return json(await apiGet(`/api/admin/requests/${s('requestId')}/messages`, token))
    case 'get_request_steps':
      return json(await apiGet(`/api/admin/requests/${s('requestId')}/steps`, token))
    case 'create_request':
      return json(await apiWrite('/api/admin/requests', token, 'POST', args as Record<string, unknown>))
    case 'update_request_status':
      return json(await apiWrite(`/api/admin/requests/${s('requestId')}`, token, 'PATCH', { status: s('status') }))
    case 'assign_request':
      return json(await apiWrite(`/api/admin/requests/${s('requestId')}`, token, 'PATCH', { assigneeId: s('assigneeId') }))
    case 'delete_request':
      return json(await apiWrite(`/api/admin/requests/${s('requestId')}`, token, 'DELETE'))
    case 'post_request_message':
      return json(await apiWrite(`/api/admin/requests/${s('requestId')}/messages`, token, 'POST', {
        content: s('content'), isInternal: args.isInternal ?? false,
      }))

    // ── Tasks ─────────────────────────────────────────────────────────
    case 'list_tasks': {
      const p: Record<string, string> = {}
      if (s('status')) p.status = s('status')!
      if (s('type')) p.type = s('type')!
      if (s('orgId')) p.orgId = s('orgId')!
      return json(await apiGet('/api/admin/tasks', token, p))
    }
    case 'get_task':
      return json(await apiGet(`/api/admin/tasks/${s('taskId')}`, token))
    case 'list_task_subtasks':
      return json(await apiGet(`/api/admin/tasks/${s('taskId')}/subtasks`, token))
    case 'list_task_templates':
      return json(await apiGet('/api/admin/task-templates', token))
    case 'create_task':
      return json(await apiWrite('/api/admin/tasks', token, 'POST', args as Record<string, unknown>))
    case 'update_task': {
      const { taskId, ...body } = args
      return json(await apiWrite(`/api/admin/tasks/${taskId}`, token, 'PATCH', body))
    }
    case 'create_task_subtask':
      return json(await apiWrite(`/api/admin/tasks/${s('taskId')}/subtasks`, token, 'POST', { title: s('title') }))
    case 'toggle_task_subtask':
      return json(await apiWrite(`/api/admin/tasks/${s('taskId')}/subtasks/${s('subId')}`, token, 'PATCH', { isCompleted: args.isCompleted }))
    case 'add_task_dependency':
      return json(await apiWrite(`/api/admin/tasks/${s('taskId')}/dependencies`, token, 'POST', { dependsOnTaskId: s('dependsOnTaskId') }))
    case 'remove_task_dependency':
      return json(await apiWrite(`/api/admin/tasks/${s('taskId')}/dependencies/${s('depId')}`, token, 'DELETE'))
    case 'create_task_from_template':
      return json(await apiWrite('/api/admin/tasks/from-template', token, 'POST', args as Record<string, unknown>))

    // ── Invoices ──────────────────────────────────────────────────────
    case 'list_invoices': {
      const p: Record<string, string> = {}
      if (s('status')) p.status = s('status')!
      return json(await apiGet('/api/admin/invoices', token, p))
    }
    case 'get_invoice':
      return json(await apiGet(`/api/admin/invoices/${s('invoiceId')}`, token))
    case 'create_invoice':
      return json(await apiWrite('/api/admin/invoices', token, 'POST', args as Record<string, unknown>))
    case 'update_invoice': {
      const { invoiceId, ...body } = args
      return json(await apiWrite(`/api/admin/invoices/${invoiceId}`, token, 'PATCH', body))
    }
    case 'send_invoice_email':
      return json(await apiWrite(`/api/admin/invoices/${s('invoiceId')}/send-email`, token, 'POST'))

    // ── Time Tracking ─────────────────────────────────────────────────
    case 'list_time_entries':
      return json(await apiGet('/api/admin/time', token))
    case 'log_time':
      return json(await apiWrite('/api/admin/time', token, 'POST', args as Record<string, unknown>))

    // ── Team ──────────────────────────────────────────────────────────
    case 'list_team':
      return json(await apiGet('/api/admin/team', token))
    case 'get_org_chart':
      return json(await apiGet('/api/admin/team/org-chart', token))
    case 'create_team_member':
      return json(await apiWrite('/api/admin/team', token, 'POST', args as Record<string, unknown>))
    case 'update_team_member': {
      const { teamMemberId, ...body } = args
      return json(await apiWrite(`/api/admin/team/${teamMemberId}`, token, 'PUT', body))
    }
    case 'delete_team_member':
      return json(await apiWrite(`/api/admin/team/${s('teamMemberId')}`, token, 'DELETE'))

    // ── Contracts ─────────────────────────────────────────────────────
    case 'list_contracts':
      return json(await apiGet('/api/admin/contracts', token))
    case 'create_contract':
      return json(await apiWrite('/api/admin/contracts', token, 'POST', args as Record<string, unknown>))
    case 'update_contract': {
      const { contractId, ...body } = args
      return json(await apiWrite(`/api/admin/contracts/${contractId}`, token, 'PUT', body))
    }
    case 'delete_contract':
      return json(await apiWrite(`/api/admin/contracts/${s('contractId')}`, token, 'DELETE'))

    // ── Deals / Pipeline ──────────────────────────────────────────────
    case 'list_deals':
      return json(await apiGet('/api/admin/deals', token))
    case 'get_pipeline_stages':
      return json(await apiGet('/api/admin/pipeline/stages', token))
    case 'create_deal':
      return json(await apiWrite('/api/admin/deals', token, 'POST', args as Record<string, unknown>))
    case 'update_deal': {
      const { dealId, ...body } = args
      return json(await apiWrite(`/api/admin/deals/${dealId}`, token, 'PATCH', body))
    }
    case 'delete_deal':
      return json(await apiWrite(`/api/admin/deals/${s('dealId')}`, token, 'DELETE'))

    // ── Nudge Emails ──────────────────────────────────────────────────
    case 'list_nudge_templates':
      return json(await apiGet('/api/admin/nudge-templates', token))
    case 'create_nudge_template':
      return json(await apiWrite('/api/admin/nudge-templates', token, 'POST', args as Record<string, unknown>))
    case 'send_nudge': {
      const { dealId: nDealId, ...nudgeBody } = args
      return json(await apiWrite(`/api/admin/deals/${nDealId}/nudges`, token, 'POST', nudgeBody))
    }
    case 'list_deal_nudges':
      return json(await apiGet(`/api/admin/deals/${s('dealId')}/nudges`, token))

    // ── Calls ─────────────────────────────────────────────────────────
    case 'list_calls':
      return json(await apiGet('/api/admin/calls', token))
    case 'create_call':
      return json(await apiWrite('/api/admin/calls', token, 'POST', args as Record<string, unknown>))
    case 'update_call': {
      const { callId, ...body } = args
      return json(await apiWrite(`/api/admin/calls/${callId}`, token, 'PATCH', body))
    }

    // ── Subscriptions ─────────────────────────────────────────────────
    case 'get_subscription':
      return json(await apiGet(`/api/admin/subscriptions/${s('subscriptionId')}`, token))
    case 'update_subscription': {
      const { subscriptionId, ...body } = args
      return json(await apiWrite(`/api/admin/subscriptions/${subscriptionId}`, token, 'PUT', body))
    }
    case 'change_billing_cycle':
      return json(await apiWrite(`/api/admin/subscriptions/${s('subscriptionId')}/change-cycle`, token, 'POST', { newCycle: s('newCycle') }))

    // ── Docs ──────────────────────────────────────────────────────────
    case 'list_docs':
      return json(await apiGet('/api/admin/docs', token))
    case 'get_doc':
      return json(await apiGet(`/api/admin/docs/${s('docId')}`, token))
    case 'create_doc':
      return json(await apiWrite('/api/admin/docs', token, 'POST', args as Record<string, unknown>))
    case 'update_doc': {
      const { docId, ...body } = args
      return json(await apiWrite(`/api/admin/docs/${docId}`, token, 'PATCH', body))
    }
    case 'delete_doc':
      return json(await apiWrite(`/api/admin/docs/${s('docId')}`, token, 'DELETE'))

    // ── Messaging ─────────────────────────────────────────────────────
    case 'list_conversations':
      return json(await apiGet('/api/admin/conversations', token))
    case 'create_conversation':
      return json(await apiWrite('/api/admin/conversations', token, 'POST', args as Record<string, unknown>))
    case 'send_message':
      return json(await apiWrite(`/api/admin/conversations/${s('conversationId')}/messages`, token, 'POST', {
        body: s('body'), isInternal: args.isInternal ?? false,
      }))

    // ── Announcements ─────────────────────────────────────────────────
    case 'create_announcement':
      return json(await apiWrite('/api/admin/announcements', token, 'POST', args as Record<string, unknown>))
    case 'send_announcement':
      return json(await apiWrite(`/api/admin/announcements/${s('announcementId')}/send`, token, 'POST'))

    // ── Automations ───────────────────────────────────────────────────
    case 'list_automations':
      return json(await apiGet('/api/admin/automations', token))
    case 'create_automation':
      return json(await apiWrite('/api/admin/automations', token, 'POST', args as Record<string, unknown>))

    // ── Reviews ───────────────────────────────────────────────────────
    case 'list_reviews':
      return json(await apiGet('/api/admin/reviews', token))

    // ── Settings ──────────────────────────────────────────────────────
    case 'get_settings':
      return json(await apiGet('/api/admin/settings', token))
    case 'update_settings':
      return json(await apiWrite('/api/admin/settings', token, 'PATCH', args as Record<string, unknown>))

    // ── Financial / Xero ──────────────────────────────────────────────
    case 'get_financial_health':
      return json(await apiGet('/api/admin/billing/financial-health', token))
    case 'import_xero_invoices':
      return json(await apiWrite('/api/admin/integrations/xero/import-invoices', token, 'POST'))
    case 'sync_xero_payments':
      return json(await apiWrite('/api/admin/integrations/xero/sync-payments', token, 'POST'))
    case 'get_xero_profit_loss': {
      const p: Record<string, string> = {}
      if (s('fromDate')) p.fromDate = s('fromDate')!
      if (s('toDate')) p.toDate = s('toDate')!
      return json(await apiGet('/api/admin/integrations/xero/profit-loss', token, p))
    }
    case 'get_xero_balance_sheet':
      return json(await apiGet('/api/admin/integrations/xero/balance-sheet', token))
    case 'get_xero_bank_summary':
      return json(await apiGet('/api/admin/integrations/xero/bank-summary', token))
    case 'auto_generate_invoices':
      return json(await apiWrite('/api/admin/billing/xero-export', token, 'POST', args as Record<string, unknown>))
    case 'match_xero_contacts':
      return json(await apiGet('/api/admin/integrations/xero/match-contacts', token))
    case 'import_stripe_invoices':
      return json(await apiWrite('/api/admin/integrations/stripe/import-invoices', token, 'POST'))
    case 'import_stripe_payments':
      return json(await apiWrite('/api/admin/integrations/stripe/import-payments', token, 'POST'))
    case 'create_stripe_invoice':
      return json(await apiWrite('/api/admin/invoices/stripe-create', token, 'POST', args as Record<string, unknown>))
    case 'get_xero_branding_themes':
      return json(await apiGet('/api/admin/integrations/xero/branding-themes', token))

    // ── AI ────────────────────────────────────────────────────────────
    case 'ai_task_wizard':
      return json(await apiWrite('/api/admin/ai/task-wizard', token, 'POST', args as Record<string, unknown>))

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC handler
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: string
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

function jsonRpcSuccess(id: string | number | undefined, result: unknown) {
  return corsResponse({ jsonrpc: '2.0', id, result })
}

function jsonRpcError(
  id: string | number | undefined,
  code: number,
  message: string,
  status = 200,
) {
  return corsResponse({ jsonrpc: '2.0', id, error: { code, message } }, status)
}

async function handleJsonRpc(body: JsonRpcRequest, env: Env): Promise<Response> {
  if (body.jsonrpc !== '2.0') {
    return jsonRpcError(body.id, -32600, 'Invalid JSON-RPC version', 400)
  }

  switch (body.method) {
    case 'initialize':
      return jsonRpcSuccess(body.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'Tahi Dashboard MCP Server',
          version: '2.0.0',
        },
      })

    case 'notifications/initialized':
      return jsonRpcSuccess(body.id, {})

    case 'tools/list':
      return jsonRpcSuccess(body.id, { tools: TOOLS })

    case 'tools/call': {
      const toolParams = body.params as
        | { name: string; arguments?: Record<string, unknown> }
        | undefined

      if (!toolParams?.name) {
        return jsonRpcError(body.id, -32602, 'Missing tool name')
      }

      const toolDef = TOOLS.find((t) => t.name === toolParams.name)
      if (!toolDef) {
        return jsonRpcError(body.id, -32602, `Unknown tool: ${toolParams.name}`)
      }

      try {
        const text = await executeTool(
          toolParams.name,
          toolParams.arguments ?? {},
          env.TAHI_API_TOKEN,
        )
        return jsonRpcSuccess(body.id, {
          content: [{ type: 'text', text }],
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Tool execution failed'
        return jsonRpcSuccess(body.id, {
          content: [{ type: 'text', text: `Error: ${msg}` }],
          isError: true,
        })
      }
    }

    default:
      return jsonRpcError(body.id, -32601, `Method not found: ${body.method}`)
  }
}

// ---------------------------------------------------------------------------
// OAuth 2.1 Authorization Code Flow with PKCE
// ---------------------------------------------------------------------------

const TOKEN_EXPIRY_SECONDS = 3600 // 1 hour
const CODE_EXPIRY_SECONDS = 600   // 10 minutes

/** Sign a payload with HMAC-SHA256 using the client secret */
async function hmacSign(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Create a signed token: base64(payload).signature */
async function createSignedToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const signature = await hmacSign(encoded, secret)
  return `${encoded}.${signature}`
}

/** Validate a signed token and return its payload */
async function validateSignedToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  const [encoded, signature] = parts
  const expectedSig = await hmacSign(encoded, secret)
  if (signature !== expectedSig) return null

  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (encoded.length % 4)) % 4)
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

/** Create a signed access token */
async function createAccessToken(clientId: string, secret: string): Promise<{ token: string; expiresIn: number }> {
  const token = await createSignedToken({
    sub: clientId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS,
    type: 'access_token',
  }, secret)
  return { token, expiresIn: TOKEN_EXPIRY_SECONDS }
}

/** Validate an access token */
async function validateAccessToken(token: string, env: Env): Promise<boolean> {
  const payload = await validateSignedToken(token, env.OAUTH_CLIENT_SECRET)
  if (!payload) return false
  return payload.sub === env.OAUTH_CLIENT_ID && payload.type === 'access_token'
}

/** Create a signed authorization code (contains PKCE challenge + redirect_uri for validation) */
async function createAuthCode(
  clientId: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  redirectUri: string,
  secret: string,
): Promise<string> {
  return createSignedToken({
    sub: clientId,
    exp: Math.floor(Date.now() / 1000) + CODE_EXPIRY_SECONDS,
    type: 'auth_code',
    cc: codeChallenge,
    ccm: codeChallengeMethod,
    ruri: redirectUri,
  }, secret)
}

/** Verify PKCE code_verifier against stored code_challenge */
async function verifyPkce(codeVerifier: string, codeChallenge: string, method: string): Promise<boolean> {
  if (method === 'S256') {
    const encoder = new TextEncoder()
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(codeVerifier))
    const computed = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    return computed === codeChallenge
  }
  // plain method
  return codeVerifier === codeChallenge
}

/** GET /authorize - OAuth authorization endpoint (auto-approves for valid client_id) */
function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const clientId = url.searchParams.get('client_id')
  const redirectUri = url.searchParams.get('redirect_uri')
  const responseType = url.searchParams.get('response_type')
  const state = url.searchParams.get('state')
  const codeChallenge = url.searchParams.get('code_challenge')
  const codeChallengeMethod = url.searchParams.get('code_challenge_method') ?? 'S256'

  if (responseType !== 'code') {
    return Promise.resolve(corsResponse({ error: 'unsupported_response_type' }, 400))
  }

  if (!clientId || clientId !== env.OAUTH_CLIENT_ID) {
    return Promise.resolve(corsResponse({ error: 'invalid_client' }, 401))
  }

  if (!redirectUri || !codeChallenge) {
    return Promise.resolve(corsResponse({ error: 'invalid_request', error_description: 'redirect_uri and code_challenge required' }, 400))
  }

  // Auto-approve: generate auth code and redirect back
  return createAuthCode(clientId, codeChallenge, codeChallengeMethod, redirectUri, env.OAUTH_CLIENT_SECRET)
    .then((code) => {
      const redirectUrl = new URL(redirectUri)
      redirectUrl.searchParams.set('code', code)
      if (state) redirectUrl.searchParams.set('state', state)

      return new Response(null, {
        status: 302,
        headers: {
          Location: redirectUrl.toString(),
          ...CORS_HEADERS,
        },
      })
    })
}

/** POST /oauth/token - Token exchange endpoint */
async function handleOAuthToken(request: Request, env: Env): Promise<Response> {
  const contentType = request.headers.get('Content-Type') ?? ''

  let params: URLSearchParams

  if (contentType.includes('application/x-www-form-urlencoded')) {
    params = new URLSearchParams(await request.text())
  } else if (contentType.includes('application/json')) {
    const body = await request.json() as Record<string, string>
    params = new URLSearchParams(body)
  } else {
    return corsResponse({ error: 'unsupported_content_type' }, 400)
  }

  const grantType = params.get('grant_type')

  // ── Authorization code exchange ───────────────────────────────────
  if (grantType === 'authorization_code') {
    const code = params.get('code')
    const clientId = params.get('client_id')
    const codeVerifier = params.get('code_verifier')
    const redirectUri = params.get('redirect_uri')

    if (!code || !clientId || !codeVerifier) {
      return corsResponse({ error: 'invalid_request', error_description: 'code, client_id, and code_verifier required' }, 400)
    }

    if (clientId !== env.OAUTH_CLIENT_ID) {
      return corsResponse({ error: 'invalid_client' }, 401)
    }

    // Validate the auth code
    const codePayload = await validateSignedToken(code, env.OAUTH_CLIENT_SECRET)
    if (!codePayload || codePayload.type !== 'auth_code' || codePayload.sub !== clientId) {
      return corsResponse({ error: 'invalid_grant', error_description: 'Invalid or expired authorization code' }, 400)
    }

    // Validate redirect_uri matches
    if (redirectUri && codePayload.ruri !== redirectUri) {
      return corsResponse({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400)
    }

    // Verify PKCE
    const pkceValid = await verifyPkce(codeVerifier, codePayload.cc as string, codePayload.ccm as string)
    if (!pkceValid) {
      return corsResponse({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400)
    }

    const { token, expiresIn } = await createAccessToken(clientId, env.OAUTH_CLIENT_SECRET)
    return corsResponse({
      access_token: token,
      token_type: 'bearer',
      expires_in: expiresIn,
    })
  }

  // ── Client credentials (for direct API use) ──────────────────────
  if (grantType === 'client_credentials') {
    const clientId = params.get('client_id')
    const clientSecret = params.get('client_secret')

    if (!clientId || !clientSecret) {
      return corsResponse({ error: 'invalid_request', error_description: 'client_id and client_secret required' }, 400)
    }

    if (clientId !== env.OAUTH_CLIENT_ID || clientSecret !== env.OAUTH_CLIENT_SECRET) {
      return corsResponse({ error: 'invalid_client' }, 401)
    }

    const { token, expiresIn } = await createAccessToken(clientId, env.OAUTH_CLIENT_SECRET)
    return corsResponse({
      access_token: token,
      token_type: 'bearer',
      expires_in: expiresIn,
    })
  }

  return corsResponse({ error: 'unsupported_grant_type' }, 400)
}

/** Extract and validate bearer token from request */
async function authenticateRequest(request: Request, env: Env): Promise<Response | null> {
  const origin = new URL(request.url).origin
  const resourceMetadataUrl = `${origin}/.well-known/oauth-protected-resource`

  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'unauthorized', message: 'Bearer token required' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl}"`,
        ...CORS_HEADERS,
      },
    })
  }

  const token = authHeader.slice(7)
  const valid = await validateAccessToken(token, env)
  if (!valid) {
    return new Response(JSON.stringify({ error: 'invalid_token', message: 'Token is invalid or expired' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${resourceMetadataUrl}"`,
        ...CORS_HEADERS,
      },
    })
  }

  return null // Auth passed
}

// ---------------------------------------------------------------------------
// OAuth Discovery Metadata (RFC 9728 + RFC 8414)
// ---------------------------------------------------------------------------

/** GET /.well-known/oauth-protected-resource - MCP spec required */
function handleProtectedResourceMetadata(origin: string): Response {
  return corsResponse({
    resource: origin,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
  })
}

/** GET /.well-known/oauth-authorization-server - RFC 8414 */
function handleAuthServerMetadata(origin: string): Response {
  return corsResponse({
    issuer: origin,
    authorization_endpoint: `${origin}/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    grant_types_supported: ['authorization_code', 'client_credentials'],
    response_types_supported: ['code'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp:tools'],
  })
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    // ── Public GET endpoints (no auth) ────────────────────────────────

    if (request.method === 'GET') {
      // OAuth Protected Resource Metadata (RFC 9728) - MCP spec required
      if (url.pathname === '/.well-known/oauth-protected-resource') {
        return handleProtectedResourceMetadata(url.origin)
      }

      // OAuth Authorization Server Metadata (RFC 8414)
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return handleAuthServerMetadata(url.origin)
      }

      // OpenID Connect discovery (fallback for some clients)
      if (url.pathname === '/.well-known/openid-configuration') {
        return handleAuthServerMetadata(url.origin)
      }

      // OAuth authorize endpoint (auto-approves for valid client_id)
      if (url.pathname === '/authorize') {
        return handleAuthorize(request, env)
      }

      // Server info
      if (url.pathname === '/' || url.pathname === '') {
        return corsResponse({
          name: 'Tahi Dashboard MCP Server',
          version: '2.2.0',
          description: 'Access Tahi Dashboard data and operations through the Model Context Protocol',
          auth: 'OAuth 2.0 client_credentials',
          tokenEndpoint: `${url.origin}/oauth/token`,
          resourceMetadata: `${url.origin}/.well-known/oauth-protected-resource`,
          toolCount: TOOLS.length,
          tools: TOOLS.map((t) => t.name),
        })
      }

      return corsResponse({ error: 'Not found' }, 404)
    }

    // ── POST endpoints ────────────────────────────────────────────────

    if (request.method === 'POST') {
      // OAuth token endpoint (no bearer auth required, uses client credentials)
      if (url.pathname === '/oauth/token') {
        return handleOAuthToken(request, env)
      }

      // MCP JSON-RPC endpoint (requires bearer auth)
      const authError = await authenticateRequest(request, env)
      if (authError) return authError

      try {
        const body = (await request.json()) as JsonRpcRequest
        return handleJsonRpc(body, env)
      } catch {
        return jsonRpcError(undefined, -32700, 'Parse error', 400)
      }
    }

    return corsResponse({ error: 'Method not allowed' }, 405)
  },
} satisfies ExportedHandler<Env>
