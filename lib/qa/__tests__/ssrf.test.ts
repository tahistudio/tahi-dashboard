import { describe, it, expect } from 'vitest'
import { isSafePublicUrl } from '@/lib/qa/ssrf'

describe('isSafePublicUrl', () => {
  it.each([
    'https://acme.webflow.io/',
    'http://example.com/a?b=1',
    'https://www.client.co.nz/blog/post',
  ])('allows %s', url => expect(isSafePublicUrl(url)).toBe(true))

  it.each([
    'ftp://example.com',
    'javascript:alert(1)',
    'https://localhost/',
    'https://foo.localhost/',
    'http://127.0.0.1/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/',
    'https://printer.local/',
    'https://svc.internal/',
    'https://user:pass@example.com/',
    'http://localhost./',
    'http://foo.localhost./',
    'http://foo.internal./',
    'http://metadata.google.internal./',
    'http://x.local./',
    'https://localhost%2e/',
    'not a url',
  ])('rejects %s', url => expect(isSafePublicUrl(url)).toBe(false))
})
