export type SearchGroupType =
  | 'request' | 'task' | 'client' | 'brand' | 'contact'
  | 'deal' | 'invoice' | 'contract' | 'proposal' | 'schedule'
  | 'doc' | 'call' | 'service' | 'announcement'
  | 'automation' | 'team'

export interface SearchResultItem {
  type: SearchGroupType
  id: string
  title: string
  sub?: string
  badge?: string
  href: string
}

export interface SearchResponse {
  query: string
  totalCount: number
  suggestions: SearchResultItem[]
  groups: Array<{
    type: SearchGroupType
    label: string
    items: SearchResultItem[]
  }>
}
