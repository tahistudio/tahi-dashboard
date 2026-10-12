/**
 * lib/mcp-designer-routes.ts - the dashboard's own check on the designer MCP
 * profile (Decision #070, security review H1 belt and braces).
 *
 * The worker MCP server enforces the designer profile per tool. This is the
 * second, independent layer: when a TAHI_API_TOKEN call carries a verified
 * actor whose profile is 'designer', getRequestAuth only honours a WRITE
 * (anything but GET or HEAD) whose method and path are on this list, which
 * mirrors the routes the designer's allowed tools dispatch to. Anything else
 * is answered as unauthenticated, so even a worker bug cannot turn a
 * designer session into an invoice edit or an email send.
 *
 * Reads stay open (the designer profile reads everything), and the full
 * profile is untouched. Some read-only tools POST (AI drafting); they are
 * listed too. The spec app/api/__tests__/mcp-designer-routes.test.ts
 * dispatches every designer tool through the worker and checks each call
 * lands on this list, and that blocked tools' writes do not.
 */

/**
 * Static route segments that sit beside an [id] segment (tasks/bulk,
 * requests/bulk-assign, timers/ping, uploads/presign and so on). The id
 * wildcard must never match them: PATCH /api/admin/requests/bulk is the bulk
 * status route, which can email clients (security re-review L-B).
 */
const RESERVED_SEGMENTS = ['bulk', 'bulk-assign', 'from-template', 'ping', 'confirm', 'presign', 'proxy', 'serve', 'reorder']

const ID = `(?!(?:${RESERVED_SEGMENTS.join('|')})(?:/|$))[A-Za-z0-9_-]{1,128}`

type Rule = readonly [method: string, pattern: string]

const RULES: readonly Rule[] = [
  // Tasks, checklist items, comments, dependencies, blockers, templates
  ['POST', '/api/admin/tasks'],
  ['PATCH', `/api/admin/tasks/${ID}`],
  ['DELETE', `/api/admin/tasks/${ID}`],
  ['PATCH', '/api/admin/tasks/bulk'],
  ['POST', '/api/admin/tasks/from-template'],
  ['POST', `/api/admin/tasks/${ID}/subtasks`],
  ['PATCH', `/api/admin/tasks/${ID}/subtasks/${ID}`],
  ['DELETE', `/api/admin/tasks/${ID}/subtasks/${ID}`],
  ['POST', `/api/admin/tasks/${ID}/comments`],
  ['POST', `/api/admin/tasks/${ID}/dependencies`],
  ['DELETE', `/api/admin/tasks/${ID}/dependencies/${ID}`],
  ['POST', `/api/admin/(tasks|requests)/${ID}/blockers`],
  ['DELETE', `/api/admin/(tasks|requests)/${ID}/blockers/${ID}`],
  ['POST', '/api/admin/task-templates'],
  ['PATCH', `/api/admin/task-templates/${ID}`],
  ['DELETE', `/api/admin/task-templates/${ID}`],
  // Timers and time
  ['POST', '/api/admin/timers'],
  ['PATCH', `/api/admin/timers/${ID}`],
  ['DELETE', `/api/admin/timers/${ID}`],
  ['POST', '/api/admin/time'],
  ['POST', '/api/admin/time-entries'],
  ['POST', `/api/admin/requests/${ID}/time-entries`],
  // Requests
  ['PATCH', `/api/admin/requests/${ID}`],
  ['POST', `/api/admin/requests/${ID}/messages`],
  ['POST', `/api/admin/requests/${ID}/steps`],
  ['PATCH', `/api/admin/requests/${ID}/steps/${ID}`],
  ['DELETE', `/api/admin/requests/${ID}/steps/${ID}`],
  ['POST', `/api/admin/requests/${ID}/participants`],
  ['DELETE', `/api/admin/requests/${ID}/participants/${ID}`],
  ['POST', `/api/admin/requests/${ID}/handoff`],
  ['DELETE', `/api/admin/requests/${ID}/handoff`],
  ['PATCH', `/api/admin/requests/${ID}/sub-requests/reorder`],
  ['POST', `/api/admin/requests/${ID}/nest`],
  ['POST', `/api/admin/requests/${ID}/scope-flag`],
  ['DELETE', `/api/admin/requests/${ID}/scope-flag`],
  ['POST', `/api/admin/requests/${ID}/reads`],
  ['POST', '/api/admin/requests/bulk-assign'],
  ['DELETE', `/api/uploads/${ID}`],
  // Messages (studio side only; nothing under /api/portal)
  ['POST', `/api/admin/messages/(channel|request)/${ID}`],
  ['POST', `/api/admin/messages/(channel|request)/${ID}/read`],
  ['POST', `/api/admin/conversations/${ID}/messages`],
  // Developer handoff
  ['POST', '/api/admin/developer-handoff'],
  // Read-only AI drafting that POSTs
  ['POST', '/api/admin/ai/task-wizard'],
  ['POST', '/api/admin/ai/request-wizard'],
  ['POST', `/api/admin/requests/${ID}/triage`],
  ['POST', `/api/admin/requests/${ID}/draft-reply`],
  ['POST', '/api/admin/ai/predict-fields'],
]

const COMPILED = RULES.map(([method, pattern]) => ({ method, re: new RegExp(`^${pattern}$`) }))

/** May a designer-profile MCP call make this request? Reads always may. */
export function isDesignerRequestAllowed(method: string, pathname: string): boolean {
  const verb = method.toUpperCase()
  if (verb === 'GET' || verb === 'HEAD') return true
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return COMPILED.some((rule) => rule.method === verb && rule.re.test(path))
}
