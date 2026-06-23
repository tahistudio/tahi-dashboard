---
category: primitives
---

<Menu>. Standardised dropdown menu built on top of <Popover>. Use it
for kebab menus, user dropdowns, sort/filter pickers, any context
menu where the trigger opens a list of actions or links.

  <Menu
    trigger={<button>...</button>}
    align="end"
  >
    <Menu.Item icon={<Edit />} onClick={...}>Rename</Menu.Item>
    <Menu.Item icon={<Copy />} onClick={...}>Duplicate</Menu.Item>
    <Menu.Divider />
    <Menu.Label>Move</Menu.Label>
    <Menu.Item icon={<Archive />} onClick={...}>Archive</Menu.Item>
    <Menu.Item icon={<Trash />} onClick={...} tone="danger">Delete</Menu.Item>
  </Menu>

Trigger receives a `data-state` attribute (open / closed) we can use
for hover styling.
