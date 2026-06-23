---
category: boards
---

<BoardView>. Multi-view shell that wraps Kanban / Table / Timeline
tabs around the same dataset.

  <BoardView
    title="Engineering · Tasks"
    items={tasks}
    columns={taskColumns}
    defaultView="kanban"
    onMove={(id, status) => api.move(id, status)}
    onNest={(child, parent) => api.nest(child, parent)}
    onAdd={(status) => openDialog(status)}
    onToggleSubtask={(id, st) => api.toggle(id, st)}
    onItemClick={(item) => router.push(`/tasks/${item.id}`)}
  />

Each view renderer receives the same BoardItem[] from kanban-board.tsx.
The shell handles the header (title, view tabs, search input,
filter button, "+ New") and lets the active view decide how to
render. State is owned outside — the shell is presentational.
