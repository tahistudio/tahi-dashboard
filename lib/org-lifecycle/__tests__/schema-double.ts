/**
 * The schema double both lifecycle test files mount over `@/db/d1`.
 *
 * Every table the merge or the delete touches, with the columns each of them
 * reads. Column names are the DRIZZLE PROPERTY names (see fake-db.ts for why).
 * The SQL names are pinned against db/schema.ts in policy.test.ts, so this
 * double never becomes the only description of the schema.
 */

import { fakeTable } from './fake-db'

const ORG = ['orgId']

export const schemaDouble = {
  organisations: fakeTable('organisations', [
    'name', 'status', 'website', 'industry', 'accentColour', 'planType', 'internalNotes',
    'xeroContactId', 'stripeCustomerId', 'manyrequestsId', 'clerkOrgId', 'updatedAt',
  ]),
  contacts: fakeTable('contacts', ['orgId', 'name', 'email', 'clerkUserId', 'updatedAt']),
  onboardingInvites: fakeTable('onboarding_invites', ORG),
  projects: fakeTable('projects', ORG),
  subscriptions: fakeTable('subscriptions', ['orgId', 'billedContactId']),
  requests: fakeTable('requests', ['orgId', 'requestNumber', 'submittedById', 'submittedByType']),
  activeTimers: fakeTable('active_timers', ORG),
  conversations: fakeTable('conversations', ['orgId', 'type']),
  conversationParticipants: fakeTable('conversation_participants', ['conversationId', 'participantId', 'participantType']),
  messages: fakeTable('messages', ['orgId', 'conversationId', 'authorId', 'authorType']),
  files: fakeTable('files', ['orgId', 'uploadedById', 'uploadedByType']),
  invoices: fakeTable('invoices', [
    'orgId', 'number', 'status', 'totalUsd', 'currency', 'createdAt',
    'stripeInvoiceId', 'xeroInvoiceId', 'paidAt',
  ]),
  timeEntries: fakeTable('time_entries', ORG),
  tasks: fakeTable('tasks', ['orgId', 'assigneeId', 'assigneeType']),
  taskTemplates: fakeTable('task_templates', ORG),
  clientCosts: fakeTable('client_costs', ORG),
  caseStudySubmissions: fakeTable('case_study_submissions', ORG),
  caseStudies: fakeTable('case_studies', ORG),
  emailSuppressions: fakeTable('email_suppressions', ORG),
  teamMemberAccessOrgs: fakeTable('team_member_access_orgs', ['orgId', 'accessId']),
  requestForms: fakeTable('request_forms', ORG),
  kanbanColumns: fakeTable('kanban_columns', ORG),
  contracts: fakeTable('contracts', ORG),
  discoveryCalls: fakeTable('discovery_calls', ORG),
  scheduledCalls: fakeTable('scheduled_calls', ORG),
  services: fakeTable('services', ORG),
  deals: fakeTable('deals', ORG),
  activities: fakeTable('activities', ['orgId', 'contactId']),
  brands: fakeTable('brands', ORG),
  projectSchedules: fakeTable('project_schedules', ORG),
  proposals: fakeTable('proposals', ORG),
  contractDocuments: fakeTable('contract_documents', ORG),
  projectCalculations: fakeTable('project_calculations', ORG),

  requestParticipants: fakeTable('request_participants', ['requestId', 'participantId', 'participantType', 'addedById', 'addedByType']),
  requestReads: fakeTable('request_reads', ['requestId', 'userId', 'userType']),
  requestSteps: fakeTable('request_steps', ['requestId', 'createdById', 'createdByType']),
  taskSubtasks: fakeTable('task_subtasks', ['taskId']),
  messageReactions: fakeTable('message_reactions', ['messageId']),
  voiceNotes: fakeTable('voice_notes', ['messageId']),
  invoiceItems: fakeTable('invoice_items', ['invoiceId']),
  tracks: fakeTable('tracks', ['subscriptionId']),
  brandContacts: fakeTable('brand_contacts', ['brandId', 'contactId']),
  dealContacts: fakeTable('deal_contacts', ['contactId']),
  mentions: fakeTable('mentions', ['mentionedId', 'mentionedType']),
  notifications: fakeTable('notifications', ['userId', 'userType']),
  notificationPreferences: fakeTable('notification_preferences', ['userId', 'userType']),
  featureVisibility: fakeTable('feature_visibility', ['subjectType', 'subjectId']),
  leads: fakeTable('leads', ['promotedDealId']),
}
