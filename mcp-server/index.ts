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

async function apiFetch(
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {}
): Promise<unknown> {
  const url = `${DASHBOARD_URL}${path}`
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
