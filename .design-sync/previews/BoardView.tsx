import { BoardView, type BoardColumn, type BoardItem } from 'tahi-dashboard'

const frame = { padding: '1.25rem', background: 'var(--color-bg-cream)', width: '54rem', maxWidth: '100%' } as const

const columns: BoardColumn[] = [
  { id: 'c1', label: 'Submitted', statusValue: 'submitted', color: '#60a5fa' },
  { id: 'c2', label: 'In progress', statusValue: 'in_progress', color: '#5A824E' },
  { id: 'c3', label: 'Client review', statusValue: 'client_review', color: '#a78bfa' },
  { id: 'c4', label: 'Delivered', statusValue: 'delivered', color: '#4ade80' },
]

const liam = { id: 'liam', name: 'Liam Miller' }
const staci = { id: 'staci', name: 'Staci Bonnie' }

const items: BoardItem[] = [
  {
    id: 'b1',
    status: 'submitted',
    title: 'Email template system',
    priority: 'medium',
    tags: [{ id: 't-design', label: 'Design', color: '#a78bfa' }, { id: 't-acme', label: 'Acme Co' }],
    dueDate: 'Jun 27',
    assignees: [liam],
  },
  {
    id: 'b2',
    status: 'submitted',
    title: 'Blog CMS migration',
    description: 'Move 120 posts to the new schema.',
    priority: 'low',
    tags: [{ id: 't-dev', label: 'Development', color: '#5A824E' }],
    dueDate: 'Jun 24',
    commentCount: 2,
    assignees: [staci],
  },
  {
    id: 'b3',
    status: 'in_progress',
    title: 'Homepage redesign',
    description: 'Hero, bento grid, dark feature tile.',
    priority: 'high',
    tags: [{ id: 't-design', label: 'Design', color: '#a78bfa' }, { id: 't-acme', label: 'Acme Co' }],
    progress: { current: 6, total: 9 },
    dueDate: 'Jun 21',
    commentCount: 5,
    attachmentCount: 3,
    assignees: [staci, liam],
  },
  {
    id: 'b4',
    status: 'in_progress',
    title: 'SEO audit + fixes',
    priority: 'urgent',
    tags: [{ id: 't-seo', label: 'SEO', color: '#fb923c' }, { id: 't-kowhai', label: 'Kowhai Labs' }],
    dueDate: 'Jun 19',
    isOverdue: true,
    commentCount: 3,
    assignees: [liam],
  },
  {
    id: 'b5',
    status: 'client_review',
    title: 'Pricing page rebuild',
    priority: 'medium',
    tags: [{ id: 't-northwind', label: 'Northwind' }],
    progress: { current: 8, total: 8 },
    dueDate: 'Jun 23',
    commentCount: 4,
    assignees: [liam],
  },
  {
    id: 'b6',
    status: 'delivered',
    title: 'Webflow component library',
    description: 'Shipped 24 reusable components.',
    priority: 'medium',
    tags: [{ id: 't-dev', label: 'Development', color: '#5A824E' }, { id: 't-northwind', label: 'Northwind' }],
    dueDate: 'Jun 14',
    commentCount: 7,
    assignees: [staci, liam],
  },
]

export const Default = () => (
  <div style={frame}>
    <BoardView
      title="Requests · This sprint"
      intro="Live board across Acme Co, Northwind and Kowhai Labs."
      columns={columns}
      items={items}
      defaultView="kanban"
      searchPlaceholder="Search requests"
      onNew={() => {}}
      newLabel="New request"
      onMove={() => {}}
      onAdd={() => {}}
      onItemClick={() => {}}
      onFilterClick={() => {}}
    />
  </div>
)

export const KanbanOnly = () => (
  <div style={frame}>
    <BoardView
      title="Engineering · Tasks"
      columns={columns}
      items={items}
      views={['kanban']}
      defaultView="kanban"
      searchPlaceholder="Search tasks"
      onNew={() => {}}
      newLabel="New task"
      onMove={() => {}}
      onAdd={() => {}}
      onItemClick={() => {}}
    />
  </div>
)
