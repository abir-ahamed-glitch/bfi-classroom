/**
 * Authoritative Permission Catalog for BFI Classroom Administrator Management
 */

export const PERMISSION_MODULES = [
  {
    id: 'courses',
    name: 'Course Maker',
    description: 'Course definitions, curriculum, routines, and syllabus publication',
    permissions: [
      { id: 'courses:view', name: 'View Courses', description: 'Browse course catalog, view definitions and routine schedules', isView: true },
      { id: 'courses:create', name: 'Create Course Drafts', description: 'Create new 1-5 phase course definition drafts', dependsOn: 'courses:view' },
      { id: 'courses:edit', name: 'Edit Courses & Routines', description: 'Modify draft definitions and edit weekly routine schedules', dependsOn: 'courses:view' },
      { id: 'courses:publish', name: 'Publish Courses', description: 'Publish drafts into immutable course versions', dependsOn: 'courses:view' },
      { id: 'courses:delete', name: 'Delete Course Drafts', description: 'Delete unpublished course drafts', dependsOn: 'courses:view' },
    ]
  },
  {
    id: 'batches',
    name: 'Batches',
    description: 'Cohort management, batch schedules, fees, and results',
    permissions: [
      { id: 'batches:view', name: 'View Batches', description: 'View batch lists, student enrollments, and routines', isView: true },
      { id: 'batches:create', name: 'Create Batches', description: 'Create new cohorts linked to course definitions', dependsOn: 'batches:view' },
      { id: 'batches:edit', name: 'Edit Batches', description: 'Modify batch details, schedule dates, and routine overrides', dependsOn: 'batches:view' },
      { id: 'batches:delete', name: 'Delete Batches', description: 'Send batches to Trash', dependsOn: 'batches:view' },
      { id: 'batches:results_upload', name: 'Upload Results', description: 'Bulk upload phase results and marks', dependsOn: 'batches:view' },
    ]
  },
  {
    id: 'students',
    name: 'Student Records',
    description: 'Student admissions, leads, academic progress, and student directory',
    permissions: [
      { id: 'students:view', name: 'View Students', description: 'Search and inspect student lists, profiles, and leads', isView: true },
      { id: 'students:create', name: 'Admit & Register Students', description: 'Create new student accounts or admit leads', dependsOn: 'students:view' },
      { id: 'students:edit', name: 'Edit Student Details', description: 'Update profile information and enrollment status', dependsOn: 'students:view' },
      { id: 'students:academic_records', name: 'Manage Academic Records', description: 'Update attendance, marks, and manual grading', dependsOn: 'students:view' },
      { id: 'students:delete', name: 'Delete Students', description: 'Soft-delete student accounts to Trash', dependsOn: 'students:view' },
      { id: 'students:export', name: 'Export Student Data', description: 'Download CSV and Excel student rosters', dependsOn: 'students:view' },
    ]
  },
  {
    id: 'teachers',
    name: 'Instructors & Teachers',
    description: 'Instructor profiles, course assignments, and teacher directory',
    permissions: [
      { id: 'teachers:view', name: 'View Instructors', description: 'View instructor roster and assigned batches', isView: true },
      { id: 'teachers:create', name: 'Create Instructors', description: 'Add new instructor accounts to the platform', dependsOn: 'teachers:view' },
      { id: 'teachers:edit', name: 'Edit Instructors', description: 'Update instructor profiles and subject assignments', dependsOn: 'teachers:view' },
      { id: 'teachers:delete', name: 'Delete Instructors', description: 'Soft-delete instructor accounts to Trash', dependsOn: 'teachers:view' },
    ]
  },
  {
    id: 'notices',
    name: 'Notices & Announcements',
    description: 'Institution-wide notices and targeted announcement publishing',
    permissions: [
      { id: 'notices:view', name: 'View Notices', description: 'Browse public and targeted announcements', isView: true },
      { id: 'notices:create', name: 'Post Notices', description: 'Create and publish new announcements', dependsOn: 'notices:view' },
      { id: 'notices:delete', name: 'Delete Notices', description: 'Remove announcements and notices', dependsOn: 'notices:view' },
    ]
  },
  {
    id: 'communications',
    name: 'Communications & Broadcasts',
    description: 'Direct messaging broadcasts, scheduled SMS, and recipient groups',
    permissions: [
      { id: 'communications:view', name: 'View Broadcasts & SMS', description: 'Inspect broadcast logs and scheduled SMS queues', isView: true },
      { id: 'communications:send', name: 'Send Broadcasts & SMS', description: 'Dispatch bulk messages and immediate SMS to students', dependsOn: 'communications:view' },
      { id: 'communications:schedule', name: 'Schedule SMS & Broadcasts', description: 'Queue automated notifications and reminder SMS', dependsOn: 'communications:view' },
      { id: 'communications:delete', name: 'Cancel & Delete Messages', description: 'Delete broadcast records and cancel queued SMS', dependsOn: 'communications:view' },
    ]
  },
  {
    id: 'finance',
    name: 'Finance & Fee Tracker',
    description: 'Tuition balances, payment logs, discounts, and fee structures',
    permissions: [
      { id: 'finance:view', name: 'View Fee Records', description: 'Inspect student balances, dues, and payment tracking', isView: true },
      { id: 'finance:edit', name: 'Manage Fees & Discounts', description: 'Update course fees, record payments, and grant fee waivers', dependsOn: 'finance:view' },
    ]
  },
  {
    id: 'reports',
    name: 'Reports & Analytics',
    description: 'Enrollment statistics, completion rates, platform metrics, and community moderation',
    permissions: [
      { id: 'reports:view', name: 'View Reports & Analytics', description: 'View administrative charts, KPIs, and demographic summaries', isView: true },
      { id: 'reports:moderate', name: 'Moderate User Reports', description: 'Review, resolve, or dismiss submitted user moderation reports', dependsOn: 'reports:view' },
      { id: 'reports:export', name: 'Export Analytics', description: 'Download analytics exports and audit reports', dependsOn: 'reports:view' },
    ]
  },
  {
    id: 'trash',
    name: 'Trash Management',
    description: 'Soft-deleted records recovery and permanent purge controls',
    permissions: [
      { id: 'trash:view', name: 'View Trash', description: 'Inspect soft-deleted records across all entities', isView: true },
      { id: 'trash:restore', name: 'Restore Deleted Items', description: 'Recover soft-deleted items back to active state', dependsOn: 'trash:view' },
      { id: 'trash:delete_permanent', name: 'Permanently Purge Items', description: 'Irreversibly delete trashed items from database', dependsOn: 'trash:view' },
    ]
  },
  {
    id: 'settings',
    name: 'System Settings & Custom Subjects',
    description: 'Global course fees defaults, custom subject lists, and configs',
    permissions: [
      { id: 'settings:view', name: 'View Settings', description: 'Inspect custom subjects and system parameters', isView: true },
      { id: 'settings:edit', name: 'Modify System Settings', description: 'Add/reorder custom subjects and update platform defaults', dependsOn: 'settings:view' },
    ]
  }
];

export const ALL_PERMISSIONS = PERMISSION_MODULES.flatMap(m => m.permissions.map(p => p.id));

export const PERMISSION_DEPENDENCY_MAP = PERMISSION_MODULES.reduce((acc, m) => {
  m.permissions.forEach(p => {
    if (p.dependsOn) {
      acc[p.id] = p.dependsOn;
    }
  });
  return acc;
}, {});
