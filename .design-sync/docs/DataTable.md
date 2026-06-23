---
category: data
---

<DataTable>. The shared list-page table.

Features:
  - Sortable columns (controlled or internal).
  - Row click navigates or toggles expansion.
  - Row selection with checkbox column and select-all in head.
  - Per-row action menu via 3-dots button OR right-click anywhere
    on the row.
  - Expandable rows (renderExpand) with a slide-down detail panel.
  - Sticky thead, h-scroll on mobile, density toggle.
  - Loading / empty states baked in.
  - Outer wrapper clips to its parent's rounded corners so the
    table doesn't poke past a Card's curve.

  <DataTable
    columns={[
      { key: 'name', header: 'Name', sortable: true },
      { key: 'status', render: r => <Badge ... /> },
    ]}
    rows={rows}
    getRowId={r => r.id}
    selectable
    selectedIds={selected}
    onSelectionChange={setSelected}
    onRowClick={r => router.push(`/invoices/${r.id}`)}
    rowActions={r => [
      { label: 'Open', onClick: () => navigate(r.id) },
      { label: 'Delete', tone: 'danger', onClick: () => del(r.id) },
    ]}
    renderExpand={r => <DetailsPanel row={r} />}
    loading={isLoading}
    empty={<EmptyState ... />}
  />
