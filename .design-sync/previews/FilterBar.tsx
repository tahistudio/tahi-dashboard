import { FilterBar, type FilterDef, type ActiveFilter } from 'tahi-dashboard'

const frame = { padding: '1.25rem', background: 'var(--color-bg-cream)', width: '46rem', maxWidth: '100%' } as const

const filters: FilterDef[] = [
  {
    id: 'status',
    label: 'Status',
    kind: 'select',
    options: [
      { value: 'submitted', label: 'Submitted', tone: 'info' },
      { value: 'in_review', label: 'In review', tone: 'warning' },
      { value: 'in_progress', label: 'In progress', tone: 'teal' },
      { value: 'client_review', label: 'Client review', tone: 'purple' },
      { value: 'delivered', label: 'Delivered', tone: 'positive' },
    ],
  },
  {
    id: 'client',
    label: 'Client',
    kind: 'select',
    options: [
      { value: 'acme', label: 'Acme Co' },
      { value: 'northwind', label: 'Northwind' },
      { value: 'kowhai', label: 'Kowhai Labs' },
    ],
  },
  {
    id: 'assignee',
    label: 'Assignee',
    kind: 'multiselect',
    options: [
      { value: 'liam', label: 'Liam Miller' },
      { value: 'staci', label: 'Staci Bonnie' },
    ],
  },
  {
    id: 'priority',
    label: 'Priority',
    kind: 'select',
    options: [
      { value: 'urgent', label: 'Urgent', tone: 'danger' },
      { value: 'high', label: 'High', tone: 'warning' },
      { value: 'medium', label: 'Medium', tone: 'info' },
      { value: 'low', label: 'Low', tone: 'neutral' },
    ],
  },
  { id: 'created', label: 'Created', kind: 'daterange', options: [] },
]

// Resting bar with a search value and three active filters already applied.
const active: ActiveFilter[] = [
  { id: 'status', value: 'in_progress' },
  { id: 'client', value: 'acme' },
  { id: 'assignee', values: ['liam', 'staci'] },
]

export const Default = () => (
  <div style={frame}>
    <FilterBar
      filters={filters}
      active={active}
      onChange={() => {}}
      search={{ value: 'homepage', onChange: () => {}, placeholder: 'Search requests' }}
    />
  </div>
)

const single: ActiveFilter[] = [{ id: 'priority', value: 'urgent' }]

export const SearchOnly = () => (
  <div style={frame}>
    <FilterBar
      filters={filters}
      active={single}
      onChange={() => {}}
      search={{ value: '', onChange: () => {}, placeholder: 'Search requests' }}
    />
  </div>
)

export const Compact = () => (
  <div style={frame}>
    <FilterBar
      filters={filters}
      active={active}
      onChange={() => {}}
      size="sm"
      search={{ value: 'audit', onChange: () => {}, placeholder: 'Search' }}
    />
  </div>
)
