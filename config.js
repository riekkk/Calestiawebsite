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
   Shared portal constants — used by client-portal.html (uploads) and by
   employee-portal.html/admin-portal.html (review) so they all stay in
   lockstep. Keys match the CHECK constraints in supabase/portal-schema.sql
   exactly.
   ========================================================================== */
window.CALESTIA_DOCUMENT_TYPES = [
  { key: 'passport', label: 'Passport', category: 'identity', description: 'Self-signed passport bio page. Include your old passport too if your last Japan visa is in it.' },
  { key: 'birth_certificate', label: 'Birth Certificate', category: 'identity', description: 'PSA-issued within the last year. Not required if you have a previous Japan visa.' },
  { key: 'marriage_certificate', label: 'Marriage Certificate', category: 'identity', description: 'PSA-issued within the last year, if applicable.' },
  { key: 'bank_certificate', label: 'Bank Certificate', category: 'financial', description: 'Must show your Average Daily Balance (ADB) for the last 6 months.' },
  { key: 'certificate_of_employment', label: 'Certificate of Employment (COE)', category: 'financial', description: 'Must indicate employment period, salary, and position.' },
  { key: 'visa_application_form', label: 'Visa Application Form', category: 'application_form', description: 'Must be typed and signed. Download the blank form from Forms & Checklist.' },
  { key: 'business_documents', label: 'Business Documents', category: 'supporting', description: 'DTI/SEC registration, Mayor’s Permit, and ITR — for business owners.' },
  { key: 'student_documents', label: 'Student Documents', category: 'supporting', description: 'School ID and Certificate of Enrollment — for students.' },
  { key: 'additional_documents', label: 'Additional Documents', category: 'additional', description: 'Anything else requested by Calestia or the Embassy.' }
];

/* ==========================================================================
   Document categories — group the 9 document types above into the 5
   sections shown in the "Add Documents" upload dialog on the client
   portal's My Documents page. Keys match the `category` CHECK constraint
   added by supabase/add-document-categories.sql exactly.
   ========================================================================== */
