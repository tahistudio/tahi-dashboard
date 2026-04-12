# Tahi Dashboard — Comprehensive Visual Test Suite
**Purpose:** 200+ step-by-step tests organized by persona. Run these to verify flows work end-to-end.
**Format:** Each test = persona + specific task + step-by-step actions + expected outcome

---

## 🎯 PERSONA: POTENTIAL CLIENT (Prospect → Onboarded → Paid → Engaged)

### Phase 1: Discovery & Landing (Tests 1-10)

#### Test 1: Visitor lands on marketing site
**Steps:**
1. Open browser, go to tahi.studio (marketing site)
2. Scroll through homepage features
3. Look for "Get Started" or "Schedule Demo" button
4. Verify no errors in browser console

**Expected:** Homepage loads, CTA buttons visible, no 404s

---

#### Test 2: Visitor clicks "Schedule Demo"
**Steps:**
1. From homepage, click "Schedule Demo" button
2. Should redirect to calendar booking (Google Calendar/Calendly link)
3. Pick a time slot
4. Fill in name, email, company
5. Submit

**Expected:** Booking confirmation received in email

---

#### Test 3: Visitor browses pricing page
**Steps:**
1. Navigate to /pricing
2. See plan cards: Maintain, Scale, Tune, Launch, Hourly
3. Each card shows: price, features, "Get Started" button
4. Hover over features, see tooltips if available
5. Check mobile view looks good

**Expected:** Pricing is clear, all plans visible, CTAs work

---

#### Test 4: Visitor tries to access dashboard as unauthenticated
**Steps:**
1. Try to go directly to /dashboard/overview
2. Should redirect to /sign-in
3. See Clerk sign-in page or custom login form
4. Login buttons: Email, Google, Microsoft visible

**Expected:** Redirected to auth, no dashboard access without login

---

#### Test 5: Potential client signs up via Google OAuth
**Steps:**
1. Click "Continue with Google" on sign-in page
2. Complete Google OAuth flow
3. If first-time: should see onboarding or welcome screen
4. Should create Clerk user + contact record
5. Should redirect to portal dashboard

**Expected:** OAuth works, account created, portal accessible

---

#### Test 6: New client onboarding checklist loads
**Steps:**
1. Just signed up, land on portal /dashboard/overview
2. Look for "Onboarding Checklist" section
3. Should show steps: Complete Profile, Upload Logo, Invite Team, Schedule Kickoff, etc.
4. Each step has checkbox (checked/unchecked)
5. Clicking step shows what's needed

**Expected:** Checklist visible with next steps clearly labeled

---

#### Test 7: New client fills out profile
**Steps:**
1. From onboarding checklist, click "Complete Profile"
2. Form appears: Name, Email, Role (optional), Company
3. Name field has value already (from signup)
4. Fill in Role (e.g., "Product Manager")
5. Click Save
6. See success toast

**Expected:** Profile saves, checklist updates to "completed"

---

#### Test 8: New client uploads company logo
**Steps:**
1. From onboarding, click "Upload Logo"
2. File picker opens
3. Select a PNG/JPG (logo.png, ~2MB)
4. Shows upload progress bar
5. File appears in settings
6. Logo shows in portal header/sidebar

**Expected:** File uploads, appears immediately, no errors

---

#### Test 9: New client invites team members
**Steps:**
1. From onboarding, click "Invite Team Members"
2. Dialog appears: "Enter email addresses"
3. Type multiple emails (comma or line-separated)
4. Subject line is pre-filled
5. Email preview shows message
6. Click "Send Invites"
7. Toast: "2 invites sent"
8. Check that team members receive emails

**Expected:** Invites send, team members get email with join link

---

#### Test 10: Potential client schedules first kickoff call
**Steps:**
1. From onboarding checklist, click "Schedule Kickoff Call"
2. Opens calendar booking (Google Calendar link)
3. Select a time (e.g., next Tuesday, 2pm)
4. Confirm booking
5. Admin receives notification (Slack or in-app)
6. Client's checklist updates to "completed"

**Expected:** Call scheduled, both parties get confirmation

---

### Phase 2: Upgrade to Paid Plan (Tests 11-20)

#### Test 11: Client views billing page
**Steps:**
1. Go to /dashboard/billing (portal)
2. See current plan: "None" or "Hourly"
3. See plan cards below with upgrade options
4. Each plan shows: monthly cost, features, "Upgrade" button
5. See billing cycle toggle (monthly/quarterly/annual)

**Expected:** Billing page loads, plans visible, toggle works

---

#### Test 12: Client upgrades to "Maintain" plan
**Steps:**
1. On billing page, click "Upgrade" on Maintain plan
2. Should redirect to Stripe checkout
3. See: plan details, price, billing address form
4. Fill in card (test card: 4242...)
5. Complete payment
6. Redirect back to dashboard

**Expected:** Stripe checkout works, payment processes, plan updated

---

#### Test 13: Subscription confirmation email arrives
**Steps:**
1. Check email inbox (same email as signup)
2. Look for "Welcome to your Maintain plan"
3. Email contains: plan name, billing date, pricing
4. Email has link to manage subscription

**Expected:** Confirmation email arrives within 2 minutes

---

#### Test 14: Client views invoice after payment
**Steps:**
1. Go to /dashboard/invoices (portal)
2. See invoice for signup charges
3. Click invoice row to open detail
4. See line items: "Maintain plan - Mar 2026 - $X/mo"
5. Download PDF button works
6. Pay button shows (if unpaid)

**Expected:** Invoice visible, PDF downloadable, payment available

---

