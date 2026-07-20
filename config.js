/* ==========================================================================
   Calestia Travel & Tours — Supabase configuration
   ==========================================================================
   This is the same Supabase project used by the original Next.js site
   (lib/supabaseClient.ts). The anon/publishable key below is safe to expose
   in client-side code by design — it identifies the project, it does not
   grant access. Actual data access is enforced by Supabase Row Level
   Security (RLS) policies on the project itself, the same way a Stripe
   "publishable" key works. Never put a service_role/secret key here.
   ========================================================================== */
window.CALESTIA_SUPABASE_URL = 'https://bhhmlxjrklrjkqxoumfk.supabase.co';
window.CALESTIA_SUPABASE_ANON_KEY = 'sb_publishable_tSAwI-7s5WNHyLBU4bTihA_j8qFxxwC';

/* ==========================================================================
   Shared portal constants — used by both client-portal.html (uploads) and
   staff-portal.html (review) so the two stay in lockstep. Keys match the
   CHECK constraints in supabase/portal-schema.sql exactly.
   ========================================================================== */
window.CALESTIA_DOCUMENT_TYPES = [
  { key: 'passport', label: 'Passport', description: 'Self-signed passport bio page. Include your old passport too if your last Japan visa is in it.' },
  { key: 'visa_application_form', label: 'Visa Application Form', description: 'Must be typed and signed. Download the blank form from Forms & Checklist.' },
  { key: 'birth_certificate', label: 'Birth Certificate', description: 'PSA-issued within the last year. Not required if you have a previous Japan visa.' },
  { key: 'marriage_certificate', label: 'Marriage Certificate', description: 'PSA-issued within the last year, if applicable.' },
  { key: 'bank_certificate', label: 'Bank Certificate', description: 'Must show your Average Daily Balance (ADB) for the last 6 months.' },
  { key: 'certificate_of_employment', label: 'Certificate of Employment (COE)', description: 'Must indicate employment period, salary, and position.' },
  { key: 'business_documents', label: 'Business Documents', description: 'DTI/SEC registration, Mayor’s Permit, and ITR — for business owners.' },
  { key: 'student_documents', label: 'Student Documents', description: 'School ID and Certificate of Enrollment — for students.' },
  { key: 'additional_documents', label: 'Additional Documents', description: 'Anything else requested by Calestia or the Embassy.' }
];

window.CALESTIA_APPLICATION_STATUSES = [
  { key: 'documents_incomplete', label: 'Documents Incomplete' },
  { key: 'documents_under_review', label: 'Documents Under Review' },
  { key: 'ready_for_submission', label: 'Ready for Submission' },
  { key: 'submitted_to_jvac', label: 'Submitted to JVAC' },
  { key: 'under_embassy_review', label: 'Under Embassy Review' },
  { key: 'additional_documents_requested', label: 'Additional Documents Requested' },
  { key: 'visa_approved', label: 'Visa Approved' },
  { key: 'visa_denied', label: 'Visa Denied' },
  { key: 'passport_ready_for_pickup', label: 'Passport Ready for Pickup' },
  { key: 'completed', label: 'Completed' }
];

window.CALESTIA_DOCUMENT_STATUSES = [
  { key: 'pending', label: 'Not Reviewed Yet' },
  { key: 'under_review', label: 'Under Review' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'reupload_requested', label: 'Re-upload Requested' }
];