window.CALESTIA_DOCUMENT_CATEGORIES = [
  { key: 'identity', label: 'Identity & Civil Documents', shortLabel: 'Identity', description: 'Passport, Birth Certificate, Marriage Certificate.' },
  { key: 'financial', label: 'Financial Documents', shortLabel: 'Financial', description: 'Bank Certificate, Certificate of Employment (COE).' },
  { key: 'application_form', label: 'Application Forms', shortLabel: 'Application Form', description: 'The Visa Application Form.' },
  { key: 'supporting', label: 'Supporting Documents', shortLabel: 'Supporting', description: 'Business Documents, Student Documents.' },
  { key: 'additional', label: 'Additional Documents', shortLabel: 'Additional', description: 'Anything else requested by Calestia or the Embassy.' }
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

/* ==========================================================================
   Forms & Checklist — same PDFs/copy as forms-checklist.html (assets/forms/),
   rendered as an in-portal tab by client-portal.js so clients don't have to
   leave the portal shell to grab a form.
   ========================================================================== */
window.CALESTIA_FORMS = [
  {
    title: 'Visa Application Form',
    description: 'The official Japan visa application form. Must be typed, not handwritten.',
    file: 'assets/forms/visa-application-form.pdf',
    icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6M9 9h1"/>'
  },
  {
    title: 'Itinerary Form',
    description: 'List your entry/departure dates and accommodation details in Japan.',
    file: 'assets/forms/itinerary-form.pdf',
    icon: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4M8 15h3"/>'
  },
  {
    title: 'Multiple Entry Request Form',
    description: "Required only if you're applying for a multiple-entry visa.",
    file: 'assets/forms/multiple-entry-request-form.pdf',
    icon: '<path d="M6 12 3.3 3.1A59.8 59.8 0 0 1 21.5 12 59.8 59.8 0 0 1 3.3 20.9L6 12Zm0 0h7.5"/>'
  },
  {
    title: 'Full Requirements Checklist',
    description: 'The complete tourism visa checklist — every document you may need, with detailed remarks.',
    file: 'assets/forms/full-requirements-checklist.pdf',
    icon: '<path d="M9 12.75 11.25 15 15 9.75m-3-7.04A11.96 11.96 0 0 1 3.6 6 12 12 0 0 0 3 9.75c0 5.6 3.8 10.3 9 11.62 5.2-1.33 9-6.02 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15c-3.2 0-6.1-1.25-8.25-3.29Z"/>'
  },
  {
    title: 'Authorization Letter',
    description: 'Authorize a representative to file your application or claim your passport on your behalf.',
    file: 'assets/forms/authorization-letter.pdf',
    icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
  },
  {
    title: 'Japan Visa Guidelines',
    description: 'Key rules on timelines, form formatting, and paper size before you submit.',
    file: 'assets/forms/japan-visa-guidelines.pdf',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2 2-2 3.5M12 17h.01"/>'
  },
  {
    title: 'Guarantee Letter',
    description: 'For applicants whose travel expenses are shouldered by a guarantor in the Philippines.',
    file: 'assets/forms/guarantee-letter.pdf',
    icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'
  }
];

/* ==========================================================================
   Visa Assistance — "Apply a Visa" flow (Client Portal). Pricing is a plain
   editable constant on purpose: change it here, nothing else needs to know.
   ========================================================================== */
window.CALESTIA_VISA_TYPES = [
  'Japan Tourist Visa (Single Entry)',
  'Japan Tourist Visa (Multiple Entry)',
  'Japan Business Visa',
  'Japan Visiting Relatives',
  'Japan Visiting Friends',
  'Others'
];

window.CALESTIA_VISA_PRICING = {
  standard: 2700,
  premium: 7200
};

window.CALESTIA_SERVICE_TIERS = [
  {
    id: 'standard',
    label: 'Standard',
    price: 2700,
    description: 'Standard visa assistance — document review, submission, and status updates.'
  },
  {
    id: 'premium',
    label: 'Premium',
    price: 7200,
    description: 'Priority handling — dedicated specialist, expedited review, and 24/7 support.',
    badge: 'Recommended'
  }
];

window.CALESTIA_PAYMENT_METHODS = [
  {
    key: 'gcash',
    label: 'GCash',
    description: 'Send payment via GCash, then upload your receipt below.',
    accountName: 'PR***E KI*R W** V.',
    accountNumber: '0960 304 1887'
  },
  {
    key: 'maya',
    label: 'Maya',
    description: 'Send payment via Maya, then upload your receipt below.',
    accountName: 'Richard Valenzuela',
    accountNumber: '0991 150 9724'
  },
  {
    key: 'bank',
    label: 'Bank Transfer (GoTyme)',
    description: 'Transfer directly to our GoTyme bank account.',
    accountName: 'Prince Kier Win Valenzuela',
    accountNumber: '0107 4487 8867'
  }
];

/* ==========================================================================
   Dashboard "Tour Packages" destination tiles — Japan-focused (Calestia is a
   Japan visa specialist). Every tile opens the external tour-packages.html
   in a new tab, same as Browse Tours / My Bookings — there's no per-tile
   routing.
   ========================================================================== */
window.CALESTIA_DASHBOARD_DESTINATIONS = [
  { name: 'Tokyo', image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=300&h=200&fit=crop&auto=format' },
  { name: 'Osaka', image: 'https://images.unsplash.com/photo-1590559899731-a382839e5549?w=300&h=200&fit=crop&auto=format' },
  { name: 'Kyoto', image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=300&h=200&fit=crop&auto=format' },
  { name: 'Hokkaido', image: 'https://images.unsplash.com/photo-1548813831-808ce3b93c65?w=300&h=200&fit=crop&auto=format' }
];

/* ==========================================================================
   Client Portal "Contact Support" — same details already published on the
   public site's Contact section (index.html). Facebook is left unset
   (null) on purpose: no Facebook Page URL exists anywhere in this repo, and
   the Contact modal skips rendering a row for any field that's null rather
   than link to a guessed/placeholder address.
   ========================================================================== */
window.CALESTIA_SUPPORT_CONTACT = {
  email: 'calestia.assistance@gmail.com',
  phone: '+63 960 304 1887',
  facebookUrl: null
};

/* ==========================================================================
   Role → portal file map. Used after sign-in / password reset to land each
   account on the right portal, and by each portal's own gate to bounce a
   signed-in visitor of the wrong role to where they actually belong.
   ========================================================================== */
window.CALESTIA_ROLE_PORTAL_URLS = {
  client: 'client-portal.html',
  employee: 'employee-portal.html',
  admin: 'admin-portal.html'
};

/* ==========================================================================
   EmailJS — used ONLY by the public contact form (see script.js). Employee
   invitations no longer use EmailJS at all — they go through Supabase
   Auth's own invite email (auth.admin.inviteUserByEmail), sent by the
   invite-employee Edge Function. Customize that email's subject/body in
   your Supabase Dashboard → Authentication → Email Templates → "Invite
   user", not here.
   ========================================================================== */
window.CALESTIA_EMAILJS_PUBLIC_KEY = 'Bp_1nflmnjqr7recy';
window.CALESTIA_EMAILJS_SERVICE_ID = 'service_y33oto9';
