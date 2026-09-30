/** The launch service catalog. Seeded once; edit it afterwards in Setup. */
export const CATALOG = [
  { id: 'hs-workflow', name: 'Workflow build or fix', platform: 'HubSpot', category: 'Automation', credits: 3, estHours: 4, slaHours: 16, description: 'Create a new workflow or repair one that is misfiring.', qa: ['Tested with a sample record end to end', 'Enrollment triggers and suppression lists confirmed', 'Naming convention followed', 'Change logged and walkthrough recorded'] },
  { id: 'hs-property', name: 'Property or form update', platform: 'HubSpot', category: 'Data and fields', credits: 1, estHours: 1, slaHours: 8, description: 'Add or edit properties, dropdown options, or form fields.', qa: ['Internal name and field type correct', 'Added to the right forms and views', 'Change logged'] },
  { id: 'hs-pipeline', name: 'Pipeline build', platform: 'HubSpot', category: 'Sales process', credits: 5, estHours: 8, slaHours: 24, description: 'Design and build a deal or ticket pipeline with stages and required fields.', qa: ['Stages match the agreed process', 'Required properties per stage set', 'Test deal moved through every stage', 'Walkthrough recorded'] },
  { id: 'hs-report', name: 'Report or dashboard', platform: 'HubSpot', category: 'Reporting', credits: 2, estHours: 3, slaHours: 16, description: 'Build a report or dashboard your team will use weekly.', qa: ['Numbers spot-checked against records', 'Filters and date ranges documented', 'Shared with the right teams'] },
  { id: 'hs-import', name: 'Data import or cleanup', platform: 'HubSpot', category: 'Data and fields', credits: 4, estHours: 6, slaHours: 24, description: 'Import a list or clean duplicates and bad data.', qa: ['Backup export taken before changes', 'Sample of 20 records verified', 'Duplicate count before and after logged'] },
  { id: 'sf-flow', name: 'Flow automation', platform: 'Salesforce', category: 'Automation', credits: 4, estHours: 6, slaHours: 24, description: 'Build or fix a Salesforce Flow.', qa: ['Built and tested in a sandbox first', 'Fault paths handled', 'Deployed and activated', 'Change logged'] },
  { id: 'sf-report', name: 'Report or dashboard', platform: 'Salesforce', category: 'Reporting', credits: 2, estHours: 3, slaHours: 16, description: 'Build a Salesforce report or dashboard.', qa: ['Numbers spot-checked', 'Folder sharing set', 'Running user confirmed'] },
  { id: 'sf-admin', name: 'User and permission admin', platform: 'Salesforce', category: 'Admin', credits: 1, estHours: 1, slaHours: 8, description: 'Add users, adjust profiles or permission sets.', qa: ['Least-privilege access confirmed', 'User can log in and see the right records'] },
  { id: 'mn-board', name: 'Board and automation build', platform: 'Monday', category: 'Automation', credits: 3, estHours: 4, slaHours: 16, description: 'Set up a Monday.com board with columns and automations.', qa: ['Automations tested', 'Permissions set', 'Walkthrough recorded'] },
  { id: 'any-training', name: 'Team training session', platform: 'Any', category: 'Enablement', credits: 2, estHours: 2, slaHours: 24, description: 'A recorded 45-minute training for your team on any part of your CRM.', qa: ['Recording shared', 'Follow-up notes sent'] },
  { id: 'any-custom', name: 'Custom scope', platform: 'Any', category: 'Custom work', credits: 0, estHours: 0, slaHours: 40, description: 'Anything not listed. Your team scopes it and confirms credits before work starts.', qa: ['Scope confirmed by the client in writing', 'Deliverables match the scope', 'Walkthrough recorded'] },
];

/** Built-in service behind support tickets. Hidden from the catalog; never charges credits. */
export const SUPPORT_SKU_ROW = {
  id: 'support', name: 'Support ticket', platform: 'Any', category: 'Support', credits: 0, estHours: 1, slaHours: 16,
  description: 'Help with something that is broken, confusing, or blocking your team. No credits.', qa: [] as string[],
};