#### Test 15: Subscription appears in Stripe
**Steps:**
1. Log into Stripe dashboard
2. Search for customer (client's email)
3. Find subscription with "Maintain" plan
4. See: $XXX/month, auto-renews on [date]
5. Invoice history shows payment

**Expected:** Stripe has correct customer and subscription record

---

#### Test 16: Client can change billing cycle
**Steps:**
1. On /dashboard/billing, see "Billing Cycle" dropdown
2. Currently: "Monthly" selected
3. Change to "Quarterly"
4. Confirmation dialog: "Change to quarterly billing?"
5. Confirm
6. See "Next billing: [date 3 months from now]"

**Expected:** Billing cycle updates, next charge date recalculates

---

#### Test 17: Stripe webhook syncs payment
**Steps:**
1. In Stripe test mode, process a payment manually
2. Webhook fires: `invoice.paid` event
3. Check dashboard: invoice status changes from "pending" to "paid"
4. Check database: invoices table shows `status='paid'`, `paidAt` timestamp

**Expected:** Payment webhook received, invoice status updates in real-time

---

#### Test 18: Client views payment method in Stripe
**Steps:**
1. From portal billing page, click "Manage Subscription" link
2. Opens Stripe customer portal
3. Can view card ending in ****4242
4. Can update card (add new, remove, set default)
5. Can view billing history, download receipts

**Expected:** Stripe portal accessible, can manage payment methods

---

#### Test 19: Client receives invoice email
**Steps:**
1. (Trigger: admin sends invoice OR auto-sent on [date])
2. Check inbox for "Your Tahi Invoice for [month]"
3. Email contains PDF attachment
4. Email has link to view online
5. Click link, can view in browser

**Expected:** Invoice email arrives with PDF, link works

---

#### Test 20: Client's team member can also access billing
**Steps:**
1. Log in as team member invited earlier
2. Go to /dashboard/billing
3. See same billing info as original contact
4. Cannot change subscription (read-only)
5. Can see invoice history

**Expected:** Team members have read-only access to billing

---

### Phase 3: First Request Submission (Tests 21-35)

#### Test 21: Client views empty request list
**Steps:**
1. Go to /dashboard/requests (portal view)
2. See empty state: leaf icon + "No requests yet"
3. Text: "Submit your first request to get started"
4. Button: "Create Request"

**Expected:** Empty state clear, CTA visible

---

#### Test 22: Client clicks create request
**Steps:**
1. On empty requests page, click "Create Request" button
2. New Request dialog opens
3. See title field, category dropdown, description field
4. Category dropdown shows: Design, Development, Content, etc.
5. Fields are validated (required marked with *)

**Expected:** Dialog opens with correct form structure

---

#### Test 23: Client selects request category
**Steps:**
1. In Create Request dialog, click Category dropdown
2. See options: Design, Development, Content, Strategy, etc.
3. Select "Design"
4. Form updates: intake form questions appear below

**Expected:** Category selects, form questions load based on category

---

#### Test 24: Client fills intake form questions
**Steps:**
1. Category is "Design"
2. See form questions (e.g., "What is the scope?", "Budget?")
3. Question types: text, textarea, select, file upload, checkbox
4. Fill out all questions (required ones)
5. Optional questions can be left blank

**Expected:** All question types render and accept input

---

#### Test 25: Client attaches file to request
**Steps:**
1. In intake form, see file upload field
2. Click "Choose File"
3. Select a reference image (PNG, JPG)
4. Shows filename, file size
5. Can remove and select different file

**Expected:** File picker works, file info displays

---

#### Test 26: Client writes request description
**Steps:**
1. Main description field (Tiptap editor)
2. Type description with formatting: bold, italic, lists
3. Can paste screenshot/image
4. Preview shows formatted text

**Expected:** Rich text editor works, formatting persists

---

#### Test 27: Client submits first request
**Steps:**
1. Fill all required fields
2. Click "Submit Request"
3. Dialog closes
4. Toast: "Request created successfully"
5. Redirected to request detail view
6. Request appears in list

**Expected:** Request creates, appears immediately, detail page loads

---

#### Test 28: Admin receives request notification
**Steps:**
1. Admin logged into dashboard
2. Bell icon shows "1" unread notification
3. Click bell, see notification: "New request from [Client]"
4. Click notification, goes to request detail

**Expected:** Notification arrives in real-time (SSE)

---

#### Test 29: Admin sees request in their queue
**Steps:**
1. Admin goes to /dashboard/requests
2. See request from new client in list
3. Request shows: title, client name, "submitted" status, date created
4. Can filter by status, client, priority

**Expected:** Request visible in admin list, filterable

---

#### Test 30: Admin assigns request to team member
**Steps:**
1. On request detail, see "Assignee" field (currently unassigned)
2. Click dropdown, select team member (e.g., "Sarah - Designer")
3. Request updated immediately
4. Team member sees request in their assignment queue

**Expected:** Assignment updates, team member notified

---

#### Test 31: Admin changes request status
**Steps:**
1. On request detail, see Status: "Submitted"
2. Click status, see flow: Submitted → In Review → In Progress → Client Review → Delivered
3. Click "In Progress"
4. Status badge updates color
5. Client sees status change on their side

**Expected:** Status flow works, both sides update

---

#### Test 32: Admin adds internal note to request
**Steps:**
1. Scroll down to messages/notes section
2. Click "Add Note (Internal Only)"
3. Type note: "Need client approval on scope first"
4. Toggle: "Internal" is on
5. Click Send
6. Note appears with lock icon (internal)
7. Client's view does NOT show this note

**Expected:** Internal notes visible to team only, locked icon shown

---

#### Test 33: Admin messages client on request
**Steps:**
1. In message section, type: "Hi! We've started your design. Can you review the attached comp?"
2. Toggle: "Internal" is OFF
3. Attach file: design-comp.png
4. Click Send
5. Message appears with timestamp
6. Client receives notification and sees message

**Expected:** External message sends, client notified, file visible

---

#### Test 34: Client responds to request message
**Steps:**
1. Client logs in, goes to request detail
2. Sees team member's message + design comp attachment
3. Clicks to view attachment (preview or download)
4. Types reply: "Looks great! Can you make the font bigger?"
5. Sends message
6. Team member sees reply immediately

**Expected:** Messages sync bidirectionally, attachments previewable

---

#### Test 35: Admin sees message and request activity timeline
**Steps:**
1. Admin views request detail
2. Scroll to Activity/Timeline section
3. See events: "Request created", "Status changed to In Progress", "Message from [client]"
4. Timeline shows chronologically
5. Each activity has timestamp, author, action

**Expected:** Activity log captures all interactions

---

### Phase 4: Collaboration & Updates (Tests 36-50)

#### Test 36: Client uploads revision file
**Steps:**
1. Client clicks "Upload File" on request
2. File picker: select revised-logo-v2.png
3. File shows in attachments list
4. Can upload multiple files
5. Each file shows size, upload time

**Expected:** Multiple file uploads work, all listed

---

#### Test 37: Client views all request files
**Steps:**
1. On request detail, see "Attachments" tab
2. List shows: original reference image, design comps from team, client uploads
3. Can click to preview, download, or delete own uploads

**Expected:** File list comprehensive, previews work

---

#### Test 38: Team member logs time on request
**Steps:**
1. On request detail, see "Time Entries" tab
2. Click "Log Time"
3. Form: Hours (0.5), Billable (toggle on), Description (optional), Date
4. Submit
5. Time entry appears in list
6. Total billable hours updates at top

**Expected:** Time logging works, totals calculate

---

#### Test 39: Admin marks request as in client review
**Steps:**
1. Status: "In Progress" → "Client Review"
2. Request shows to client as "Awaiting Your Feedback"
3. Client sees message: "We need your approval to proceed"
4. Client can reply with approval/revisions

**Expected:** Status change clear to client, they understand action needed

---

#### Test 40: Client approves deliverable
**Steps:**
1. See message: "Design is ready for review"
2. Attached: final-design.pdf
3. Click "Approve & Mark Complete" button (custom action)
4. Adds message: "Approved! Looks perfect."
5. Request status → "Delivered"

**Expected:** Approval action moves request to delivered state

---

#### Test 41: Request completion email sent
**Steps:**
1. (Trigger: request marked delivered)
2. Client receives email: "Your design request is complete"
3. Email summary: what was delivered, total time spent, next steps
4. Email has button to view request details

**Expected:** Completion email arrives, details correct

---

#### Test 42: Admin requests revision
**Steps:**
1. Request is "Delivered"
2. Admin realizes: client needs revision
3. Click "Request Revision"
4. Status returns to "In Progress"
5. Sends message: "Client sent feedback, let's adjust X"

**Expected:** Can revert delivered request back to in-progress

---

#### Test 43: Team member collaborates on request
**Steps:**
1. Sarah (designer) and John (developer) assigned to same request
2. Both can see messages, files, timeline
3. Sarah sends message with design file
4. John replies: "I'll integrate this by EOD"
5. Both can log time independently

**Expected:** Multiple team members can collaborate seamlessly

---

#### Test 44: Client uploads revision after request complete
**Steps:**
1. Request is "Delivered"
2. Client sends message: "Actually, can we adjust the color?"
3. Attaches: color-feedback.png
4. Admin sees notification, can open request again
5. Can either: mark as new request or add to existing one

**Expected:** Can easily extend existing request after delivery

---

#### Test 45: Request priority can be adjusted
**Steps:**
1. On request detail, see Priority: "Standard"
2. Click to change to "High"
3. Request moves to top of list (admin view)
4. Badge color changes to indicate urgency

**Expected:** Priority system works, affects list ordering

---

#### Test 46: Request due date is set
**Steps:**
1. On request detail, see Due Date field (empty)
2. Click to open date picker
3. Select date: 2 weeks from today
4. Due date displays on list with status
5. Can modify later

**Expected:** Due date picker works, shows on card

---

#### Test 47: Overdue request shows warning
**Steps:**
1. Set request due date to yesterday
2. On list view, request has red warning icon
3. Hover shows: "Overdue by 1 day"
4. Admin view prioritizes overdue items

**Expected:** Overdue system works visually and functionally

---

#### Test 48: Client invites additional contact to request
**Steps:**
1. On request detail, see "Invite Collaborator" option
2. Enter email of colleague
3. They receive invite email
4. They can log in and see request
5. Can leave comments/approval

**Expected:** Can expand access to request to more team members

---

#### Test 49: Request tags are used
**Steps:**
1. Admin on request detail, see Tags field
2. Add tags: "urgent", "client-approval", "high-value"
3. Tags save and show as colored pills
4. Can filter list by tags

**Expected:** Tag system works for organization

---

#### Test 50: Request search works
**Steps:**
1. Go to /dashboard/requests (admin)
2. Type in search: "logo"
3. List filters to show only requests with "logo" in title/description
4. Search also hits client names
5. Clear search, back to full list

**Expected:** Search responsive, accurate results

---

### Phase 5: Meetings & Communication (Tests 51-65)

#### Test 51: Admin schedules first kickoff call
**Steps:**
1. On client detail page, click "Schedule Call"
2. Form: Title, Description, Date/Time, Duration, Attendees, Meeting Link
3. Title: "Kickoff Call - [Client Name]"
4. Date: March 20, 2026, 2:00 PM
5. Duration: 30 mins
6. Add attendee: client contact email
7. Meeting Link: paste Google Meet link
8. Submit

**Expected:** Call creates, appears on dashboard

---

#### Test 52: Client receives meeting invitation
**Steps:**
1. (Trigger: admin creates call)
2. Client receives email: "[Team] scheduled a call with you"
3. Email has: date, time, meeting link, description
4. Email has "Add to Calendar" button
5. Click link, can join meeting

**Expected:** Invitation email professional, link works

---

#### Test 53: Scheduled call appears in admin calendar
**Steps:**
1. Admin goes to /dashboard/calls (or calendar view)
2. Sees scheduled call on March 20 at 2:00 PM
3. Shows: attendees, title, meeting link
4. Can click to edit or send reminder

**Expected:** Call appears in admin schedule

---

#### Test 54: Admin sends call reminder
**Steps:**
1. Call is scheduled for tomorrow
2. Admin clicks "Send Reminder"
3. Client receives email: "Reminder: Your call is tomorrow at 2 PM"
4. Email includes meeting link again
5. Can RSVP or ask to reschedule

**Expected:** Reminder email sends, client can respond

---

#### Test 55: Client joins call via meeting link
**Steps:**
1. Meeting time arrives
2. Client clicks Google Meet link in email
3. Browser opens Google Meet (or calendar app auto-opens)
4. Client joins call, sees admin on video
5. Can chat, share screen

**Expected:** Google Meet link works, meeting accessible

---

#### Test 56: Admin records call
**Steps:**
1. In Google Meet, start recording
2. "This call is being recorded" notification
3. Call finishes, recording saved to Google Drive
4. Admin downloads recording

**Expected:** Call recordings functional (inherent to Google Meet)

---

#### Test 57: Admin uploads recording to request
**Steps:**
1. Call completed, admin has recording
2. Go to request detail
3. Click "Attach File" → upload recording-kickoff-call.mp4
4. Shows in attachments
5. Can preview (video player) or download

**Expected:** Video files upload, preview in browser

---

#### Test 58: Admin adds call notes to request
**Steps:**
1. Call finished
2. Admin sends message: "Call notes: Approved budget, timeline is 3 weeks, needs weekly check-ins"
3. Attaches: call-notes.txt
4. Client sees notes and summary

**Expected:** Call summary documented and shared

---

#### Test 59: Team communicates in real-time chat
**Steps:**
1. Go to /dashboard/messages (portal or admin)
2. See conversation list: channels, direct messages
3. Click conversation with client
4. Type message, see it appear immediately
5. Client (logged in elsewhere) sees new message in real-time

**Expected:** Messaging instant, no refresh needed (SSE)

---

#### Test 60: Client initiates direct message with admin
**Steps:**
1. Client goes to /dashboard/messages
2. Click "New Message" or "New Conversation"
3. Search for team member: "Sarah - Designer"
4. Open 1:1 conversation
5. Type: "Do you have time for a quick call?"
6. Sarah receives notification immediately

**Expected:** 1:1 messaging works, notifications real-time

---

#### Test 61: Internal team channel (admin-only)
**Steps:**
1. Admin goes to messages
2. See org_channel: "#tahi-team"
3. All team members in channel
4. Can post team-only updates
5. Client cannot see this channel

**Expected:** Org channels exist, private to team

---

#### Test 62: Client request thread conversation
**Steps:**
1. On request detail, see "Request Thread" (conversation)
2. All messages about THIS request in thread
3. New message automatically goes to thread
4. Can view thread history
5. Thread is request-scoped, not polluting main inbox

**Expected:** Request threads organize conversation per request

---

#### Test 63: Admin @mentions client in message
**Steps:**
1. Admin types message: "@Jane - Can you review this?"
2. System detects @Jane
3. Jane receives priority notification
4. Message shows "mentioned you" indicator

**Expected:** Mentions work, notify mentioned users

---

#### Test 64: Message attachments with preview
**Steps:**
1. Admin sends message with: "Here's the design" + image
2. Client sees message + inline image preview
3. Can click image to expand
4. Can download or share

**Expected:** Image previews inline, clickable to expand

---

#### Test 65: Conversation search
**Steps:**
1. Go to messages
2. Search box at top
3. Type: "design approval"
4. Shows all messages with that phrase
5. Highlights matching text
6. Can jump to context

**Expected:** Message search finds conversations

---

### Phase 6: Analytics & Reviews (Tests 66-80)

#### Test 66: Client views request status summary
**Steps:**
1. Go to /dashboard/overview (portal)
2. See stats card: "Active Requests: 3"
3. Card shows breakdown: "1 in progress, 2 awaiting feedback"
4. Click card → filters to active requests

**Expected:** Status summary accurate and interactive

---

#### Test 67: Client views completed requests
**Steps:**
1. Go to /dashboard/requests
2. Filter: Status = "Delivered"
3. See all completed requests (3 total)
4. Each shows: title, date completed, total time
5. Can re-open or submit follow-up

**Expected:** Delivery history clear, can reference past work

---

#### Test 68: Admin views team capacity
**Steps:**
1. Admin goes to /dashboard/capacity
2. See bar chart: team member utilization
3. Sarah: 85% (allocated to requests)
4. John: 60% (available for more work)
5. Color coding: red (overloaded), green (healthy)

**Expected:** Capacity dashboard shows team load

---

#### Test 69: Client views billing summary
**Steps:**
1. Go to /dashboard/billing
2. See: Current plan, monthly cost, billing date
3. See: Total spent this month (hours logged)
4. See: Upcoming charges
5. See: Payment method on file

**Expected:** Billing dashboard complete and clear

---

#### Test 70: Admin generates report: Billable hours by client
**Steps:**
1. Go to /dashboard/reports
2. Click "Billable Hours"
3. Select date range: This month
4. See table: Client → Hours → Rate → Total
5. Can export as CSV

**Expected:** Report generates, export works

---

#### Test 71: Admin generates report: Request cycle time
**Steps:**
1. Reports page, click "Request Turnaround"
2. Shows average time from submission to delivery
3. Broken down by request type (Design avg 5 days, Dev avg 10 days)
4. Trend chart over 3 months

**Expected:** Cycle time report calculates correctly

---

#### Test 72: Client requests review/testimonial
**Steps:**
1. Trigger: Request delivered 2 weeks ago
2. Client receives email: "We'd love your feedback!"
3. Email has link to quick survey
4. Survey asks: "Rate your experience (1-5 stars)"
5. Survey asks: "May we feature you as a case study?"

**Expected:** Review request email triggers automatically

---

#### Test 73: Client submits review/testimonial
**Steps:**
1. Click review survey link from email
2. Rate: 5 stars
3. Write testimonial: "Tahi delivered exactly what we needed, on time!"
4. Opt-in: "Yes, feature our company"
5. Submit
6. See: "Thank you! Your feedback helps us improve."

**Expected:** Review submission successful, thank you confirmation

---

#### Test 74: Admin sees client review in dashboard
**Steps:**
1. Admin goes to /dashboard/reviews
2. See submitted review from client
3. Shows: rating (5 stars), testimonial text, company name, date
4. Can mark: approved for website, case study status

**Expected:** Reviews appear in admin dashboard

---

#### Test 75: Admin generates case study from review
**Steps:**
1. On client review, click "Generate Case Study"
2. Form pre-fills: Client name, quote, rating
3. Admin adds: challenges faced, solution implemented, results/metrics
4. Admin uploads: before/after screenshots
5. Save as draft
6. Preview on website

**Expected:** Case study generation workflow complete

---

#### Test 76: Health score appears on client card
**Steps:**
1. Admin goes to /dashboard/clients
2. On client row, see health score: "Excellent" (green)
3. Hover shows breakdown: response time, request satisfaction, payment history
4. Click to see full details

**Expected:** Health score calculated and displayed

---

#### Test 77: NPS (Net Promoter Score) calculation
**Steps:**
1. Trigger: Multiple reviews collected (10+)
2. Admin goes to /dashboard/reports
3. See NPS score: 72 (excellent)
4. Breakdown: 8 promoters, 2 passives, 0 detractors
5. Trend over time

**Expected:** NPS calculates and trends show

---

#### Test 78: Response time metric tracked
**Steps:**
1. Admin goes to /dashboard/reports
2. See "Avg Response Time: 2.3 hours"
3. Breakdown by team member, by request type
4. Compare to previous month

**Expected:** Response time metrics accurate and trended

---

#### Test 79: Admin views team member performance
**Steps:**
1. Admin goes to /dashboard/team
2. Click on team member "Sarah"
3. See stats: Requests completed (15), Avg turnaround (4.2 days), Reviews (4.8/5), Utilization (82%)
4. Can see her availability for next week

**Expected:** Individual performance visible

---

#### Test 80: Client views impact dashboard
**Steps:**
1. Client goes to /dashboard/overview
2. See impact summary: "We've completed 12 requests for you"
3. Summary: "3,200 total hours invested, $48,000 value created"
4. Trend chart: requests per month over 6 months

**Expected:** Client sees relationship value clearly

---

### Phase 7: Advanced Workflows (Tests 81-100)

#### Test 81: Bulk request creation (admin)
**Steps:**
1. Admin goes to /dashboard/requests
2. Click "Bulk Create"
3. Form: Select clients (multi-select), Title template, Category
4. Title template: "Q2 Website Audit - {client name}"
5. Create 5 requests at once (one for each client)
6. See confirmation: "5 requests created"

**Expected:** Bulk creation works, all appear in list

---

#### Test 82: Request templates
**Steps:**
1. Admin goes to /dashboard/settings → Request Templates
2. See template: "Brand Audit" (category: Strategy)
3. Template has pre-filled: description, questions, estimated hours
4. Create new request from template
5. All fields pre-populate

**Expected:** Templates save time, pre-population works

---

#### Test 83: Task management for request
**Steps:**
1. On request detail, see "Tasks" tab
2. Click "Add Task"
3. Create task: "Create mockups" (subtask of request)
4. Assign to Sarah, due date (this week)
5. Sarah sees task in /dashboard/tasks
6. Can mark subtasks as done

**Expected:** Request-level tasks create and track

---

#### Test 84: Kanban board view for requests
**Steps:**
1. Admin goes to /dashboard/requests
2. Switch view: List → Kanban
3. See columns: Submitted, In Review, In Progress, Client Review, Delivered
4. Can drag request card between columns
5. Dropping on "Delivered" changes status

**Expected:** Kanban drag-and-drop works, updates status

---

#### Test 85: Request filters and saved views
**Steps:**
1. Admin applies filters: Status = "In Progress", Client = "Acme Corp"
2. Click "Save View" → name it "Acme In Progress"
3. View saves
4. Later, click view name from sidebar → filters apply automatically

**Expected:** Saved views persist, reload filters

---

#### Test 86: Custom request statuses per client
**Steps:**
1. Admin goes to /dashboard/settings → Kanban Columns
2. For "Acme Corp", override status columns
3. Add custom: "Scoping", "Design Review", "Dev Ready"
4. Acme's board shows custom columns
5. Other clients still see default columns

**Expected:** Per-client customization works

---

#### Test 87: Request form builder (admin)
**Steps:**
1. Admin goes to /dashboard/settings → Request Forms
2. Click "Create New Form"
3. Form: category (Design), questions (add 5 custom questions)
4. Question types: text, select, checkbox, file upload
5. Mark some required, some optional
6. Save form
7. Next request in Design category uses this form

**Expected:** Form builder works, forms apply to category

---

#### Test 88: Conditional form questions
**Steps:**
1. Form has question: "Design type?" with options: Logo, Website, App
2. If "Website" selected, show additional questions: "Pages needed?", "CMS?"
3. If "App" selected, show different questions
4. Client fills form, conditional questions appear/disappear

**Expected:** Conditional logic works based on selections

---

#### Test 89: Request revision tracking
**Steps:**
1. Request goes through 3 revisions (original, rev1, rev2)
2. On request detail, see "Revision History" tab
3. Each revision shows: files, messages, date
4. Can compare versions side-by-side
5. Final version marked clearly

**Expected:** Revision history complete and organized

---

#### Test 90: Automation rule: Auto-assign request
**Steps:**
1. Admin goes to /dashboard/settings → Automations
2. Create rule: "When request category = Design, assign to Sarah"
3. Enable rule
4. Client submits Design request
5. Request auto-assigns to Sarah immediately

**Expected:** Automation triggers, assignment happens

---

#### Test 91: Automation rule: Auto-send message
**Steps:**
1. Admin creates automation: "When request status = Delivered, send message"
2. Message template: "Your request is complete! [Request title]"
3. Message sends automatically to client
4. Client sees message immediately

**Expected:** Auto-messaging works

---

#### Test 92: Slack integration: New request alert
**Steps:**
1. Slack integration enabled in settings
2. Client submits request
3. Team Slack channel (#tahi-team) gets message: "[Client] submitted design request: [Title]"
4. Message has link to request detail
5. Admin can click to jump to request

**Expected:** Slack notifications work, links functional

---

#### Test 93: Slack integration: Daily summary
**Steps:**
1. Slack integration configured
2. Each morning at 9 AM, Slack message: "Daily Summary: 3 new requests, 2 due today, 1 overdue"
3. Message has breakdown and links

**Expected:** Daily digest schedule works, accurate

---

#### Test 94: Webhooks outbound
**Steps:**
1. Admin sets up outgoing webhook to external system
2. Trigger: Request status changes
3. Webhook URL configured
4. Client submits request
5. External system receives webhook payload with request data

**Expected:** Webhook POST works, payload correct

---

#### Test 95: Integrations: Xero push
**Steps:**
1. Admin goes to /dashboard/settings → Xero Integration
2. Click "Connect to Xero"
3. OAuth flow: authorize dashboard
4. Confirms connected
5. Generate invoice from dashboard
6. Click "Send to Xero"
7. Invoice appears in Xero within seconds

**Expected:** Xero push integration works, invoice syncs

---

#### Test 96: Integrations: Google Calendar
**Steps:**
1. Admin connects Google Calendar in settings
2. When scheduling a call, click "Generate Meeting Link"
3. Automatically creates Google Meet link
4. Link appears in call details
5. Attendees see link in invitation

**Expected:** Google Calendar integration, link generation automatic

---

#### Test 97: Two-person onboarding (team member + client)
**Steps:**
1. Team member invited, completes signup
2. Client invited, completes signup
3. System recognizes they're from same org
4. Can both see request, collaborate
5. Can both log time, upload files

**Expected:** Multi-person accounts linked correctly

---

#### Test 98: Request dependencies
**Steps:**
1. Admin sets request B depends on request A
2. Request A is not yet delivered
3. Request B shown as "Blocked" (greyed out)
4. Admin completes request A
5. Request B status changes to "Unblocked" (active)

**Expected:** Dependency tracking prevents workflow errors

---

#### Test 99: Request archival
**Steps:**
1. Old request from 6 months ago
2. Admin clicks "Archive"
3. Request removed from active list
4. Can filter view: "Show archived"
5. Can restore from archive if needed

**Expected:** Archival cleans up list, restores possible

---

#### Test 100: Request linking (related requests)
**Steps:**
1. Request A: "Logo Design"
2. Request B: "Business Card Design"
3. On request A, click "Link Related Request"
4. Select request B
5. Both requests show "Related" section with link
6. Can jump between related requests

**Expected:** Request relationships navigable

---

## 👨‍💼 PERSONA: TEAM MEMBER (Designer/Developer/Content Writer)

### Tests 101-150: Team Member Workflows

#### Test 101: Team member signs up via invite link
**Steps:**
1. Receives email: "You've been invited to Tahi" with link
2. Click link
3. Email is pre-filled, password setup
4. Create account
5. Redirected to dashboard
6. See assigned clients/requests

**Expected:** Invite flow smooth, dashboard shows assignments

---

#### Test 102: Team member views assigned requests
**Steps:**
1. Go to /dashboard/requests
2. Filter: "Assigned to me"
3. See 5 requests: 2 in progress, 1 awaiting info, 2 awaiting approval

**Expected:** Filter works, assignments clear

---

#### Test 103: Team member updates request status
**Steps:**
1. On assigned request, see Status: "In Progress"
2. Made progress, change to "Client Review"
3. Client automatically notified
4. Request moves to their approval queue

**Expected:** Status change sends client notification

---

#### Test 104: Team member logs time daily
**Steps:**
1. End of day, go to /dashboard/requests
2. On each request worked on, click "Log Time"
3. Hours: 2.5, Billable: yes, Description: "Designed 3 mockups"
4. Submit
5. Hours accumulate on request

**Expected:** Time entry quick to log, persists

---

#### Test 105: Team member views time entries
**Steps:**
1. Go to /dashboard/time
2. See all logged hours (week view by default)
3. Filter: billable only, or by client
4. Total hours week: 38
5. Breakdown by request

**Expected:** Time tracking clear, totals accurate

---

#### Test 106: Team member exports timesheet
**Steps:**
1. On time entries, select date range (this month)
2. Click "Export CSV"
3. Downloads CSV with: date, hours, request, billable status

**Expected:** CSV export works, format correct for accounting

---

#### Test 107: Team member sees capacity utilization
**Steps:**
1. /dashboard/capacity (personal view)
2. See: Allocated hours (40), Available hours (0)
3. Shows what team member is overloaded
4. Can request capacity adjustment

**Expected:** Capacity visible, team member aware of load

---

#### Test 108: Team member collaborates with another team member
**Steps:**
1. Designer and Developer assigned to same request
2. Designer uploads design files
3. Developer sees files, asks: "Can you adjust the padding?"
4. Designer replies: "Done! New file uploaded."
5. Both logged into system, see updates in real-time

**Expected:** Real-time collaboration smooth

---

#### Test 109: Team member sends internal-only message
**Steps:**
1. On request detail, type message to team: "Client's budget is tight, let's simplify"
2. Click toggle: "Internal only"
3. Send
4. Message shows with lock icon
5. Client cannot see message

**Expected:** Internal messages hidden from client

---

#### Test 110: Team member receives task assignment
**Steps:**
1. (Trigger: Admin creates task "Review client wireframes")
2. Team member gets notification: "You've been assigned a task"
3. Go to /dashboard/tasks
4. Task appears in list: "Review client wireframes - Due today"
5. Can mark as done

**Expected:** Task notifications and list accurate

---

#### Test 111: Team member marks task as done
**Steps:**
1. On assigned task, click checkbox (complete)
2. Task moved to "Completed" section
3. Admin sees task completion in real-time

**Expected:** Task completion instant and visible

---

#### Test 112: Team member creates subtask
**Steps:**
1. Main task: "Design website"
2. Click "Add Subtask"
3. Subtask: "Create homepage mockup"
4. Subtask assigned to same person, due 3 days before main task
5. Can track progress at subtask level

**Expected:** Subtask hierarchy clear, tracks granularly

---

#### Test 113: Team member updates profile/availability
**Steps:**
1. Go to /dashboard/team (personal settings)
2. Update: availability (8 hrs/week next month), skills (add "UI/UX Design")
3. Save
4. Admin sees updated skills when assigning tasks

**Expected:** Profile updates visible to admin

---

#### Test 114: Team member blocks out time (vacation)
**Steps:**
1. Calendar view on /dashboard
2. Click days off (April 10-15)
3. Mark "Out of office"
4. Blocks time from availability calculation
5. Admin sees gaps on calendar

**Expected:** Time-off blocks prevent over-assignment

---

#### Test 115: Team member receives review from admin
**Steps:**
1. Admin goes to team member detail page
2. Leave review/feedback: "Great work on the design! One thing: consider user testing next time."
3. Team member gets notification
4. Can respond or acknowledge

**Expected:** Performance feedback system works

---

#### Test 116: Team member views 1-on-1 meeting notes
**Steps:**
1. Scheduled 1-on-1 with manager
2. After meeting, manager uploads notes
3. Team member can see: goals discussed, feedback, next steps
4. Can add their own notes in response

**Expected:** 1-on-1 notes collaborative and documented

---

#### Test 117: Team member receives performance summary
**Steps:**
1. End of month, team member gets email: "Your monthly summary"
2. Email shows: requests completed, hours, client satisfaction, growth areas
3. Can view full report on dashboard

**Expected:** Performance summaries regular and balanced

---

#### Test 118: Team member can request time off
**Steps:**
1. Go to /dashboard/team
2. Click "Request Time Off"
3. Dates: July 1-5, type: vacation
4. Add note: "Family visit"
5. Admin reviews and approves
6. Blocked on calendar once approved

**Expected:** Time-off request workflow clear

---

#### Test 119: Team member uses shortcuts/macros
**Steps:**
1. Frequently sends same message: "Can you please clarify...?"
2. Admin sets up macro in settings
3. Team member types shortcut: `:clarify`
4. Expands to full message
5. Saves typing time

**Expected:** Macros work if implemented, save time

---

#### Test 120: Team member filters requests by priority
**Steps:**
1. /dashboard/requests
2. Filter: Priority = High
3. See 7 high-priority requests
4. Sorted by due date (soonest first)

**Expected:** Priority filtering works, affects sort order

---

#### Test 121: Team member uses request search
**Steps:**
1. Search bar: "acme logo"
2. Finds requests with "Acme" in client name and "logo" in title
3. Can jump to matching requests

**Expected:** Search finds requests accurately

---

#### Test 122: Team member bulk updates requests
**Steps:**
1. Select 3 requests (checkboxes)
2. Bulk action: "Change status to Client Review"
3. All 3 update at once
4. Clients all notified simultaneously

**Expected:** Bulk actions reduce repetitive clicking

---

#### Test 123: Team member gets daily digest email
**Steps:**
1. Each morning, team member gets email
2. Email shows: assigned requests summary, due today, overdue, new messages
3. Can click to jump to dashboard item

**Expected:** Daily digest email saves time checking

---

#### Test 124: Team member has read-only access to billing
**Steps:**
1. Go to /dashboard/billing
2. See client invoices, amounts, dates
3. Cannot modify or create invoices (read-only)
4. Cannot see payment methods

**Expected:** Billing visibility limited per role

---

#### Test 125: Team member views request history on client
**Steps:**
1. Go to /dashboard/clients
2. Click client detail
3. See "Requests" tab: all requests from this client
4. Filter by status, date range
5. See total requests completed, revenue

**Expected:** Client history comprehensive

---

#### Test 126: Team member logs notes on client
**Steps:**
1. On client detail, see "Internal Notes" section
2. Add note: "They prefer email updates, not Slack"
3. Note visible to all team members
4. Persists for future reference

**Expected:** Client notes shared across team

---

#### Test 127: Team member reviews client contract
**Steps:**
1. On client detail, "Contracts" tab
2. See signed NDA, SLA, SOW
3. Can download/preview documents
4. Can see signature date

**Expected:** Contracts accessible to team

---

#### Test 128: Team member receives Slack notification
**Steps:**
1. Slack app configured
2. New request assigned → Slack message
3. Click message link → jumps to request in dashboard
4. Message shows: request title, client, due date

**Expected:** Slack notifications click-through working

---

#### Test 129: Team member updates availability in Slack
**Steps:**
1. In Slack, message bot: "set status busy until 5pm"
2. Dashboard updates: team member blocked until 5pm
3. Admin sees updated availability

**Expected:** Slack commands integrate with dashboard

---

#### Test 130: Team member exports portfolio of work
**Steps:**
1. Go to /dashboard/team (personal profile)
2. Click "Export Portfolio"
3. Options: "Completed requests (PDF)" or "Case studies (PDF)"
4. PDF generates with images, descriptions, client testimonials
5. Can share with potential employers

**Expected:** Portfolio export professional and usable

---

#### Test 131: Team member templates repeated workflows
**Steps:**
1. Designer frequently does: mockup → revision → approval
2. Creates workflow template: "Design approval process"
3. Next time: select template, it pre-populates task steps
4. Reduces manual setup

**Expected:** Workflow templates save time

---

#### Test 132: Team member receives skill development recommendations
**Steps:**
1. Team member lacks "React development" skill
2. Dashboard recommends: "Consider taking React course (4 hours)"
3. Can log learning time as professional development
4. Skill added to profile once completed

**Expected:** Skill development tracked and encouraged

---

#### Test 133: Team member compares request types
**Steps:**
1. On /dashboard/reports (personal)
2. See breakdown: 10 design requests (avg 4 days), 5 dev requests (avg 8 days)
3. See where team member excels vs. needs improvement

**Expected:** Personal performance breakdown clear

---

#### Test 134: Team member books time with client
**Steps:**
1. Client wants quick design consultation
2. Team member goes to /calendar
3. Clicks "Schedule with Client"
4. Shows available time slots
5. Client receives invite and confirms

**Expected:** Self-service meeting booking possible

---

#### Test 135: Team member gets annual performance review
**Steps:**
1. Review period ends
2. Manager schedules meeting, uploads form
3. Form has: goals, accomplishments, areas for growth, feedback
4. Team member fills out self-assessment
5. Meeting to discuss and align on next year

**Expected:** Annual review process structured

---

#### Test 136: Team member trains new hire
**Steps:**
1. New designer joins
2. Assigned to shadow existing designer for 3 days
3. Checklist: "Complete training" with steps
4. Each day, trainer signs off
5. After 3 days, new hire can take own requests

**Expected:** Onboarding structured and tracked

---

#### Test 137: Team member participates in team retro
**Steps:**
1. End of sprint, team retro scheduled
2. Async form shared: "What went well? What didn't? What to improve?"
3. Responses collected in dashboard
4. Retro meeting discussion based on collected feedback

**Expected:** Retrospectives structured and inclusive

---

#### Test 138: Team member tracks billable vs non-billable time
**Steps:**
1. Time entry has toggle: "Billable"
2. Billable hours count toward client invoices
3. Non-billable: training, admin, buffer
4. Report shows split: 32 billable, 8 non-billable (out of 40 hrs)

**Expected:** Utilization rate accurate

---

#### Test 139: Team member gets utilization alert
**Steps:**
1. Team member is 95% allocated
2. System sends alert: "You're at capacity. Consider deferring new requests."
3. Can request temporary reduction in allocation

**Expected:** Overallocation prevented proactively

---

#### Test 140: Team member uses request templates
**Steps:**
1. Frequently-requested task: "Brand audit"
2. Admin creates template with: description, scope, estimated hours, questions
3. Team member selects template when creating request
4. All fields pre-populate, saves time

**Expected:** Templates accelerate request setup

---

#### Test 141: Team member discusses scope expansion
**Steps:**
1. Partway through request, client asks for additional work
2. Team member notes in request: "Client wants X added"
3. Messages admin
4. Admin determines if it's included or separate request

**Expected:** Scope changes documented and discussed

---

#### Test 142: Team member uses search to find similar past requests
**Steps:**
1. Starting new request for client: "Logo redesign"
2. Search: "logos from Acme"
3. Finds past logo request from same client
4. Can reference past deliverables, brand guidelines
5. Speeds up new project kickoff

**Expected:** Past work searchable and reusable

---

#### Test 143: Team member configures notification preferences
**Steps:**
1. Go to /dashboard/settings → Notifications
2. Toggle: "New request assigned" (on), "Message received" (on), "Call scheduled" (off)
3. Choose delivery: email, in-app, both
4. Set quiet hours: 6pm-9am (no notifications)

**Expected:** Notification preferences respected

---

#### Test 144: Team member receives weekly summary
**Steps:**
1. Every Friday, email: "Your week in review"
2. Email shows: requests completed, hours logged, messages (count), efficiency score

**Expected:** Weekly summaries keep team informed

---

#### Test 145: Team member shares screen for client demo
**Steps:**
1. In call with client
2. Click "Share screen" in Google Meet
3. Screen shared, can demo design
4. Client can ask real-time questions
5. Recording captures demo for reference

**Expected:** Screen sharing seamless (inherent to Meet)

---

#### Test 146: Team member archives completed request
**Steps:**
1. Request done, delivered to client, approved
2. Click "Archive"
3. Removes from active list
4. Can restore if needed
5. Cleans up active queue

**Expected:** Archival keeps workspace clean

---

#### Test 147: Team member receives reminder before deadline
**Steps:**
1. Request due tomorrow
2. Gets notification: "1 day until deadline"
3. Can mark "completed" or request extension

**Expected:** Deadline reminders prevent surprises

---

#### Test 148: Team member gets feedback from client review
**Steps:**
1. Request delivered
2. Client leaves 5-star review: "Excellent work, very responsive"
3. Team member gets notification
4. Review visible on their profile

**Expected:** Positive feedback visible, encouraging

---

#### Test 149: Team member uses request templates across requests
**Steps:**
1. Working on 3 requests with similar scope
2. Uses "Design spec template" for all 3
3. Consistency across deliverables
4. Client sees professional, cohesive output

**Expected:** Templates ensure consistency

---

#### Test 150: Team member submits feature request
**Steps:**
1. Dashboard missing a feature team member needs
2. Go to /dashboard/settings → Feedback
3. Submit: "Would love to integrate Figma files directly"
4. Goes to product backlog
5. Can upvote others' requests

**Expected:** Feedback collection from users

---

## 🔓 PERSONA: HACKER / BAD ACTOR (Security Tests)

### Tests 151-170: Security & Abuse Prevention

#### Test 151: Hacker tries SQL injection in search
**Steps:**
1. Go to /dashboard/requests search
2. Type: `'; DROP TABLE requests; --`
3. Search should escape/sanitize input
4. Returns: "No results" (not an error)
5. No damage to database

**Expected:** SQL injection prevented, data safe

---

#### Test 152: Hacker tries XSS in message
**Steps:**
1. Team member creates message with: `<script>alert('hacked')</script>`
2. Message saved
3. Other users see message, no alert pops
4. Script rendered as escaped text

**Expected:** XSS prevented, script not executed

---

#### Test 153: Hacker tries to access other client's data
**Steps:**
1. Client A user
2. Manually change URL: `/api/portal/clients/{CLIENT_B_ID}`
3. Request blocked: 403 Forbidden
4. Cannot access Client B data

**Expected:** Cross-org access prevented

---

#### Test 154: Hacker tries to bypass authentication
**Steps:**
1. Delete session cookie
2. Try to access /dashboard
3. Redirected to /sign-in
4. Cannot access protected pages without auth

**Expected:** Session validation enforced

---

#### Test 155: Hacker tries weak password
**Steps:**
1. Sign up with password: "123"
2. Error: "Password must be at least 12 characters"
3. Can't proceed with weak password

**Expected:** Password policy enforced

---

#### Test 156: Hacker tries to guess another user's token
**Steps:**
1. Intercept your token (JWT)
2. Modify it (change user ID)
3. Use modified token in API request
4. Fails: signature invalid (JWT tamper detection)

**Expected:** Token tampering detected

---

#### Test 157: Hacker tries to escalate privileges
**Steps:**
1. Client user tries to access `/api/admin/requests`
2. API checks role, returns 403 Forbidden
3. Cannot access admin endpoints

**Expected:** Role-based access control enforced

---

#### Test 158: Hacker brute-forces login
**Steps:**
1. Try login with wrong password 10 times
2. Account temporarily locked: "Too many failed attempts"
3. Cannot login for 15 minutes
4. Email sent to account owner: "Login attempts detected"

**Expected:** Rate limiting prevents brute force

---

#### Test 159: Hacker tries CSRF attack
**Steps:**
1. Visit malicious site with hidden request to change email
2. If logged into Tahi in another tab, site tries to exploit
3. CSRF token validation prevents action
4. Email not changed

**Expected:** CSRF tokens prevent cross-site attacks

---

#### Test 160: Hacker tries to upload malicious file
**Steps:**
1. Upload file with executable: virus.exe
2. System scans file (if implemented)
3. File rejected: "File type not allowed" or quarantined

**Expected:** File upload validation prevents malware

---

#### Test 161: Hacker tries path traversal attack
**Steps:**
1. Try to download file: `/api/uploads/serve?key=../../etc/passwd`
2. Path traversal attempt blocked
3. Only files in intended directory accessible

**Expected:** Path traversal prevented

---

#### Test 162: Hacker tries API rate limiting bypass
**Steps:**
1. Make 1000 API requests in 1 minute
2. After limit (e.g., 100/min), requests return 429 Too Many Requests
3. Hacker cannot DoS the API

**Expected:** Rate limiting prevents API abuse

---

#### Test 163: Hacker tries to manipulate timestamps
**Steps:**
1. Change your local device time
2. Make request with fake timestamp
3. Server validates: timestamp too old/new
4. Request rejected

**Expected:** Timestamp validation prevents replay attacks

---

#### Test 164: Hacker tries to read admin-only settings
**Steps:**
1. Client user tries: `/api/admin/settings`
2. 403 Forbidden (admin only)
3. Cannot read Stripe keys, integration secrets

**Expected:** Admin settings access controlled

---

#### Test 165: Hacker tries environment variable injection
**Steps:**
1. In form input, try: `${process.env.STRIPE_SECRET_KEY}`
2. Input sanitized, treated as literal text
3. Secret key not revealed

**Expected:** Environment variables protected

---

#### Test 166: Hacker tries to guess API keys
**Steps:**
1. Try random API key in authorization header
2. Request fails: 401 Unauthorized
3. Rate limited after few attempts

**Expected:** Invalid tokens rejected quickly

---

#### Test 167: Hacker tries to poison cache
**Steps:**
1. Make request that populates cache
2. Try to inject malicious cache data
3. Cache key validation prevents injection
4. Only legitimate data in cache

**Expected:** Cache poisoning prevented

---

#### Test 168: Hacker monitors outgoing requests
**Steps:**
1. Intercepts HTTPS request (man-in-the-middle attempt)
2. SSL/TLS prevents decryption
3. Cannot see request/response data

**Expected:** HTTPS encryption protects data in transit

---

#### Test 169: Hacker tries to exploit dependency vulnerability
**Steps:**
1. (Hypothetically) Old version of dependency with known CVE
2. Dependency is updated to patched version
3. Vulnerability no longer exploitable

**Expected:** Dependencies kept current, vulnerabilities patched

---

#### Test 170: Hacker logs in as another user
**Steps:**
1. Use another user's email + your password
2. Login fails
3. Cannot impersonate other users

**Expected:** Authentication per user, not by email alone

---

## 💰 PERSONA: POTENTIAL CLIENT (Pricing & Objection Handling)

### Tests 171-185: Pricing, Upsell, Retention

#### Test 171: Prospect compares plans side-by-side
**Steps:**
1. Go to /pricing
2. Click "Compare Plans"
3. Table shows: Maintain vs Scale vs Tune vs Launch vs Hourly
4. Rows: features, price, support level
5. Can toggle: monthly vs annual pricing

**Expected:** Plan comparison clear, pricing transparent

---

#### Test 172: Prospect sees savings for annual billing
**Steps:**
1. Default: monthly billing ($2,999/mo for Maintain)
2. Click "Annual billing"
3. Shows annual price: $32,988/yr (instead of $35,988)
4. Badge: "Save 8%"

**Expected:** Annual discount incentivizes commitment

---

#### Test 173: Prospect asks about custom plan
**Steps:**
1. Plans page has: "Need something custom?"
2. Link to contact sales
3. Email sent to sales team
4. Sales follows up within 24 hours

**Expected:** Sales process easy for custom needs

---

#### Test 174: Client requests plan upgrade
**Steps:**
1. Current: Hourly plan
2. Usage growing, wants "Maintain" plan
3. Click "Upgrade" on billing page
4. Prorated charges calculated: remaining month charged difference only
5. New plan effective immediately

**Expected:** Mid-month upgrades prorated fairly

---

#### Test 175: Client receives upgrade recommendations
**Steps:**
1. Client on Hourly plan using 40 hrs/month
2. Dashboard shows: "Maintain plan would save you 30%"
3. Click to see ROI
4. Email sent monthly: "Upgrade opportunity"

**Expected:** Upselling happens at right moments

---

#### Test 176: Prospect downloads ROI calculator
**Steps:**
1. On /pricing page, see "ROI Calculator"
2. Enter: current spend, team size, timeline
3. Calculator shows: potential savings with Tahi
4. Can download PDF report

**Expected:** Self-service ROI analysis builds confidence

---

#### Test 177: Prospect schedules consultation
**Steps:**
1. Questions about whether plan fits
2. Click "Schedule Consultation" on pricing page
3. Calendar shows available slots
4. Pick time, get confirmation
5. Sales rep reviews account 30 min before call

**Expected:** Sales process polished, consultants prepared

---

#### Test 178: Client at risk receives retention message
**Steps:**
1. Client requests churn reason (thinking of leaving)
2. Automated message: "We'd love to understand why. Can we help?"
3. Options: pricing, feature gap, support issues
4. Sales rep follows up same day

**Expected:** Churn risk detected and addressed proactively

---

#### Test 179: Loyal client receives loyalty discount
**Steps:**
1. Client has been on Maintain plan 1 year
2. Discount code sent: "10% annual loyalty discount"
3. Applies to renewal
4. Recognizes long-term partnership

**Expected:** Loyalty rewarded, retention incentivized

---

#### Test 180: Client cancels subscription process
**Steps:**
1. Clicks "Cancel Subscription" on billing
2. Form: "Tell us why?"
3. Options: too expensive, not using, found alternative, etc.
4. If price issue: "Would 10% discount change your mind?"
5. Can save at last moment or confirm cancellation

**Expected:** Cancellation process respectful, last-chance save attempted

---

#### Test 181: Prospect sees social proof
**Steps:**
1. On /pricing page, see client testimonials
2. "★★★★★ 4.8/5 from 150+ reviews"
3. Quote: "Tahi delivered on time and saved us 30 hours/month"
4. Case study links to full customer story

**Expected:** Social proof builds trust, drives conversions

---

#### Test 182: Prospect uses referral code
**Steps:**
1. Current client refers friend
2. Friend uses referral code at signup
3. Both get: $200 credit or 1 month free
4. Tracked in system

**Expected:** Referral program incentivizes growth

---

#### Test 183: Client receives feature announcement
**Steps:**
1. New feature launches (e.g., Xero integration)
2. Client gets email: "New: Xero sync now available!"
3. Email highlights benefit: "Auto-sync invoices, save 5 hours/month"
4. Can enable in settings

**Expected:** Feature announcements targeted and benefit-driven

---

#### Test 184: Prospect watches onboarding video
**Steps:**
1. On landing page, see video: "Tahi in 2 minutes"
2. Play video
3. Shows: dashboard walkthrough, request submission, collaboration
4. Professional production, clear value prop

**Expected:** Video content high-quality, engaging

---

#### Test 185: Prospect reads customer success stories
**Steps:**
1. Click /case-studies
2. See 5+ case studies: company name, industry, challenge, results
3. Example: "Acme Corp cut project turnaround by 40%"
4. Read full story with metrics, testimonial
5. Can download PDF

**Expected:** Case studies detailed, metrics-driven, downloadable

---

## 🚨 PERSONA: ADMIN (Operational & Integration Tests)

### Tests 186-200: Admin Operations, Integrations, Compliance

#### Test 186: Admin creates new client
**Steps:**
1. /dashboard/clients → "New Client"
2. Form: name, contact name, email, phone, website, industry, plan
3. Fill all fields
4. Submit
5. New client created, welcome email sent

**Expected:** Client creation smooth, welcome email immediate

---

#### Test 187: Admin views client health score
**Steps:**
1. Client list, see health column
2. Each client: Excellent/Good/Fair/Poor (color-coded)
3. Calculated from: response satisfaction, payment history, request satisfaction
4. Click to see breakdown

**Expected:** Health score visual indicator, drillable

---

#### Test 188: Admin exports client list
**Steps:**
1. /dashboard/clients
2. Click "Export CSV"
3. Select: all clients or filtered clients
4. CSV downloads with: name, contact, email, plan, health score, revenue

**Expected:** CSV export format correct, all data included

---

#### Test 189: Admin bulk imports clients
**Steps:**
1. /dashboard/clients → "Bulk Import"
2. Upload CSV with: name, contact name, email, plan
3. System validates rows
4. Confirms: 50 clients will be created
5. Creates all, generates report

**Expected:** Bulk import from external sources possible

---

#### Test 190: Admin sets up Slack integration
**Steps:**
1. /dashboard/settings → Integrations
2. Click "Slack"
3. OAuth: authorize dashboard to post to Slack workspace
4. Select channel: #tahi-alerts
5. Test notification sent
6. Connected!

**Expected:** OAuth flow completes, notifications verify connection

---

#### Test 191: Admin enables Stripe integration
**Steps:**
1. /dashboard/settings → Stripe
2. "Connect Stripe Account"
3. OAuth: authorize with Stripe
4. Dashboard can now process payments
5. Test: create invoice, see in Stripe dashboard

**Expected:** Stripe OAuth works, payments route through

---

#### Test 192: Admin enables Xero integration (NEW)
**Steps:**
1. /dashboard/settings → Xero
2. Click "Connect Xero"
3. OAuth: authorize dashboard
4. Select Xero organization/tenant
5. Dashboard syncs invoices to Xero

**Expected:** Xero OAuth flow complete (will implement)

---

#### Test 193: Admin creates Slack notification rule
**Steps:**
1. /dashboard/settings → Automations
2. New rule: "When request submitted, post to Slack"
3. Rule created
4. Test: submit request
5. Slack message appears in #tahi-alerts

**Expected:** Automation triggers, Slack notification fires

---

#### Test 194: Admin exports invoices for accounting
**Steps:**
1. /dashboard/invoices
2. Filter: date range (this month)
3. Click "Export for Accounting"
4. Excel file: invoice number, amount, client, date, payment status
5. Download for accountant

**Expected:** Accounting export format correct

---

#### Test 195: Admin generates tax report
**Steps:**
1. /dashboard/reports → Tax Report
2. Date range: 2025 tax year
3. Report shows: gross revenue, expenses, taxable income
4. Separable by client or service type

**Expected:** Tax reporting data available (for accountant use)

---

#### Test 196: Admin creates team member
**Steps:**
1. /dashboard/team → "Add Team Member"
2. Form: name, email, role (Designer/Developer/Content/PM), skills
3. Submit
4. Invitation email sent
5. Team member signs up, joins team

**Expected:** Team member onboarding smooth

---

#### Test 197: Admin sets access scoping
**Steps:**
1. Team member: Sarah (Designer)
2. /dashboard/settings → Access Scoping
3. Set: "Design requests only" + "Maintain & Scale plans only"
4. Sarah can only see Design requests from those plans

**Expected:** Access scoping restricts visibility

---

#### Test 198: Admin creates webhook
**Steps:**
1. /dashboard/settings → Webhooks
2. New webhook: trigger "request.submitted", URL "https://external-system.com/webhook"
3. Save
4. Test: submit request
5. Webhook POST sent to external system

**Expected:** Outgoing webhooks functional

---

#### Test 199: Admin views audit log
**Steps:**
1. /dashboard/settings → Audit Log
2. See events: "Client created", "Invoice sent", "Team member added", timestamps, who did it
3. Filter by type or date range
4. Immutable record for compliance

**Expected:** Audit log comprehensive, immutable

---

#### Test 200: Admin exports audit log for compliance
**Steps:**
1. Audit Log view
2. Click "Export"
3. CSV/PDF download with all events, dates, actors
4. Can provide to auditors/compliance team

**Expected:** Audit export available for regulatory compliance

---

## 📊 Summary: Test Suite Complete

**Total Tests: 200**
- Potential Client (Prospect → Paid → Engaged): Tests 1-100 (50 prospect, 50 client)
- Team Member: Tests 101-150 (50)
- Hacker/Security: Tests 151-170 (20)
- Potential Client (Pricing/Upsell): Tests 171-185 (15)
- Admin (Operations/Integration): Tests 186-200 (15)

**Usage:**
1. Pick a persona and workflow
2. Ask Claude: "Run test suite for [Persona], tests [X]-[Y]"
3. Claude will navigate dashboard and execute each step visually
4. Report pass/fail + screenshots for each test

**Format for requests:**
- "Run potential client flow, tests 1-20 (discovery & landing)"
- "Run team member workflow, tests 101-125 (assignment & collaboration)"
- "Run security tests 151-170 (hacker attempts)"

