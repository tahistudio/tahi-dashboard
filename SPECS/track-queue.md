# Track Queue System

## What It Is

A visual queue system showing clients exactly what work is in progress on each of their tracks, what's coming next, and allowing them to reorder their own queue. For admins, it shows the same view with team member assignment and cross-client visibility.

## Track Model (from services-and-pricing)

| Plan | Tracks | Notes |
|------|--------|-------|
| Maintain | 1 small | Single-track work |
| Scale | 1 large + 1 small | Multiple concurrent |
| Custom | Varies | Any combination |

- **Small Track:** Up to 1 day of work per task
- **Large Track:** 1+ weeks of work per task

## Client Portal View

### Track Cards
Each track is a visual column/card showing:
1. **Active task** (highlighted, in-progress) - what's being worked on NOW
2. **Queue** (ordered list below) - what's coming next, in priority order
3. **Track status**: "In Progress" / "Available" / "Paused"

### Visual Layout
```
[ Small Track ]              [ Large Track ]
  Active: Fix nav bug          Active: Product pages redesign
  ---- Queue ----              ---- Queue ----
  1. Update footer             1. Email template series
  2. Add testimonial           2. Blog layout refresh
  3. Fix mobile menu           (empty slots)

  [+ Add to queue]             [+ Add to queue]
```

### Client Interactions
- **Drag to reorder** queue items (within their own track only)
- **Add to queue** opens request dialog pre-scoped to that track type
- **High priority popup**: When client drags an item to position 1 or selects "high priority":
  - Show warning: "Moving this to the top will pause '[current active task]' and start this instead. Are you sure?"
  - Or: "This will be worked on next, after '[current active task]' is delivered."
  - Choice depends on plan (maintain = replace, scale = could be next)

### Upsell
When all tracks are full (active + 3+ in queue):
- Show subtle banner: "Your queue is getting long! Add another track to get work done faster."
- Link to upgrade/pricing page
- Show comparison: "With Scale plan, you'd have 2 tracks running simultaneously"

## Admin View

### Per-Client Track View (Client Detail Page)
Same visual as client portal but with admin controls:
- Assign team member to each track
- Change active task
- Override queue order
- See estimated delivery dates
- Track utilization metrics

### Global Track Dashboard (Overview/Capacity)
- All clients' tracks in one view
- Filter by team member assignment
- See which tracks are idle (no active task)
- See which tracks are overloaded (long queues)
- Drag tasks between clients' tracks (admin only)

## Data Model

### Existing Tables Used
- `requests` - each request is a task in a track
- `tracks` - defines available tracks per subscription
- `subscriptions` - plan type determines track count

### New Fields Needed
- `requests.trackId` - which track this request belongs to (nullable, null = unassigned)
- `requests.queuePosition` - integer position in queue (1 = next up, 0 = active)
- `requests.trackType` - 'small' | 'large' (denormalized from track for quick queries)

### Queue Ordering API
- `PUT /api/portal/tracks/[trackId]/reorder` - Client reorders their queue
  - Body: `{ requestIds: string[] }` (ordered list)
  - Validates: all requests belong to this client and this track
  - Updates queuePosition for each

- `PUT /api/admin/tracks/[trackId]/reorder` - Admin reorders any queue
  - Same as above but no client scoping

- `PUT /api/admin/tracks/[trackId]/activate` - Set a request as the active task
  - Body: `{ requestId: string }`
  - Sets previous active to queuePosition 1, new active to 0

## Upsell Logic

```ts
function shouldShowUpsell(subscription: Subscription, queueDepth: number): UpsellType | null {
  if (subscription.planType === 'maintain' && queueDepth >= 3) {
    return {
      message: "Your queue is growing! Scale plan gives you 2 tracks running simultaneously.",
      targetPlan: 'scale',
      savings: "Get work done 2x faster"
    }
  }
  if (subscription.planType === 'scale' && queueDepth >= 5) {
    return {
      message: "Need more capacity? Add extra tracks to your plan.",
      targetPlan: 'custom',
      savings: "Custom track configuration"
    }
  }
  return null
}
```

## Priority Warning Flow

When client selects "High Priority" on a queued task:

1. Check if there's an active task on that track
2. If yes, show modal:
   ```
   "Heads up! Making this high priority will:

   [Option A - for maintain/single track plans]
   Pause '[Active Task Name]' and start '[Selected Task]' immediately.
   Your current task will move to position 1 in the queue.

   [Option B - for scale/multi-track plans]
   Move '[Selected Task]' to the top of your queue.
   It will start as soon as '[Active Task Name]' is delivered.

   [Confirm] [Cancel]"
   ```
3. If confirmed:
   - Option A: Swap active task, notify team
   - Option B: Move to queue position 1, bump others down

## Done Criteria
- Client can see their tracks with active task and queue
- Client can drag to reorder queue
- High priority warning popup works correctly
- Upsell banner shows at appropriate queue depth
- Admin can view and manage all client tracks
- Queue position persists across page reloads
- Mobile: tracks stack vertically, drag still works (touch events)
- Team member gets notified when client reorders queue
