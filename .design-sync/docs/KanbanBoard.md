---
category: boards
---

<KanbanBoard>. Rich-card kanban primitive.

One self-contained primitive used by the design system showcase
and (when productised) by the requests / tasks pages. Drives
everything visible on a card from the data object — see BoardItem.

  <KanbanBoard
    columns={[{ id: 'todo', label: 'To do', statusValue: 'todo', color: '#94a3b8' }, ...]}
    items={tasks}
    onMove={(itemId, toStatus, position) => api.move(itemId, toStatus, position)}
    onNest={(childId, parentId) => api.nest(childId, parentId)}
    onAdd={(status) => openNewTaskDialog(status)}
    onToggleSubtask={(itemId, subtaskId) => api.toggle(itemId, subtaskId)}
    onItemClick={(item) => router.push(`/tasks/${item.id}`)}
    columnActions={[{ label: 'Rename', icon: <Pencil/>, onClick: ... }]}
  />

Card visuals: optional gradient cover, multi-tag row, priority chip,
title, progress bar, subtask checklist with running count, nested
children (rendered as compact sub-cards inline), meta footer (date,
comments, attachments, assignee stack), hover lift.

Drag/drop:
  - Drag a card onto a column → moves status
  - Drag a card onto another card → fires onNest (the parent
    screen typically confirms via dialog before persisting)

The board never owns state: parents pass items, the board emits
intent callbacks. That keeps it usable with any backend / query lib.
