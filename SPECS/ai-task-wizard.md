# AI Task Creation Wizard

## What It Is

A conversational AI assistant that helps clients (and admins) create well-structured tasks by asking progressive questions. Instead of filling out a form, the user describes what they need and the AI figures out the right task structure, categorization, track assignment, and details.

## User Flow

### Client Portal
1. Client clicks "AI Help" button (sparkle icon) next to "New Request" button
2. Chat-style interface opens in a slide-over panel
3. AI asks: "What do you need help with?"
4. Client describes their need in natural language
5. AI asks follow-up questions based on the category it detects:
   - For design: "Do you have brand guidelines?" "What's the deliverable format?"
   - For development: "Is this a new feature or a fix?" "What page/section?"
   - For content: "What tone?" "Target audience?" "Word count?"
6. AI generates one or more task cards with:
   - Title, description, category, type (small/large track)
   - Estimated effort
   - Suggested priority
   - File upload prompts if relevant
7. Client reviews, edits if needed, then confirms
8. Tasks are created and placed in the right track queue

### Admin
1. Admin clicks "AI Create" in tasks or requests page
2. Same conversational flow but with additional options:
   - Assign to team member
   - Set as internal task
   - Create across multiple clients
   - Set dependencies

## Technical Architecture

### Frontend
- `components/tahi/ai-task-wizard.tsx` - Main wizard component
- Chat-style UI with message bubbles
- Uses streaming for AI responses
- Shows task preview cards as AI generates them
- Edit-in-place on generated task cards before confirming

### API Route
- `POST /api/admin/ai/task-wizard` - Handles conversation turns
- Accepts: `{ messages: Message[], context: { orgId?, clientId?, trackType? } }`
- Returns: `{ reply: string, tasks?: TaskDraft[], followUpQuestions?: string[] }`
- Uses Claude API (Anthropic SDK) for conversation
- System prompt includes:
  - Tahi service categories and descriptions
  - Track types and what fits in each
  - Common request patterns from docs
  - Client's plan type and available tracks

### Task Draft Shape
```ts
interface TaskDraft {
  title: string
  description: string
  category: string // design, development, content, seo, strategy
  type: 'small' | 'large'
  estimatedHours?: number
  priority: 'low' | 'medium' | 'high' | 'urgent'
  suggestedTrack?: string // which track to place in
  attachmentPrompts?: string[] // "Please upload your logo" etc
}
```

## Conversation Flow Examples

### Example 1: Simple design request
```
User: "I need my homepage hero updated"
AI: "I can help with that! A few questions:
     1. What changes do you want? (new copy, new image, layout change?)
     2. Do you have the new content/assets ready?
     3. Is there a specific deadline?"
User: "New hero image and headline. I have the image. Need it by Friday."
AI: [Generates task card]
    Title: "Update homepage hero - new image and headline"
    Category: Design
    Track: Small
    Priority: Medium
    Description: "Replace homepage hero section with new image (provided by client) and updated headline copy. Client has assets ready."
    Due: [This Friday]

    "Does this look right? I can adjust anything before creating it."
```

### Example 2: Multi-task project
```
User: "We're launching a new product line and need landing pages, email templates, and social graphics"
AI: "That's a bigger project! Let me break it down. For the landing pages:
     1. How many pages do you need?
     2. Do you have the copy written?"
User: "3 pages, copy is ready for 2 of them"
AI: [Generates 4 task cards]
    1. "Landing page - Product A" (Large track, copy ready)
    2. "Landing page - Product B" (Large track, copy ready)
    3. "Landing page - Product C" (Large track, needs copywriting)
    4. "Email templates - product launch series" (Small track)
    5. "Social media graphics pack" (Small track)

    "I've split this into 5 tasks across your tracks. Note: tasks 1-3 are large track items and will need to be queued. Want me to adjust anything?"
```

## Done Criteria
- Conversational flow works end-to-end
- AI correctly categorizes and sizes tasks
- Generated tasks include all required fields
- Client can edit before confirming
- Tasks land in correct track queue
- Works for both admin and portal users
- Mobile-friendly (slide-over panel)
- Streaming responses for perceived speed
