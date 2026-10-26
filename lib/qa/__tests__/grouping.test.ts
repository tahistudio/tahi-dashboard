import { describe, it, expect } from 'vitest'
import { computeGroups, pickSamples, GROUP_MIN_SIZE } from '@/lib/qa/grouping'

describe('computeGroups', () => {
  it('groups 6+ second-level pages under one first segment', () => {
    const blog = Array.from({ length: GROUP_MIN_SIZE }, (_, i) => `/blog/post-${i}`)
    const groups = computeGroups(['/', '/about', '/blog', ...blog, '/work/a', '/work/b'])
    expect(groups.get('/blog/post-0')).toBe('/blog/*')
    expect(groups.get('/blog')).toBeNull()
    expect(groups.get('/work/a')).toBeNull()
    expect(groups.get('/')).toBeNull()
  })
})

describe('pickSamples', () => {
  it('takes the first n paths of each group, sorted', () => {
    const paths = ['/blog/c', '/blog/a', '/blog/b', '/blog/d']
    expect(pickSamples(paths, 3)).toEqual(['/blog/a', '/blog/b', '/blog/c'])
  })
})
