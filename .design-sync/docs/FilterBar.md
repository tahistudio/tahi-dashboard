---
category: data
---

<FilterBar>. Notion / Linear style filter chip builder.

  <FilterBar
    filters={[
      { id: 'status', label: 'Status', kind: 'select',
        options: [
          { value: 'paid',    label: 'Paid',    tone: 'positive' },
          { value: 'overdue', label: 'Overdue', tone: 'danger' },
          { value: 'draft',   label: 'Draft',   tone: 'neutral' },
        ] },
      { id: 'client', label: 'Client', kind: 'select',
        options: [...] },
    ]}
    active={active}
    onChange={setActive}
    search={{ value: q, onChange: setQ, placeholder: 'Search invoices' }}
  />

Layout:
  [🔍 Search ____] [Status: Paid ×] [Client: Acme ×] [+ Add filter]

Behaviour:
  - Search input on the left. Optional.
  - Active filter chips inline. Each shows "Label: Value" with X to
    remove. Click the chip body to re-pick the value.
  - "+ Add filter" opens a popover listing filters that aren't
    already active. Picking one adds a chip with the first option
    auto-selected, then immediately opens the chip's editor.
