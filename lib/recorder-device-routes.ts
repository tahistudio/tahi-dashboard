/** Kept independent of D1 and Clerk so middleware can fail closed first. */
export function isRecorderDeviceBearer(authorization: string | null): boolean {
  return /^Bearer\s+tahi_rec_/i.test(authorization ?? '')
}

export function isRecorderDeviceRouteAllowed(method: string, pathname: string): boolean {
  if (method === 'POST' && pathname === '/api/admin/recordings') return true
  if (method === 'GET' && (pathname === '/api/admin/recordings' || pathname === '/api/admin/recordings/upcoming-calls')) return true
  // Only a real recording id can occupy a dynamic path segment.
  const match = /^\/api\/admin\/recordings\/([A-Za-z0-9_-]+)(?:\/(chunks|stop|transcribe))?$/.exec(pathname)
  if (!match || match[1] === 'upcoming-calls') return false
  if (!match[2]) return method === 'GET'
  if (match[2] === 'chunks') return method === 'POST' || method === 'PUT'
  return method === 'POST'
}
