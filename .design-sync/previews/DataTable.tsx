import { DataTable, Badge, Avatar, type DataTableColumn } from 'tahi-dashboard'

const frame = { padding: '1.25rem', background: 'var(--color-bg-cream)', width: '46rem', maxWidth: '100%' } as const

const panel = {
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-card, 0.75rem)',
  overflow: 'hidden',
} as const

interface RequestRow {
  id: string
  title: string
  client: string
  status: 'submitted' | 'in_review' | 'in_progress' | 'client_review' | 'delivered'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  assignee: { name: string; src?: string | null }
  value: number
}

const STATUS_META: Record<RequestRow['status'], { label: string; tone: 'info' | 'warning' | 'teal' | 'purple' | 'positive' }> = {
  submitted: { label: 'Submitted', tone: 'info' },
  in_review: { label: 'In review', tone: 'warning' },
  in_progress: { label: 'In progress', tone: 'teal' },
  client_review: { label: 'Client review', tone: 'purple' },
  delivered: { label: 'Delivered', tone: 'positive' },
}

const PRIORITY_TONE: Record<RequestRow['priority'], 'neutral' | 'info' | 'warning' | 'danger'> = {
  low: 'neutral',
  medium: 'info',
  high: 'warning',
  urgent: 'danger',
}

const rows: RequestRow[] = [
  { id: 'r1', title: 'Homepage redesign', client: 'Acme Co', status: 'in_progress', priority: 'high', assignee: { name: 'Staci Bonnie' }, value: 4200 },
  { id: 'r2', title: 'Pricing page rebuild', client: 'Northwind', status: 'client_review', priority: 'medium', assignee: { name: 'Liam Miller' }, value: 2800 },
  { id: 'r3', title: 'SEO audit + fixes', client: 'Kowhai Labs', status: 'in_review', priority: 'urgent', assignee: { name: 'Liam Miller' }, value: 3600 },
  { id: 'r4', title: 'Blog CMS migration', client: 'Acme Co', status: 'submitted', priority: 'low', assignee: { name: 'Staci Bonnie' }, value: 1950 },
  { id: 'r5', title: 'Webflow component library', client: 'Northwind', status: 'delivered', priority: 'medium', assignee: { name: 'Staci Bonnie' }, value: 5400 },
  { id: 'r6', title: 'Performance + Core Web Vitals', client: 'Kowhai Labs', status: 'in_progress', priority: 'high', assignee: { name: 'Liam Miller' }, value: 3100 },
  { id: 'r7', title: 'Email template system', client: 'Acme Co', status: 'in_review', priority: 'medium', assignee: { name: 'Liam Miller' }, value: 2400 },
  { id: 'r8', title: 'Accessibility pass (AA)', client: 'Northwind', status: 'client_review', priority: 'urgent', assignee: { name: 'Staci Bonnie' }, value: 2200 },
]

const money = (n: number) => `$${n.toLocaleString('en-US')}`

const columns: DataTableColumn<RequestRow>[] = [
  {
    key: 'title',
    header: 'Request',
    sortable: true,
    accessor: r => r.title,
    sortValue: r => r.title,
    render: r => (
      <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{r.title}</span>
    ),
  },
  { key: 'client', header: 'Client', sortable: true, accessor: r => r.client, sortValue: r => r.client, muted: true },
  {
    key: 'status',
    header: 'Status',
    render: r => {
      const m = STATUS_META[r.status]
      return <Badge tone={m.tone} variant="soft" size="sm" leader="dot">{m.label}</Badge>
    },
  },
  {
    key: 'priority',
    header: 'Priority',
    render: r => (
      <Badge tone={PRIORITY_TONE[r.priority]} variant="soft" size="sm" leader={false}>
        {r.priority.charAt(0).toUpperCase() + r.priority.slice(1)}
      </Badge>
    ),
  },
  {
    key: 'assignee',
    header: 'Assignee',
    render: r => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
        <Avatar name={r.assignee.name} src={r.assignee.src} size="xs" tooltip={false} />
        <span style={{ color: 'var(--color-text)' }}>{r.assignee.name}</span>
      </span>
    ),
  },
  {
    key: 'value',
    header: 'Value',
    align: 'right',
    sortable: true,
    accessor: r => money(r.value),
    sortValue: r => r.value,
    render: r => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{money(r.value)}</span>,
  },
]

export const Default = () => (
  <div style={frame}>
    <div style={panel}>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={r => r.id}
        defaultSort={{ key: 'title', dir: 'asc' }}
        ariaLabel="Open requests"
        onRowClick={() => {}}
        paginate={false}
      />
    </div>
  </div>
)

export const Selectable = () => (
  <div style={frame}>
    <div style={panel}>
      <DataTable
        columns={columns}
        rows={rows.slice(0, 6)}
        getRowId={r => r.id}
        selectable
        selectedIds={new Set(['r1', 'r3'])}
        onSelectionChange={() => {}}
        defaultSort={{ key: 'value', dir: 'desc' }}
        ariaLabel="Open requests with selection"
        rowActions={() => [
          { label: 'Open', onClick: () => {} },
          { label: 'Assign to me', onClick: () => {} },
          { label: 'Archive', tone: 'danger', onClick: () => {} },
        ]}
        onRowClick={() => {}}
        paginate={false}
      />
    </div>
  </div>
)

export const Compact = () => (
  <div style={frame}>
    <div style={panel}>
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={r => r.id}
        density="compact"
        defaultSort={{ key: 'value', dir: 'desc' }}
        ariaLabel="Open requests, compact density"
        onRowClick={() => {}}
        paginate={false}
      />
    </div>
  </div>
)
