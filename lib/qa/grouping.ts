/**
 * Template groups: 6 or more pages sharing a first segment with a second
 * segment (/blog/a, /blog/b, ...) become one group, keyed '/blog/*'. A round
 * includes only a few samples from each group. Pure.
 */
export const GROUP_MIN_SIZE = 6
export const GROUP_SAMPLE_SIZE = 3

export function computeGroups(paths: string[]): Map<string, string | null> {
  const bySegment = new Map<string, string[]>()
  for (const p of paths) {
    const segs = p.split('/').filter(Boolean)
    if (segs.length >= 2) {
      const list = bySegment.get(segs[0]) ?? []
      list.push(p)
      bySegment.set(segs[0], list)
    }
  }
  const out = new Map<string, string | null>()
  for (const p of paths) out.set(p, null)
  for (const [seg, list] of bySegment) {
    if (list.length >= GROUP_MIN_SIZE) for (const p of list) out.set(p, `/${seg}/*`)
  }
  return out
}

export function pickSamples(groupPaths: string[], n: number = GROUP_SAMPLE_SIZE): string[] {
  return [...groupPaths].sort().slice(0, n)
}
