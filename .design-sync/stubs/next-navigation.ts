// Inert next/navigation stub for static design-system rendering.
export function usePathname(): string { return '/' }
export function useRouter() {
  return { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} }
}
export function useSearchParams(): URLSearchParams { return new URLSearchParams() }
export function useParams(): Record<string, string> { return {} }
export function useSelectedLayoutSegment(): string | null { return null }
export function useSelectedLayoutSegments(): string[] { return [] }
export function redirect(): never { throw new Error('redirect (stub)') }
export function notFound(): never { throw new Error('notFound (stub)') }
