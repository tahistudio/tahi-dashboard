/**
 * Tahi Dashboard MCP Server
 *
 * Exposes dashboard data as MCP resources and dashboard actions as MCP tools.
 * Communicates with the Tahi Dashboard API over HTTP using a bearer token.
 *
 * Required environment variables:
 *   TAHI_API_URL   - Base URL of the dashboard (e.g. http://localhost:3000)
 *   TAHI_API_TOKEN - Bearer token for authenticating API requests
 *
 * Run: npx tsx index.ts
 * Install deps first: npm install
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Auth and config
// ---------------------------------------------------------------------------

const DASHBOARD_URL = process.env.TAHI_API_URL
const TOKEN = process.env.TAHI_API_TOKEN

if (!DASHBOARD_URL) {
  process.stderr.write('Error: TAHI_API_URL environment variable is required\n')
  process.exit(1)
}

if (!TOKEN) {
  process.stderr.write('Error: TAHI_API_TOKEN environment variable is required\n')
  process.exit(1)
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

// If TAHI_API_URL already includes /dashboard, don't double it
const BASE_PATH = DASHBOARD_URL?.endsWith('/dashboard') ? '' : (process.env.TAHI_BASE_PATH ?? '/dashboard')

async function apiFetch(
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {}
): Promise<unknown> {
  const url = `${DASHBOARD_URL}${BASE_PATH}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  }

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`API ${options.method ?? 'GET'} ${path} returned ${res.status}: ${errorText}`)
  }

  return res.json()
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: 'tahi-dashboard',
  version: '1.0.0',
})

// ---------------------------------------------------------------------------
// Resources (T229-T236)
// ---------------------------------------------------------------------------

server.resource(
  'overview',
  'dashboard://overview',
  'Dashboard overview with KPIs, recent requests, and summary stats',
  async () => {
    const data = await apiFetch('/api/admin/overview')
    return {
      contents: [{ uri: 'dashboard://overview', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

server.resource(
  'clients',
  'dashboard://clients',
  'List of all client organisations',
  async () => {
    const data = await apiFetch('/api/admin/clients')
    return {
      contents: [{ uri: 'dashboard://clients', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

server.resource(
  'client-detail',
  'dashboard://clients/{id}',
  'Detail for a specific client organisation',
  async (uri) => {
    const id = uri.pathname.split('/').pop()
    const data = await apiFetch(`/api/admin/clients/${id}`)
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

server.resource(
  'requests',
  'dashboard://requests',
  'List of all requests (work items)',
  async () => {
    const data = await apiFetch('/api/admin/requests?status=all')
    return {
      contents: [{ uri: 'dashboard://requests', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

server.resource(
  'request-detail',
  'dashboard://requests/{id}',
  'Detail for a specific request including messages and files',
  async (uri) => {
    const id = uri.pathname.split('/').pop()
    const data = await apiFetch(`/api/admin/requests/${id}`)
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

server.resource(
  'invoices',
  'dashboard://invoices',
  'List of all invoices',
  async () => {
    const data = await apiFetch('/api/admin/invoices')
    return {
      contents: [{ uri: 'dashboard://invoices', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

server.resource(
  'time-entries',
  'dashboard://time-entries',
  'List of time entries logged by team members',
  async () => {
    const data = await apiFetch('/api/admin/time')
    return {
      contents: [{ uri: 'dashboard://time-entries', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

server.resource(
  'reports',
  'dashboard://reports',
  'Reports overview with billing summary and key metrics',
  async () => {
    const data = await apiFetch('/api/admin/reports/overview')
    return {
      contents: [{ uri: 'dashboard://reports', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

server.resource(
  'docs',
  'dashboard://docs',
  'List of knowledge hub documentation pages',
  async () => {
    const data = await apiFetch('/api/admin/docs')
    return {
      contents: [{ uri: 'dashboard://docs', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

server.resource(
  'doc-detail',
  'dashboard://docs/{id}',
  'Detail for a specific documentation page',
  async (uri) => {
    const id = uri.pathname.split('/').pop()
    const data = await apiFetch(`/api/admin/docs/${id}`)
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

server.resource(
  'pipeline',
  'dashboard://pipeline',
  'Sales pipeline: list of deals with stage, value, owner, and company',
  async () => {
    const data = await apiFetch('/api/admin/deals')
    return {
      contents: [{ uri: 'dashboard://pipeline', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

server.resource(
  'capacity',
  'dashboard://capacity',
  'Team capacity: current utilization per member, available hours, and forecast',
  async () => {
    const data = await apiFetch('/api/admin/capacity')
    return {
      contents: [{ uri: 'dashboard://capacity', mimeType: 'application/json', text: JSON.stringify(data, null, 2) }],
    }
  }
)

// ---------------------------------------------------------------------------
// Read Tools (so clients that don't support resources can still read data)
// ---------------------------------------------------------------------------

server.tool(
  'get_overview',
  'Get dashboard overview: KPIs, recent requests, summary stats',
  {},
  async () => {
    const data = await apiFetch('/api/admin/overview')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_clients',
  'List all client organisations with status, plan, health score',
  {},
  async () => {
    const data = await apiFetch('/api/admin/clients')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_client',
  'Get full detail for a specific client: org info, contacts, subscription, tracks, recent requests',
  { clientId: z.string().describe('Client organisation ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/clients/${args.clientId}`)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_requests',
  'List all requests (work items) with status, priority, assignee, client',
  { status: z.string().optional().describe('Filter by status (e.g. submitted, in_progress, delivered)') },
  async (args) => {
    const params = args.status ? `?status=${args.status}` : ''
    const data = await apiFetch(`/api/admin/requests${params}`)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_request',
  'Get full detail for a specific request: metadata, messages, files, steps',
  { requestId: z.string().describe('Request ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/requests/${args.requestId}`)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_invoices',
  'List all invoices with status, amount, client, dates',
  { status: z.string().optional().describe('Filter by status (draft, sent, overdue, paid)') },
  async (args) => {
    const params = args.status ? `?status=${args.status}` : ''
    const data = await apiFetch(`/api/admin/invoices${params}`)
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_time_entries',
  'List time entries logged by team members with hours, client, billable status',
  {},
  async () => {
    const data = await apiFetch('/api/admin/time')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_reports',
  'Get aggregate reports: total clients, requests, billable hours, outstanding invoices, monthly trends',
  {},
  async () => {
    const data = await apiFetch('/api/admin/reports/overview')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_deals',
  'List all sales pipeline deals with stage, value, owner, company',
  {},
  async () => {
    const data = await apiFetch('/api/admin/deals')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_capacity',
  'Get team capacity: utilization per member, available hours, pipeline impact, forecasted capacity',
  {},
  async () => {
    const data = await apiFetch('/api/admin/capacity')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_team',
  'List all team members with roles, capacity, and skills',
  {},
  async () => {
    const data = await apiFetch('/api/admin/team')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_docs',
  'List all knowledge hub documentation pages',
  {},
  async () => {
    const data = await apiFetch('/api/admin/docs')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_conversations',
  'List all messaging conversations with unread counts',
  {},
  async () => {
    const data = await apiFetch('/api/admin/conversations')
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Write Tools (T237-T244)
// ---------------------------------------------------------------------------

server.tool(
  'create_request',
  'Create a new request (work item) for a client',
  {
    title: z.string().describe('Title of the request'),
    clientOrgId: z.string().describe('Client organisation ID'),
    category: z.string().optional().describe('Category: design, development, content, strategy, admin, bug'),
    priority: z.string().optional().describe('Priority: standard or high'),
    type: z.string().optional().describe('Type: small_task, large_task, bug_fix, content_update, new_feature, consultation, custom'),
    description: z.string().optional().describe('Description of the request (Tiptap JSON or plain text)'),
    dueDate: z.string().optional().describe('Due date in YYYY-MM-DD format'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/requests', {
      method: 'POST',
      body: args,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'update_request_status',
  'Update the status of an existing request',
  {
    requestId: z.string().describe('ID of the request to update'),
    status: z.string().describe('New status: draft, submitted, in_review, in_progress, client_review, delivered, archived'),
  },
  async (args) => {
    const data = await apiFetch(`/api/admin/requests/${args.requestId}`, {
      method: 'PATCH' as string,
      body: { status: args.status },
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'assign_request',
  'Assign a team member to a request',
  {
    requestId: z.string().describe('ID of the request'),
    assigneeId: z.string().describe('ID of the team member to assign'),
  },
  async (args) => {
    const data = await apiFetch(`/api/admin/requests/${args.requestId}`, {
      method: 'PATCH' as string,
      body: { assigneeId: args.assigneeId },
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_client',
  'Create a new client organisation',
  {
    name: z.string().describe('Client company name'),
    website: z.string().optional().describe('Client website URL'),
    industry: z.string().optional().describe('Industry sector'),
    planType: z.string().optional().describe('Plan type: maintain, scale, tune, launch, hourly, custom, none'),
    primaryContactEmail: z.string().optional().describe('Primary contact email address'),
    primaryContactName: z.string().optional().describe('Primary contact full name'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/clients', {
      method: 'POST',
      body: args,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_invoice',
  'Create a new invoice for a client',
  {
    orgId: z.string().describe('Client organisation ID'),
    amountUsd: z.number().describe('Invoice amount in USD'),
    totalUsd: z.number().describe('Total amount in USD (after tax/discount)'),
    notes: z.string().optional().describe('Invoice notes'),
    dueDate: z.string().optional().describe('Due date in YYYY-MM-DD format'),
    items: z.array(z.object({
      description: z.string(),
      quantity: z.number().optional(),
      unitPriceUsd: z.number(),
      totalUsd: z.number(),
    })).optional().describe('Line items for the invoice'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/invoices', {
      method: 'POST',
      body: args,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'log_time',
  'Log a time entry for a team member',
  {
    orgId: z.string().describe('Client organisation ID'),
    teamMemberId: z.string().describe('Team member ID'),
    hours: z.number().describe('Number of hours worked'),
    date: z.string().describe('Date of work in YYYY-MM-DD format'),
    requestId: z.string().optional().describe('Associated request ID'),
    notes: z.string().optional().describe('Description of work done'),
    billable: z.boolean().optional().describe('Whether the time is billable (default true)'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/time', {
      method: 'POST',
      body: args,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'send_message',
  'Send a message in a conversation or request thread',
  {
    conversationId: z.string().describe('Conversation ID'),
    body: z.string().describe('Message body (plain text or Tiptap JSON)'),
    isInternal: z.boolean().optional().describe('Whether the message is internal (team only)'),
  },
  async (args) => {
    const data = await apiFetch(`/api/admin/conversations/${args.conversationId}/messages`, {
      method: 'POST',
      body: { body: args.body, isInternal: args.isInternal ?? false },
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_announcement',
  'Create a new announcement banner for clients',
  {
    title: z.string().describe('Announcement title'),
    body: z.string().describe('Announcement body text'),
    type: z.string().optional().describe('Type: info, warning, success, maintenance'),
    targetType: z.string().optional().describe('Target: all, plan_type, org'),
    targetValue: z.string().optional().describe('Plan type or org ID when targeting specific audience'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/announcements', {
      method: 'POST',
      body: args,
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Task Management
// ---------------------------------------------------------------------------

server.tool(
  'list_tasks',
  'List tasks with optional filters for status, type, and client org',
  {
    status: z.string().optional().describe('Filter by task status'),
    type: z.string().optional().describe('Filter by task type: client_external, internal_client, tahi_internal'),
    orgId: z.string().optional().describe('Filter by client organisation ID'),
  },
  async (args) => {
    const params = new URLSearchParams()
    if (args.status) params.set('status', args.status)
    if (args.type) params.set('type', args.type)
    if (args.orgId) params.set('orgId', args.orgId)
    const qs = params.toString() ? `?${params.toString()}` : ''
    const data = await apiFetch(`/api/admin/tasks${qs}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_task',
  'Create a new task',
  {
    title: z.string().describe('Task title'),
    description: z.string().optional().describe('Task description'),
    type: z.string().describe('Task type: client_external, internal_client, tahi_internal'),
    priority: z.string().optional().describe('Priority: low, medium, high, urgent'),
    orgId: z.string().optional().describe('Client organisation ID'),
    assigneeId: z.string().optional().describe('Team member ID to assign'),
    dueDate: z.string().optional().describe('Due date in YYYY-MM-DD format'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/tasks', { method: 'POST', body: args })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'update_task',
  'Update an existing task',
  {
    taskId: z.string().describe('Task ID'),
    status: z.string().optional().describe('New status'),
    priority: z.string().optional().describe('New priority: low, medium, high, urgent'),
    assigneeId: z.string().optional().describe('New assignee team member ID'),
    description: z.string().optional().describe('Updated description'),
    dueDate: z.string().optional().describe('Updated due date in YYYY-MM-DD format'),
  },
  async (args) => {
    const { taskId, ...body } = args
    const data = await apiFetch(`/api/admin/tasks/${taskId}`, { method: 'PATCH', body })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_task',
  'Get full detail for a specific task',
  { taskId: z.string().describe('Task ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/tasks/${args.taskId}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_task_subtasks',
  'List subtasks for a specific task',
  { taskId: z.string().describe('Parent task ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/tasks/${args.taskId}/subtasks`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_task_subtask',
  'Create a subtask under a task',
  {
    taskId: z.string().describe('Parent task ID'),
    title: z.string().describe('Subtask title'),
  },
  async (args) => {
    const data = await apiFetch(`/api/admin/tasks/${args.taskId}/subtasks`, {
      method: 'POST',
      body: { title: args.title },
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'toggle_task_subtask',
  'Toggle the completion status of a subtask',
  {
    taskId: z.string().describe('Parent task ID'),
    subId: z.string().describe('Subtask ID'),
    isCompleted: z.boolean().describe('Whether the subtask is completed'),
  },
  async (args) => {
    const data = await apiFetch(`/api/admin/tasks/${args.taskId}/subtasks/${args.subId}`, {
      method: 'PATCH',
      body: { isCompleted: args.isCompleted },
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'add_task_dependency',
  'Add a dependency to a task (this task depends on another)',
  {
    taskId: z.string().describe('Task ID'),
    dependsOnTaskId: z.string().describe('ID of the task this one depends on'),
  },
  async (args) => {
    const data = await apiFetch(`/api/admin/tasks/${args.taskId}/dependencies`, {
      method: 'POST',
      body: { dependsOnTaskId: args.dependsOnTaskId },
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'remove_task_dependency',
  'Remove a dependency from a task',
  {
    taskId: z.string().describe('Task ID'),
    depId: z.string().describe('Dependency ID to remove'),
  },
  async (args) => {
    const data = await apiFetch(`/api/admin/tasks/${args.taskId}/dependencies/${args.depId}`, {
      method: 'DELETE',
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_task_templates',
  'List all task templates',
  {},
  async () => {
    const data = await apiFetch('/api/admin/task-templates')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_task_from_template',
  'Create a new task from an existing template',
  {
    templateId: z.string().describe('Task template ID'),
    orgId: z.string().optional().describe('Client organisation ID'),
    assigneeId: z.string().optional().describe('Team member ID to assign'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/tasks/from-template', { method: 'POST', body: args })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Client Enhancement
// ---------------------------------------------------------------------------

server.tool(
  'update_client',
  'Update a client organisation',
  {
    clientId: z.string().describe('Client organisation ID'),
    name: z.string().optional().describe('Updated company name'),
    status: z.string().optional().describe('Updated status'),
    planType: z.string().optional().describe('Updated plan type'),
    industry: z.string().optional().describe('Updated industry'),
    website: z.string().optional().describe('Updated website URL'),
    internalNotes: z.string().optional().describe('Internal notes about the client'),
  },
  async (args) => {
    const { clientId, ...body } = args
    const data = await apiFetch(`/api/admin/clients/${clientId}`, { method: 'PATCH', body })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'list_client_contacts',
  'List contacts for a specific client organisation',
  { clientId: z.string().describe('Client organisation ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/clients/${args.clientId}/contacts`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_client_contact',
  'Create a new contact at a client organisation',
  {
    clientId: z.string().describe('Client organisation ID'),
    name: z.string().describe('Contact full name'),
    email: z.string().describe('Contact email address'),
    role: z.string().optional().describe('Contact role at the company'),
  },
  async (args) => {
    const { clientId, ...body } = args
    const data = await apiFetch(`/api/admin/clients/${clientId}/contacts`, { method: 'POST', body })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'assign_client_pm',
  'Assign a project manager to a client organisation',
  {
    clientId: z.string().describe('Client organisation ID'),
    teamMemberId: z.string().describe('Team member ID to assign as PM'),
  },
  async (args) => {
    const data = await apiFetch(`/api/admin/clients/${args.clientId}/pm`, {
      method: 'PUT',
      body: { teamMemberId: args.teamMemberId },
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'send_welcome_email',
  'Send a welcome/onboarding email to a client',
  { clientId: z.string().describe('Client organisation ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/clients/${args.clientId}/welcome-email`, { method: 'POST', body: {} })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Contract Management
// ---------------------------------------------------------------------------

server.tool(
  'list_contracts',
  'List all contracts across clients',
  {},
  async () => {
    const data = await apiFetch('/api/admin/contracts')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_contract',
  'Create a new contract for a client',
  {
    orgId: z.string().describe('Client organisation ID'),
    name: z.string().describe('Contract name'),
    type: z.string().describe('Contract type: nda, sla, msa, sow, other'),
    status: z.string().optional().describe('Contract status: draft, sent, signed, expired, cancelled'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/contracts', { method: 'POST', body: args })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'update_contract',
  'Update an existing contract',
  {
    contractId: z.string().describe('Contract ID'),
    status: z.string().optional().describe('Updated status: draft, sent, signed, expired, cancelled'),
    name: z.string().optional().describe('Updated contract name'),
    type: z.string().optional().describe('Updated type: nda, sla, msa, sow, other'),
  },
  async (args) => {
    const { contractId, ...body } = args
    const data = await apiFetch(`/api/admin/contracts/${contractId}`, { method: 'PUT', body })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'delete_contract',
  'Delete a contract',
  { contractId: z.string().describe('Contract ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/contracts/${args.contractId}`, { method: 'DELETE' })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Deal / Pipeline
// ---------------------------------------------------------------------------

server.tool(
  'create_deal',
  'Create a new deal in the sales pipeline',
  {
    title: z.string().describe('Deal title'),
    orgId: z.string().optional().describe('Client organisation ID'),
    value: z.number().optional().describe('Deal value in dollars'),
    currency: z.string().optional().describe('Currency code (e.g. USD, NZD)'),
    stageId: z.string().optional().describe('Pipeline stage ID'),
    source: z.string().optional().describe('Lead source'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/deals', { method: 'POST', body: args })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'update_deal',
  'Update a deal in the sales pipeline',
  {
    dealId: z.string().describe('Deal ID'),
    stageId: z.string().optional().describe('New pipeline stage ID'),
    value: z.number().optional().describe('Updated deal value'),
    status: z.string().optional().describe('Updated status'),
    ownerId: z.string().optional().describe('New owner team member ID'),
  },
  async (args) => {
    const { dealId, ...body } = args
    const data = await apiFetch(`/api/admin/deals/${dealId}`, { method: 'PATCH', body })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_pipeline_stages',
  'Get all pipeline stages for the sales pipeline',
  {},
  async () => {
    const data = await apiFetch('/api/admin/pipeline/stages')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Invoice Enhancement
// ---------------------------------------------------------------------------

server.tool(
  'get_invoice',
  'Get full detail for a specific invoice including line items',
  { invoiceId: z.string().describe('Invoice ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/invoices/${args.invoiceId}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'update_invoice',
  'Update an existing invoice',
  {
    invoiceId: z.string().describe('Invoice ID'),
    status: z.string().optional().describe('Updated status: draft, sent, overdue, paid, cancelled'),
    amount: z.number().optional().describe('Updated amount'),
    dueDate: z.string().optional().describe('Updated due date in YYYY-MM-DD format'),
  },
  async (args) => {
    const { invoiceId, ...body } = args
    const data = await apiFetch(`/api/admin/invoices/${invoiceId}`, { method: 'PATCH', body })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'send_invoice_email',
  'Send an invoice email to the client',
  { invoiceId: z.string().describe('Invoice ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/invoices/${args.invoiceId}/send-email`, { method: 'POST', body: {} })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Team Management
// ---------------------------------------------------------------------------

server.tool(
  'create_team_member',
  'Create a new team member',
  {
    name: z.string().describe('Team member full name'),
    email: z.string().describe('Team member email'),
    role: z.string().optional().describe('Role: admin, project_manager, designer, developer, content_writer'),
    title: z.string().optional().describe('Job title'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/team', { method: 'POST', body: args })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'update_team_member',
  'Update a team member',
  {
    teamMemberId: z.string().describe('Team member ID'),
    name: z.string().optional().describe('Updated name'),
    email: z.string().optional().describe('Updated email'),
    role: z.string().optional().describe('Updated role'),
    title: z.string().optional().describe('Updated job title'),
    skills: z.string().optional().describe('Updated skills (comma-separated)'),
  },
  async (args) => {
    const { teamMemberId, ...body } = args
    const data = await apiFetch(`/api/admin/team/${teamMemberId}`, { method: 'PUT', body })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'delete_team_member',
  'Delete a team member',
  { teamMemberId: z.string().describe('Team member ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/team/${args.teamMemberId}`, { method: 'DELETE' })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_org_chart',
  'Get the team org chart with reporting structure',
  {},
  async () => {
    const data = await apiFetch('/api/admin/team/org-chart')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Call Management
// ---------------------------------------------------------------------------

server.tool(
  'list_calls',
  'List all scheduled calls',
  {},
  async () => {
    const data = await apiFetch('/api/admin/calls')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_call',
  'Schedule a new call with a client',
  {
    orgId: z.string().describe('Client organisation ID'),
    title: z.string().describe('Call title'),
    scheduledAt: z.string().describe('Scheduled date/time in ISO format'),
    durationMinutes: z.number().optional().describe('Call duration in minutes (default 30)'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/calls', { method: 'POST', body: args })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'update_call',
  'Update a scheduled call',
  {
    callId: z.string().describe('Call ID'),
    status: z.string().optional().describe('Updated status: scheduled, completed, cancelled, no_show'),
    notes: z.string().optional().describe('Call notes'),
    recordingUrl: z.string().optional().describe('Recording URL'),
  },
  async (args) => {
    const { callId, ...body } = args
    const data = await apiFetch(`/api/admin/calls/${callId}`, { method: 'PATCH', body })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Subscription Management
// ---------------------------------------------------------------------------

server.tool(
  'get_subscription',
  'Get detail for a specific subscription',
  { subscriptionId: z.string().describe('Subscription ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/subscriptions/${args.subscriptionId}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'update_subscription',
  'Update a subscription',
  {
    subscriptionId: z.string().describe('Subscription ID'),
    billingInterval: z.string().optional().describe('Billing interval: monthly, quarterly, annual'),
    includedAddons: z.string().optional().describe('Included add-ons as JSON string'),
  },
  async (args) => {
    const { subscriptionId, ...body } = args
    const data = await apiFetch(`/api/admin/subscriptions/${subscriptionId}`, { method: 'PUT', body })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'change_billing_cycle',
  'Change the billing cycle of a subscription',
  {
    subscriptionId: z.string().describe('Subscription ID'),
    newCycle: z.string().describe('New billing cycle: monthly, quarterly, annual'),
  },
  async (args) => {
    const data = await apiFetch(`/api/admin/subscriptions/${args.subscriptionId}/change-cycle`, {
      method: 'POST',
      body: { newCycle: args.newCycle },
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Documentation
// ---------------------------------------------------------------------------

server.tool(
  'create_doc',
  'Create a new documentation page in the knowledge hub',
  {
    title: z.string().describe('Page title'),
    category: z.string().describe('Category for the doc page'),
    contentMd: z.string().optional().describe('Markdown content for the page'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/docs', { method: 'POST', body: args })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'update_doc',
  'Update a documentation page',
  {
    docId: z.string().describe('Doc page ID'),
    title: z.string().optional().describe('Updated title'),
    contentMd: z.string().optional().describe('Updated markdown content'),
    category: z.string().optional().describe('Updated category'),
  },
  async (args) => {
    const { docId, ...body } = args
    const data = await apiFetch(`/api/admin/docs/${docId}`, { method: 'PATCH', body })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'delete_doc',
  'Delete a documentation page',
  { docId: z.string().describe('Doc page ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/docs/${args.docId}`, { method: 'DELETE' })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_doc',
  'Get a specific documentation page with full content',
  { docId: z.string().describe('Doc page ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/docs/${args.docId}`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

server.tool(
  'get_settings',
  'Get all dashboard settings',
  {},
  async () => {
    const data = await apiFetch('/api/admin/settings')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'update_settings',
  'Update a dashboard setting',
  {
    key: z.string().describe('Setting key'),
    value: z.string().describe('Setting value'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/settings', { method: 'PATCH', body: args })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Request Enhancement
// ---------------------------------------------------------------------------

server.tool(
  'delete_request',
  'Delete a request',
  { requestId: z.string().describe('Request ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/requests/${args.requestId}`, { method: 'DELETE' })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_request_messages',
  'Get all messages for a specific request',
  { requestId: z.string().describe('Request ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/requests/${args.requestId}/messages`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'post_request_message',
  'Post a message on a request thread',
  {
    requestId: z.string().describe('Request ID'),
    content: z.string().describe('Message content'),
    isInternal: z.boolean().optional().describe('Whether the message is internal (team only)'),
  },
  async (args) => {
    const data = await apiFetch(`/api/admin/requests/${args.requestId}/messages`, {
      method: 'POST',
      body: { content: args.content, isInternal: args.isInternal ?? false },
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_request_steps',
  'Get the workflow steps for a specific request',
  { requestId: z.string().describe('Request ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/requests/${args.requestId}/steps`)
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Automations
// ---------------------------------------------------------------------------

server.tool(
  'list_automations',
  'List all automation rules',
  {},
  async () => {
    const data = await apiFetch('/api/admin/automations')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'create_automation',
  'Create a new automation rule',
  {
    name: z.string().describe('Automation rule name'),
    triggerType: z.string().describe('Trigger type: request_created, status_changed, overdue, etc.'),
    steps: z.string().describe('Automation steps as JSON string'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/automations', {
      method: 'POST',
      body: { name: args.name, triggerType: args.triggerType, steps: args.steps },
    })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

server.tool(
  'get_billing_summary',
  'Get billing summary report with revenue, outstanding, and trends',
  {},
  async () => {
    const data = await apiFetch('/api/admin/reports/billing-summary')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_response_time',
  'Get response time report with averages and breakdowns',
  {},
  async () => {
    const data = await apiFetch('/api/admin/reports/response-time')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'get_exchange_rates',
  'Get cached exchange rates',
  {},
  async () => {
    const data = await apiFetch('/api/admin/exchange-rates')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

server.tool(
  'refresh_exchange_rates',
  'Refresh exchange rates from external provider',
  {},
  async () => {
    const data = await apiFetch('/api/admin/exchange-rates', { method: 'POST', body: {} })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Announcements Enhancement
// ---------------------------------------------------------------------------

server.tool(
  'send_announcement',
  'Send an announcement to its target audience via email',
  { announcementId: z.string().describe('Announcement ID') },
  async (args) => {
    const data = await apiFetch(`/api/admin/announcements/${args.announcementId}/send`, { method: 'POST', body: {} })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

server.tool(
  'list_reviews',
  'List all client reviews and testimonial submissions',
  {},
  async () => {
    const data = await apiFetch('/api/admin/reviews')
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

server.tool(
  'create_conversation',
  'Create a new messaging conversation',
  {
    type: z.string().describe('Conversation type: direct, group, org_channel, request_thread'),
    participantIds: z.array(z.string()).describe('Array of participant IDs (team member or contact IDs)'),
    name: z.string().optional().describe('Conversation name (for group or channel types)'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/conversations', { method: 'POST', body: args })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

server.tool(
  'ai_task_wizard',
  'Use AI to help break down work into tasks, estimate effort, and suggest assignments',
  {
    messages: z.array(z.object({
      role: z.string().describe('Message role: user or assistant'),
      content: z.string().describe('Message content'),
    })).describe('Conversation messages for the AI wizard'),
    context: z.string().optional().describe('Additional context about the client or project'),
  },
  async (args) => {
    const data = await apiFetch('/api/admin/ai/task-wizard', { method: 'POST', body: args })
    return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
  }
)

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('Tahi Dashboard MCP server running on stdio\n')
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal error: ${err}\n`)
  process.exit(1)
})
