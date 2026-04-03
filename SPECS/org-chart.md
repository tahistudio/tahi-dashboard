# Org Chart

## What It Is

A visual team hierarchy showing Tahi Studio's organisational structure. Supports multiple roles per person (e.g., Liam is CEO + Developer + Sales, Staci is COO + Designer).

## Visual Design

### Tree Layout
```
                    Liam M.
                CEO / Developer / Sales
                    40h/week
                   [85% utilized]
                        |
            +-----------+-----------+
            |                       |
        Staci M.              [Hiring: Senior Dev]
    COO / Designer             Planned - Q2 2026
      40h/week                   40h/week
     [70% utilized]
            |
     +------+------+
     |             |
  Team Member   Team Member
   Designer     Developer
   20h/week     30h/week
```

### Node Design

**Filled Node (Active Team Member):**
- Leaf-radius avatar
- Full name
- All roles as badges (pill-shaped, different colors per department)
- Weekly capacity hours
- Utilization bar (% of capacity used)
- Department badges with colors:
  - Leadership: brand green
  - Design: purple
  - Development: blue
  - Strategy/Sales: orange
  - Operations: grey

**Vacant Node (Planned Role):**
- Dotted border
- Role title
- Department badge
- Hiring priority (High/Medium/Low)
- Estimated start date
- Target weekly hours

### Interactions
- Click node to open team member detail panel
- Drag node to reorganize reporting structure
- Click "+" between nodes to add new team member or planned role
- Expand/collapse subtrees
- Export as PNG

## Multiple Roles

### Data Model
Instead of a single `role` field on teamMembers, use a separate roles junction table:

```ts
teamMemberRoles: {
  id: uuid pk,
  teamMemberId: text -> teamMembers,
  role: text,           // 'ceo', 'developer', 'designer', 'sales', 'pm', etc.
  department: text,     // 'leadership', 'design', 'development', 'strategy', 'operations'
  isPrimary: integer,   // boolean: which role shows first
  createdAt: text
}
```

### Role Options
- CEO, COO, CTO, CFO (Leadership)
- Designer, Senior Designer, Design Lead (Design)
- Developer, Senior Developer, Tech Lead (Development)
- Project Manager, Account Manager (Operations)
- Sales, Business Development (Strategy)
- Content Writer, SEO Specialist (Marketing)

### Display Rules
- Primary role shown largest
- Secondary roles shown as smaller badges
- In lists/cards: show primary role, hover to see all
- In org chart: show all roles

## Planned Roles (Hiring Pipeline)

```ts
plannedRoles: {
  id: uuid pk,
  title: text,
  department: text,
  reportsToId: text nullable -> teamMembers,
  priority: 'high' | 'medium' | 'low',
  status: 'planned' | 'interviewing' | 'offered' | 'filled',
  notes: text nullable,
  estimatedStartDate: text nullable,
  weeklyCapacityHours: integer default 40,
  filledByMemberId: text nullable -> teamMembers,
  createdAt, updatedAt
}
```

## Responsive Layout
- Desktop: horizontal tree layout
- Tablet: compact tree with smaller nodes
- Mobile: vertical list with indentation showing hierarchy

## API Routes

### GET /api/admin/team/org-chart
Returns team members with roles and reporting structure in tree format.

### PUT /api/admin/team/[id]/reporting
Update who a team member reports to.

### GET/POST /api/admin/team/roles
List all available roles. Add custom roles.

### GET/POST/PUT /api/admin/team/planned-roles
CRUD for planned/hiring positions.

## Done Criteria
- Visual tree renders with actual team data
- Multiple roles per person displayed as badges
- Drag to reorganize reporting structure works
- Planned roles shown as dotted-border nodes
- Click node opens detail panel
- Capacity/utilization shown per member
- Export to PNG works
- Mobile: vertical list view
- Department colors consistent with design system
