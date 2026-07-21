/* ==========================================================================
   Calestia Travel & Tours — client-portal.js
   ==========================================================================
   Self-contained controller for client-portal.html. Creates its own
   Supabase client (mirrors the pattern already used by staff-portal.js /
   accept-invite.js — script.js's supabaseClient is closure-local to its own
   IIFE and isn't reachable from here). Not loaded anywhere except
   client-portal.html.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window.supabase === 'undefined' || !window.CALESTIA_SUPABASE_URL) {
    document.getElementById('psGate').textContent = 'Portal is not connected yet. Check config.js.';
    return;
  }

  var supabaseClient = window.supabase.createClient(window.CALESTIA_SUPABASE_URL, window.CALESTIA_SUPABASE_ANON_KEY);

  var ALLOWED_DOC_MIME = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  var MAX_DOC_BYTES = 10 * 1024 * 1024;
  var DOCUMENTS_BUCKET = 'client-documents';

  var session = null;
  var profile = null;
  var documentsByType = {};
  var notificationRows = [];
  var uploadDocType = null;
  var reviewSelectedRating = 0;
  var ownReview = null;

  var PAGE_META = {
    dashboard: ['Dashboard', 'Welcome back'],
    visa: ['Visa Assistance', 'Apply for a visa and track your application'],
    documents: ['My Documents', 'Upload and manage your visa documents'],
    forms: ['Forms & Checklist', 'Download official forms and requirements'],
    notifications: ['Notifications', 'Updates on your application and documents'],
    reviews: ['Client Reviews', 'See what other clients say about us'],
    profile: ['My Profile', 'Manage your personal information']
  };

  /* Apply-a-Visa modal state */
  var AV_EMPTY_APPLICANT = { first_name: '', last_name: '', gender: '', date_of_birth: '', nationality: '', passport_number: '', passport_expiry: '', travel_date: '', visa_type: '', service_tier: 'standard' };
  var avApplicants = [];
  var avStep = 'form';
  var avEditingId = null;
  var avFormData = null;
  var avSelectedPaymentMethod = null;
  var avReceiptFile = null;
  var avLastSubmission = null;

  /* My Documents access gating — resolved once per portal load, refreshed on
     relevant realtime changes and via the locked page's "Refresh Status" button. */
  var documentsAccessState = null;
  var DOCS_LOCK_MESSAGES = {
    no_application: { title: 'Apply for a visa first', desc: "Document uploads unlock once you've submitted a visa application.", cta: 'Apply for a Visa' },
    no_payment: { title: 'Complete your payment', desc: 'Your application is saved. Submit your payment to unlock document uploads.', cta: 'Complete Payment' },
    awaiting_verification: { title: 'Payment under review', desc: 'Our team is verifying your payment. This usually takes 1–2 business hours. Documents will unlock automatically once verified.', cta: null },
    payment_rejected: { title: 'Payment could not be verified', desc: 'Please contact our team or re-submit your payment.', cta: 'Re-submit Payment' }
  };

  /* Modal a11y state (focus trap / return focus), shared by every ps-modal on this page */
  var modalReturnFocusEl = null;
  var modalKeydownHandler = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    wireShell();
    wireModals();

    supabaseClient.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') window.location.href = 'index.html';
    });

    supabaseClient.auth.getSession().then(function (result) {
      session = result.data && result.data.session;
      if (!session) { window.location.href = 'index.html'; return; }
      gateByRole();
    });
  }

  function gateByRole() {
    supabaseClient.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(function (result) {
        profile = result.data;
        if (!profile) { window.location.href = 'index.html'; return; }
        if (profile.role !== 'client') {
          var urls = window.CALESTIA_ROLE_PORTAL_URLS || {};
          window.location.href = urls[profile.role] || 'index.html';
          return;
        }
        showPortal();
      })
      .catch(function () { window.location.href = 'index.html'; });
  }

  function showPortal() {
    document.getElementById('psGate').classList.add('is-hidden');
    document.getElementById('psShell').classList.remove('is-hidden');

    var name = profile.full_name || profile.email || 'traveler';
    var initial = name.charAt(0).toUpperCase();
    document.getElementById('psUserName').textContent = name;
    document.getElementById('psUserEmail').textContent = profile.email || '';
    document.getElementById('psUserAvatar').textContent = initial;
    document.getElementById('psBannerName').textContent = name.split(' ')[0];
    document.getElementById('psProfileAvatar').textContent = initial;
    document.getElementById('psProfileName').textContent = name;

    loadDashboard();
    loadVisaPanel();
    loadDocumentsAccessState();
    loadForms();
    loadNotifications();
    loadReviews();
    loadProfile();
    subscribeRealtime();
  }

  /* ==================================================================
     Shell: nav switching, mobile drawer, bell, sign out
     ================================================================== */
  function wireShell() {
    // Only nav items with a data-panel are in-portal tabs. "Tour Packages"
    // is a plain external link (target="_blank") — it must NOT run
    // goToPanel(null), which would blank out whichever panel is currently
    // showing in this tab while the new tab opens.
    var navItems = document.querySelectorAll('#psNav .ps-nav-item[data-panel]');
    navItems.forEach(function (btn) {
      btn.addEventListener('click', function () { handleNavigateToPanel(btn.getAttribute('data-panel')); });
    });
    document.querySelectorAll('[data-goto-panel]').forEach(function (btn) {
      btn.addEventListener('click', function () { handleNavigateToPanel(btn.getAttribute('data-goto-panel')); });
    });

    var menuBtn = document.getElementById('psMenuBtn');
    var closeBtn = document.getElementById('psSidebarClose');
    var backdrop = document.getElementById('psSidebarBackdrop');
    var shell = document.getElementById('psShell');
    if (menuBtn) menuBtn.addEventListener('click', function () { shell.classList.add('ps-sidebar-open'); });
    if (closeBtn) closeBtn.addEventListener('click', function () { shell.classList.remove('ps-sidebar-open'); });
    if (backdrop) backdrop.addEventListener('click', function () { shell.classList.remove('ps-sidebar-open'); });

    var bellBtn = document.getElementById('psBellBtn');
    var bellPanel = document.getElementById('psBellPanel');
    if (bellBtn && bellPanel) {
      bellBtn.addEventListener('click', function () {
        var opening = bellPanel.classList.contains('is-hidden');
        bellPanel.classList.toggle('is-hidden');
        bellBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
        if (opening) markNotificationsRead();
      });
      document.addEventListener('click', function (e) {
        if (!bellPanel.classList.contains('is-hidden') && !bellPanel.contains(e.target) && e.target !== bellBtn && !bellBtn.contains(e.target)) {
          bellPanel.classList.add('is-hidden');
          bellBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    document.getElementById('psSignoutBtn').addEventListener('click', function () {
      supabaseClient.auth.signOut().then(function () { window.location.href = 'index.html'; });
    });

    document.getElementById('psMarkAllReadBtn').addEventListener('click', function () {
      supabaseClient.from('notifications').update({ is_read: true }).eq('client_id', session.user.id).eq('is_read', false)
        .then(function () { showToast('All notifications marked as read.'); loadNotifications(); })
        .catch(function () { showToast('Could not update notifications.', true); });
    });
  }

  function goToPanel(panel) {
    document.querySelectorAll('#psNav .ps-nav-item').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-panel') === panel);
    });
    document.querySelectorAll('.ps-panel').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-panel') === panel);
    });
    var meta = PAGE_META[panel];
    if (meta) {
      document.getElementById('psPageTitle').textContent = meta[0];
      document.getElementById('psPageSubtitle').textContent = meta[1];
    }
    document.getElementById('psShell').classList.remove('ps-sidebar-open');
  }

  function handleNavigateToPanel(panel) {
    if (panel === 'documents' && documentsAccessState && !documentsAccessState.allowed) {
      showDocumentsLockedTooltip(documentsAccessState.reason);
      return;
    }
    goToPanel(panel);
  }

  function showDocumentsLockedTooltip(reason) {
    var info = DOCS_LOCK_MESSAGES[reason] || DOCS_LOCK_MESSAGES.no_application;
    showToast(info.title + ' — ' + info.desc, true);
  }

  function wireModals() {
    document.querySelectorAll('[data-close-modal]').forEach(function (el) {
      el.addEventListener('click', function () { closeModal(el.getAttribute('data-close-modal')); });
    });

    var dropzone = document.getElementById('uploadDropzone');
    var fileInput = document.getElementById('uploadFileInput');
    var confirmBtn = document.getElementById('uploadConfirmBtn');
    var selectedName = document.getElementById('uploadSelectedFileName');
    var selectedFile = null;

    dropzone.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      selectedFile = fileInput.files && fileInput.files[0];
      selectedName.textContent = selectedFile ? selectedFile.name : '';
      confirmBtn.disabled = !selectedFile;
    });
    confirmBtn.addEventListener('click', function () {
      if (selectedFile && uploadDocType) handleDocumentUpload(uploadDocType, selectedFile);
    });

    document.getElementById('psWriteReviewBtn').addEventListener('click', openReviewModal);
    document.getElementById('reviewSubmitBtn').addEventListener('click', submitReview);

    function resetUploadModal() { selectedFile = null; fileInput.value = ''; selectedName.textContent = ''; confirmBtn.disabled = true; confirmBtn.textContent = 'Upload'; }
    window.addEventListener('ps:modal-closed:uploadModal', resetUploadModal);

    document.getElementById('psApplyVisaBtn').addEventListener('click', function () { openApplyVisaModal(); });
    document.getElementById('dashApplyVisaBtn').addEventListener('click', function () { openApplyVisaModal(); });
    window.addEventListener('ps:modal-closed:applyVisaModal', resetApplyVisaModal);
  }

  function openModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modalReturnFocusEl = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    var focusable = modal.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
    if (focusable.length) focusable[0].focus();

    modalKeydownHandler = function (e) {
      if (e.key === 'Escape') { closeModal(id); return; }
      if (e.key !== 'Tab') return;
      var items = modal.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', modalKeydownHandler);
  }
  function closeModal(id) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (modalKeydownHandler) { document.removeEventListener('keydown', modalKeydownHandler); modalKeydownHandler = null; }
    if (modalReturnFocusEl && typeof modalReturnFocusEl.focus === 'function') modalReturnFocusEl.focus();
    modalReturnFocusEl = null;
    window.dispatchEvent(new CustomEvent('ps:modal-closed:' + id));
  }

  /* ==================================================================
     Dashboard
     ================================================================== */
  function loadDashboard() {
    supabaseClient.from('applications').select('*').eq('client_id', session.user.id).maybeSingle()
      .then(function (result) { renderTimeline(result.data || null); })
      .catch(function () { renderTimeline(null); });
  }

  function renderTimeline(app) {
    document.getElementById('psTimeline').innerHTML = buildTimelineHTML(app);

    var statuses = window.CALESTIA_APPLICATION_STATUSES || [];
    if (!app) {
      document.getElementById('psBannerStatus').textContent = '—';
      document.getElementById('statDaysInProcess').textContent = '—';
      return;
    }
    document.getElementById('psBannerStatus').textContent = statusLabel(statuses, app.status);
    var days = app.created_at ? Math.max(0, Math.floor((Date.now() - new Date(app.created_at).getTime()) / 86400000)) : 0;
    document.getElementById('statDaysInProcess').textContent = String(days);
  }

  function buildTimelineHTML(app) {
    var statuses = window.CALESTIA_APPLICATION_STATUSES || [];
    if (!app) return '<p class="ps-hint">Your application will appear here once Calestia sets it up.</p>';

    var isDenied = app.status === 'visa_denied';
    var visible = isDenied
      ? statuses.filter(function (s) { return s.key !== 'visa_approved' && s.key !== 'passport_ready_for_pickup' && s.key !== 'completed'; })
      : statuses;
    var currentIndex = visible.map(function (s) { return s.key; }).indexOf(app.status);

    var html = '<div class="ps-timeline-rail"></div>';
    visible.forEach(function (s, i) {
      var isDone = i < currentIndex;
      var isActive = i === currentIndex;
      var itemClass = 'ps-timeline-item' + (isDone ? ' is-done' : '') + (isActive ? ' is-active' : '');
      var dotClass = 'ps-timeline-dot' + (isDone ? ' is-done' : '') + (isActive ? ' is-active' : '');
      var dotInner = isDone ? window.PSIcon('check-circle', 15) : '<span style="width:8px;height:8px;border-radius:50%;background:' + (isActive ? 'var(--navy)' : '#c7d3e0') + ';"></span>';
      html += '<div class="' + itemClass + '"><div class="' + dotClass + '">' + dotInner + '</div>' +
        '<div><p class="ps-tl-label">' + escapeHTML(s.label) + '</p>' +
        (isDone ? '<p class="ps-tl-sub">Completed</p>' : isActive ? '<p class="ps-tl-sub">' + (isDenied ? 'Denied' : 'In Progress') + '</p>' : '') +
        '</div></div>';
    });
    return html;
  }

  function statusLabel(list, key) {
    var found = list.filter(function (s) { return s.key === key; })[0];
    return found ? found.label : key;
  }

  function renderRecentActivity() {
    var el = document.getElementById('psRecentActivity');
    if (!notificationRows.length) { el.innerHTML = '<p class="ps-hint">No recent activity yet.</p>'; return; }
    el.innerHTML = notificationRows.slice(0, 5).map(function (n) {
      var when = n.created_at ? timeAgo(n.created_at) : '';
      return '<div style="display:flex;gap:8px;padding:7px 0;align-items:flex-start;">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:var(--navy);margin-top:6px;flex-shrink:0;"></span>' +
        '<div><p style="font-size:0.78rem;color:var(--navy-dk);line-height:1.4;">' + escapeHTML(n.message) + '</p>' +
        '<p class="ps-hint" style="font-size:0.7rem;">' + when + '</p></div></div>';
    }).join('');
  }

  function timeAgo(iso) {
    var diff = Date.now() - new Date(iso).getTime();
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    var days = Math.floor(hrs / 24);
    if (days < 7) return days + 'd ago';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /* ==================================================================
     Visa Assistance — applicants list + Apply-a-Visa modal
     ================================================================== */
  function loadVisaPanel() {
    supabaseClient.from('applications').select('*').eq('client_id', session.user.id).maybeSingle()
      .then(function (result) { document.getElementById('psVisaTimeline').innerHTML = buildTimelineHTML(result.data || null); })
      .catch(function () { document.getElementById('psVisaTimeline').innerHTML = '<p class="ps-hint">Your application will appear here once Calestia sets it up.</p>'; });

    loadApplyVisaApplicants().then(renderApplicantsList);
  }

  function loadApplyVisaApplicants() {
    return supabaseClient.from('visa_applicants').select('*').eq('client_id', session.user.id).order('created_at', { ascending: true })
      .then(function (result) { avApplicants = result.error ? [] : (result.data || []); })
      .catch(function () { avApplicants = []; });
  }

  function renderApplicantsList() {
    var el = document.getElementById('psApplicantsList');
    if (!el) return;
    if (!avApplicants.length) {
      el.innerHTML = '<div class="ps-empty" style="padding:20px 10px;">' +
        '<div class="ps-empty-icon">' + window.PSIcon('user-plus', 24) + '</div>' +
        '<h3>No applicants yet</h3>' +
        '<p>Click "Apply a Visa" to add your first traveler and start your application.</p>' +
        '</div>';
      return;
    }
    el.innerHTML = avApplicants.map(function (a, i) { return applicantCardHTML(a, i, 'panel'); }).join('');
    el.querySelectorAll('[data-applicant-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () { openApplyVisaModal(btn.getAttribute('data-applicant-edit')); });
    });
    el.querySelectorAll('[data-applicant-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () { deleteApplicant(btn.getAttribute('data-applicant-delete')); });
    });
  }

  function tierBadgeHTML(tier) {
    var isPremium = tier === 'premium';
    var tierDef = (window.CALESTIA_SERVICE_TIERS || []).filter(function (t) { return t.id === tier; })[0];
    var label = tierDef ? tierDef.label : (isPremium ? 'Premium' : 'Standard');
    return '<span class="ps-badge" style="margin-left:8px;' + (isPremium ? 'background:#FEF3C7;color:#D97706;' : 'background:#EAF0F6;color:#3B5583;') + '">' + escapeHTML(label) + '</span>';
  }

  function applicantCardHTML(a, i, mode) {
    var editAttr = mode === 'modal' ? 'data-av-edit' : 'data-applicant-edit';
    var deleteAttr = mode === 'modal' ? 'data-av-delete' : 'data-applicant-delete';
    var travelDateStr = a.travel_date ? new Date(a.travel_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '—';
    return '<div class="ps-applicant-card">' +
      '<div class="ps-applicant-card-top">' +
      '<div><h4>Applicant ' + (i + 1) + '</h4><strong>' + escapeHTML(((a.first_name || '').toUpperCase() + ' ' + (a.last_name || '').toUpperCase()).trim() || 'Unnamed') + '</strong>' + tierBadgeHTML(a.service_tier || 'standard') + '</div>' +
      '<div style="display:flex;gap:6px;flex-shrink:0;">' +
      '<button type="button" class="ps-btn ps-btn-outline ps-btn-sm" ' + editAttr + '="' + a.id + '">' + window.PSIcon('edit', 13) + ' Edit</button>' +
      '<button type="button" class="ps-btn ps-btn-danger ps-btn-sm" ' + deleteAttr + '="' + a.id + '">' + window.PSIcon('trash', 13) + ' Delete</button>' +
      '</div></div>' +
      '<div class="ps-applicant-card-grid">' +
      '<div><span>Visa Type</span><strong>' + escapeHTML(a.visa_type || '—') + '</strong></div>' +
      '<div><span>Passport Number</span><strong>' + (a.passport_number ? '••••••••' : '—') + '</strong></div>' +
      '<div><span>Travel Date</span><strong>' + travelDateStr + '</strong></div>' +
      '</div></div>';
  }

  function deleteApplicant(id) {
    supabaseClient.from('visa_applicants').delete().eq('id', id).eq('client_id', session.user.id)
      .then(function (result) {
        if (result.error) { showToast(result.error.message || 'Could not remove applicant.', true); return; }
        showToast('Applicant removed.');
        loadVisaPanel();
      })
      .catch(function () { showToast('Something went wrong.', true); });
  }

  function emptyApplicant() { return Object.assign({}, AV_EMPTY_APPLICANT); }

  function applicantRowToFormData(row) {
    return {
      first_name: row.first_name || '', last_name: row.last_name || '', gender: row.gender || '',
      date_of_birth: row.date_of_birth || '', nationality: row.nationality || '',
      passport_number: row.passport_number || '', passport_expiry: row.passport_expiry || '',
      travel_date: row.travel_date || '', visa_type: row.visa_type || '',
      service_tier: row.service_tier || 'standard'
    };
  }

  function tierPrice(tierId) {
    var pricing = window.CALESTIA_VISA_PRICING || {};
    return pricing[tierId] || 0;
  }

  function tierBreakdown(applicants) {
    var tiers = window.CALESTIA_SERVICE_TIERS || [];
    var counts = {};
    (applicants || []).forEach(function (a) {
      var t = a.service_tier || 'standard';
      counts[t] = (counts[t] || 0) + 1;
    });
    return tiers.filter(function (t) { return counts[t.id] > 0; }).map(function (t) {
      var count = counts[t.id];
      var price = tierPrice(t.id);
      return { id: t.id, label: t.label, count: count, price: price, subtotal: count * price };
    });
  }

  function visaTotalFor(applicants) {
    return tierBreakdown(applicants).reduce(function (sum, b) { return sum + b.subtotal; }, 0);
  }

  function openApplyVisaModal(editId) {
    avSelectedPaymentMethod = null;
    avReceiptFile = null;
    loadApplyVisaApplicants().then(function () {
      if (editId) {
        var found = avApplicants.filter(function (a) { return a.id === editId; })[0];
        avEditingId = editId;
        avFormData = found ? applicantRowToFormData(found) : emptyApplicant();
        avStep = 'form';
      } else if (avApplicants.length) {
        avEditingId = null;
        avFormData = emptyApplicant();
        avStep = 'summary';
      } else {
        avEditingId = null;
        avFormData = emptyApplicant();
        avStep = 'form';
      }
      renderApplyVisaModal();
      openModal('applyVisaModal');
    });
  }

  function resetApplyVisaModal() {
    avStep = 'form';
    avEditingId = null;
    avFormData = emptyApplicant();
    avSelectedPaymentMethod = null;
    avReceiptFile = null;
    avLastSubmission = null;
  }

  function avEditApplicant(id) {
    var found = avApplicants.filter(function (a) { return a.id === id; })[0];
    avEditingId = id;
    avFormData = found ? applicantRowToFormData(found) : emptyApplicant();
    avStep = 'form';
    renderApplyVisaModal();
  }

  function avDeleteApplicantInModal(id) {
    supabaseClient.from('visa_applicants').delete().eq('id', id).eq('client_id', session.user.id)
      .then(function (result) {
        if (result.error) { showToast(result.error.message || 'Could not remove applicant.', true); return; }
        return loadApplyVisaApplicants();
      })
      .then(function () {
        renderApplyVisaModal();
        renderApplicantsList();
      })
      .catch(function () { showToast('Something went wrong.', true); });
  }

  function readApplicantFormFields() {
    var keys = ['first_name', 'last_name', 'gender', 'date_of_birth', 'nationality', 'passport_number', 'passport_expiry', 'travel_date', 'visa_type'];
    var data = {};
    keys.forEach(function (k) {
      var el = document.getElementById('avField_' + k);
      data[k] = el ? el.value.trim() : '';
    });
    ['date_of_birth', 'passport_expiry', 'travel_date'].forEach(function (k) { if (!data[k]) data[k] = null; });
    return data;
  }

  function handleApplicantSave() {
    var data = readApplicantFormFields();
    data.service_tier = (avFormData && avFormData.service_tier) || 'standard';
    if (!data.first_name || !data.last_name || !data.passport_number || !data.travel_date || !data.visa_type) {
      showToast('Please fill in first name, last name, passport number, travel date, and visa type.', true);
      return;
    }
    var btn = document.getElementById('avSaveApplicantBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    var op = avEditingId
      ? supabaseClient.from('visa_applicants').update(data).eq('id', avEditingId).eq('client_id', session.user.id)
      : supabaseClient.from('visa_applicants').insert(Object.assign({ client_id: session.user.id }, data));

    op.then(function (result) {
      if (result.error) throw result.error;
      avEditingId = null;
      avStep = 'summary';
      return loadApplyVisaApplicants();
    }).then(function () {
      renderApplyVisaModal();
      renderApplicantsList();
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save & Continue'; }
      showToast((err && err.message) || 'Could not save applicant.', true);
    });
  }

  function handlePaymentSubmit() {
    if (!avSelectedPaymentMethod || !avReceiptFile) return;
    var btn = document.getElementById('avSubmitPaymentBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

    var clientId = session.user.id;
    var total = visaTotalFor(avApplicants);
    var path = clientId + '/' + Date.now() + '-' + avReceiptFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');

    supabaseClient.storage.from('payment-receipts').upload(path, avReceiptFile, { upsert: false })
      .then(function (uploadResult) {
        if (uploadResult.error) throw uploadResult.error;
        return supabaseClient.from('payment_submissions').insert({
          client_id: clientId,
          method: avSelectedPaymentMethod,
          applicant_count: avApplicants.length || 1,
          amount: total,
          receipt_path: path,
          receipt_file_name: avReceiptFile.name
        }).select().maybeSingle();
      })
      .then(function (result) {
        if (result.error) throw result.error;
        avLastSubmission = { amount: total, applicantCount: avApplicants.length || 1, method: avSelectedPaymentMethod };
        avStep = 'confirmation';
        renderApplyVisaModal();
        loadVisaPanel();
        loadDocumentsAccessState();
      })
      .catch(function (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Submit Payment'; }
        showToast((err && err.message) || 'Could not submit payment. Please try again.', true);
      });
  }

  /* -- Apply-a-Visa modal: step rendering -- */

  var AV_STEPS = [
    { key: 'form', label: 'Applicant Details' },
    { key: 'summary', label: 'Your Details' },
    { key: 'payment', label: 'Payment' },
    { key: 'confirmation', label: 'Confirmation' }
  ];

  function avStepperHTML() {
    var currentIdx = AV_STEPS.map(function (s) { return s.key; }).indexOf(avStep);
    var display = AV_STEPS.slice(1);
    var html = '<div class="ps-stepper">';
    display.forEach(function (s, i) {
      var idx = i + 1;
      var done = currentIdx > idx;
      var active = currentIdx === idx;
      html += '<div class="ps-stepper-step">' +
        '<div class="ps-stepper-dot' + (done ? ' is-done' : '') + (active ? ' is-active' : '') + '">' + (done ? '✓' : idx) + '</div>' +
        '<span class="ps-stepper-label' + (active || done ? ' is-current' : '') + '">' + escapeHTML(s.label) + '</span>' +
        '</div>';
      if (i < display.length - 1) html += '<div class="ps-stepper-line' + (done ? ' is-done' : '') + '"></div>';
    });
    html += '</div>';
    return html;
  }

  function avTierSelectorHTML(selectedTier) {
    var tiers = window.CALESTIA_SERVICE_TIERS || [];
    var cardsHTML = tiers.map(function (t) {
      var active = selectedTier === t.id;
      return '<button type="button" class="ps-payment-method' + (active ? ' is-active' : '') + '" data-tier-select="' + t.id + '" style="position:relative;">' +
        (t.badge ? '<span class="ps-badge ps-badge-amber" style="position:absolute;top:12px;right:12px;">' + escapeHTML(t.badge) + '</span>' : '') +
        '<div class="ps-payment-method-title">' + escapeHTML(t.label) + '</div>' +
        '<div style="font-size:0.95rem;font-weight:700;color:var(--navy-dk);margin:4px 0;">₱' + t.price.toLocaleString() + ' <span style="font-size:0.7rem;font-weight:500;color:var(--ps-text-dim);">/ applicant</span></div>' +
        '<div class="ps-payment-method-desc">' + escapeHTML(t.description) + '</div>' +
        '</button>';
    }).join('');
    return '<div style="margin-bottom:18px;">' +
      '<label style="display:block;font-size:0.7rem;font-weight:700;color:var(--ps-text-dim);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px;">Service Tier *</label>' +
      '<div class="ps-payment-methods" style="grid-template-columns:repeat(2,1fr);">' + cardsHTML + '</div>' +
      '</div>';
  }

  function avFormStepHTML() {
    var data = avFormData || emptyApplicant();
    var fields = [
      { key: 'first_name', label: 'First Name', type: 'text' },
      { key: 'last_name', label: 'Last Name', type: 'text' },
      { key: 'gender', label: 'Gender', options: ['Male', 'Female', 'Other'] },
      { key: 'date_of_birth', label: 'Date of Birth', type: 'date' },
      { key: 'nationality', label: 'Current Nationality', type: 'text' },
      { key: 'passport_number', label: 'Passport Number', type: 'text' },
      { key: 'passport_expiry', label: 'Passport Expiry Date', type: 'date' },
      { key: 'travel_date', label: 'Travel Date', type: 'date' },
      { key: 'visa_type', label: 'Type of Visa', options: window.CALESTIA_VISA_TYPES, full: true }
    ];
    var applicantNumber = avEditingId
      ? (avApplicants.map(function (a) { return a.id; }).indexOf(avEditingId) + 1) || (avApplicants.length + 1)
      : (avApplicants.length + 1);

    var fieldsHTML = fields.map(function (f) {
      var val = data[f.key] || '';
      var input = f.options
        ? '<select id="avField_' + f.key + '"><option value="">Select ' + escapeHTML(f.label) + '</option>' +
          f.options.map(function (o) { return '<option value="' + escapeHTML(o) + '"' + (o === val ? ' selected' : '') + '>' + escapeHTML(o) + '</option>'; }).join('') +
          '</select>'
        : '<input type="' + f.type + '" id="avField_' + f.key + '" value="' + escapeHTML(val) + '" />';
      return '<div class="form-group"' + (f.full ? ' style="grid-column:1/-1;"' : '') + '><label>' + escapeHTML(f.label) + ' *</label>' + input + '</div>';
    }).join('');

    return (
      avTierSelectorHTML(data.service_tier || 'standard') +
      '<div style="margin-bottom:18px;padding:14px 16px;border-radius:14px;background:#fff7ed;border:1px solid #fed7aa;display:flex;gap:10px;">' +
      window.PSIcon('alert-circle', 18, 'style="color:#d97706;flex-shrink:0;margin-top:1px;"') +
      '<div><strong style="display:block;font-size:0.8rem;font-weight:700;color:#92400e;margin-bottom:2px;">IMPORTANT</strong>' +
      '<span style="font-size:0.78rem;color:#b45309;line-height:1.5;">Please enter the information exactly as it appears on the photo page of your passport. We may be unable to process your application if the details do not match.</span></div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">' +
      '<div class="ps-avatar ps-avatar-sm">' + applicantNumber + '</div>' +
      '<span style="font-weight:600;color:var(--navy-dk);font-size:0.86rem;">Applicant ' + applicantNumber + '</span>' +
      '</div>' +
      '<div class="ps-grid ps-grid-2">' + fieldsHTML + '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:22px;padding-top:18px;border-top:1px solid var(--ps-border);">' +
      '<button type="button" class="ps-btn ps-btn-outline" id="avCancelBtn">Cancel</button>' +
      '<button type="button" class="ps-btn ps-btn-primary" id="avSaveApplicantBtn">Save &amp; Continue</button>' +
      '</div>'
    );
  }

  function avSummaryStepHTML() {
    var cardsHTML = avApplicants.map(function (a, i) { return applicantCardHTML(a, i, 'modal'); }).join('');
    return avStepperHTML() +
      '<div style="display:flex;flex-direction:column;gap:12px;margin-bottom:18px;">' + (cardsHTML || '<p class="ps-hint">No applicants added yet.</p>') + '</div>' +
      '<button type="button" class="ps-btn ps-btn-outline" id="avAddApplicantBtn" style="width:100%;justify-content:center;border-style:dashed;">' + window.PSIcon('plus', 15) + ' Add Applicant</button>' +
      '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:22px;padding-top:18px;border-top:1px solid var(--ps-border);">' +
      '<button type="button" class="ps-btn ps-btn-outline" id="avCloseBtn">Go Back</button>' +
      '<button type="button" class="ps-btn ps-btn-primary" id="avToPaymentBtn"' + (avApplicants.length ? '' : ' disabled') + '>Continue to Payment</button>' +
      '</div>';
  }

  function avPaymentStepHTML() {
    var methods = window.CALESTIA_PAYMENT_METHODS || [];
    var breakdown = tierBreakdown(avApplicants);
    var total = visaTotalFor(avApplicants);

    var methodsHTML = methods.map(function (m) {
      var active = avSelectedPaymentMethod === m.key;
      return '<button type="button" class="ps-payment-method' + (active ? ' is-active' : '') + '" data-payment-method="' + m.key + '">' +
        '<div class="ps-payment-method-title">' + escapeHTML(m.label) + '</div>' +
        '<div class="ps-payment-method-desc">' + escapeHTML(m.description) + '</div>' +
        '</button>';
    }).join('');

    var selectedMethod = methods.filter(function (m) { return m.key === avSelectedPaymentMethod; })[0];
    var detailHTML = '';
    if (selectedMethod) {
      detailHTML = '<div class="ps-payment-detail-card">' +
        '<div class="ps-payment-detail-row"><span class="ps-hint">Account Name</span><strong class="ps-payment-detail-value">' + escapeHTML(selectedMethod.accountName) + '</strong></div>' +
        '<div class="ps-payment-detail-row"><span class="ps-hint">' + (selectedMethod.key === 'bank' ? 'Account Number' : 'Mobile Number') + '</span>' +
        '<span style="display:flex;align-items:center;gap:8px;"><strong class="ps-payment-detail-value">' + escapeHTML(selectedMethod.accountNumber) + '</strong>' +
        '<button type="button" class="ps-btn ps-btn-outline ps-btn-sm" id="avCopyAccountBtn" data-copy-value="' + escapeHTML(selectedMethod.accountNumber) + '">Copy</button></span></div>' +
        '<p class="ps-hint" style="margin-top:8px;">Send exactly <strong style="color:var(--navy-dk);">₱' + total.toLocaleString() + '</strong>, then upload your receipt below.</p>' +
        '</div>';
    }

    var receiptHTML = avReceiptFile
      ? '<div class="ps-doc-file-chip" style="margin-top:12px;">' + window.PSIcon('file-text', 14) + '<span>' + escapeHTML(avReceiptFile.name) + '</span>' +
        '<button type="button" class="ps-btn ps-btn-outline ps-btn-sm" id="avRemoveReceiptBtn" style="margin-left:auto;">Remove</button></div>'
      : '<div class="ps-dropzone" id="avDropzone" style="margin-top:12px;">' +
        window.PSIcon('upload', 22) +
        '<p style="font-weight:600;color:var(--navy-dk);margin:8px 0 2px;">Click to upload your payment receipt</p>' +
        '<p class="ps-hint">PDF, JPG, JPEG, PNG · Max 10&nbsp;MB</p>' +
        '</div>' +
        '<input type="file" id="avReceiptInput" accept=".pdf,.jpg,.jpeg,.png" style="display:none;" />';

    return avStepperHTML() +
      '<h3 style="font-size:0.95rem;font-weight:700;color:var(--navy-dk);margin-bottom:4px;">Select Payment Method</h3>' +
      '<p class="ps-hint" style="margin-bottom:14px;">Choose how you\'d like to pay.</p>' +
      '<div class="ps-payment-methods">' + methodsHTML + '</div>' +
      detailHTML +
      '<div style="margin-top:20px;">' +
      '<h3 style="font-size:0.95rem;font-weight:700;color:var(--navy-dk);margin-bottom:4px;">Upload Proof of Payment</h3>' +
      '<p class="ps-hint" style="margin-bottom:8px;">Your application proceeds to review once our team verifies your payment.</p>' +
      receiptHTML +
      '</div>' +
      '<div class="ps-card ps-card-pad" style="margin-top:18px;background:var(--ps-bg);">' +
      breakdown.map(function (b) {
        return '<div style="display:flex;justify-content:space-between;font-size:0.82rem;color:var(--ps-text-dim);margin-bottom:4px;"><span>' + b.count + ' × ' + escapeHTML(b.label) + '</span><span>₱' + b.subtotal.toLocaleString() + '</span></div>';
      }).join('') +
      '<div style="display:flex;justify-content:space-between;font-size:1rem;font-weight:700;color:var(--navy-dk);padding-top:8px;margin-top:4px;border-top:1px solid var(--ps-border);"><span>Total Amount</span><span>₱' + total.toLocaleString() + '</span></div>' +
      '</div>' +
      '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:22px;padding-top:18px;border-top:1px solid var(--ps-border);">' +
      '<button type="button" class="ps-btn ps-btn-outline" id="avBackToSummaryBtn">Go Back</button>' +
      '<button type="button" class="ps-btn ps-btn-primary" id="avSubmitPaymentBtn"' + (avSelectedPaymentMethod && avReceiptFile ? '' : ' disabled') + '>Submit Payment</button>' +
      '</div>';
  }

  function avConfirmationStepHTML() {
    var sub = avLastSubmission || {};
    return '<div style="text-align:center;padding:10px 0 4px;">' +
      '<div style="width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;background:linear-gradient(135deg, var(--navy), var(--navy-dk));color:#fff;">' + window.PSIcon('check-circle', 30) + '</div>' +
      '<h3 style="font-size:1.2rem;font-weight:700;color:var(--navy-dk);margin-bottom:8px;">Payment Submitted</h3>' +
      '<p class="ps-hint" style="max-width:380px;margin:0 auto 20px;line-height:1.6;">Thank you for choosing Calestia Travel &amp; Tours. Our team will verify your payment and you\'ll get a notification once it\'s confirmed — typically within 1–2 business hours.</p>' +
      '<div class="ps-card ps-card-pad" style="text-align:left;background:var(--ps-bg);max-width:420px;margin:0 auto 22px;">' +
      '<div class="ps-applicant-card-grid" style="grid-template-columns:repeat(2,1fr);">' +
      '<div><span>Applicants</span><strong>' + (sub.applicantCount || avApplicants.length || 1) + '</strong></div>' +
      '<div><span>Amount Submitted</span><strong>₱' + (sub.amount || 0).toLocaleString() + '</strong></div>' +
      '<div><span>Payment Method</span><strong>' + escapeHTML((sub.method || '').toUpperCase()) + '</strong></div>' +
      '<div><span>Status</span><strong style="color:#b45309;">Pending Verification</strong></div>' +
      '</div></div>' +
      '<div style="display:flex;gap:10px;justify-content:center;">' +
      '<button type="button" class="ps-btn ps-btn-outline" id="avViewApplicationBtn">View My Application</button>' +
      '<button type="button" class="ps-btn ps-btn-primary" id="avReturnDashboardBtn">Return to Dashboard</button>' +
      '</div></div>';
  }

  function renderApplyVisaModal() {
    var titleEl = document.getElementById('avModalTitle');
    var subtitleEl = document.getElementById('avModalSubtitle');
    if (avStep === 'confirmation') {
      titleEl.textContent = 'Application Submitted!';
      subtitleEl.classList.add('is-hidden');
    } else {
      titleEl.textContent = 'Apply for a Visa';
      subtitleEl.textContent = 'Complete the fields exactly as they appear on your passport.';
      subtitleEl.classList.remove('is-hidden');
    }

    var bodyHTML = '';
    if (avStep === 'form') bodyHTML = avFormStepHTML();
    else if (avStep === 'summary') bodyHTML = avSummaryStepHTML();
    else if (avStep === 'payment') bodyHTML = avPaymentStepHTML();
    else if (avStep === 'confirmation') bodyHTML = avConfirmationStepHTML();

    document.getElementById('avModalBody').innerHTML = bodyHTML;
    wireApplyVisaStepEvents();
  }

  function wireApplyVisaStepEvents() {
    var cancelBtn = document.getElementById('avCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', function () {
      if (avApplicants.length) { avStep = 'summary'; renderApplyVisaModal(); }
      else closeModal('applyVisaModal');
    });

    var saveBtn = document.getElementById('avSaveApplicantBtn');
    if (saveBtn) saveBtn.addEventListener('click', handleApplicantSave);

    document.querySelectorAll('[data-tier-select]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        // Capture whatever the client already typed before re-rendering the
        // step for the new tier selection, so their in-progress input isn't
        // wiped by the innerHTML swap.
        avFormData = Object.assign({}, avFormData, readApplicantFormFields());
        avFormData.service_tier = btn.getAttribute('data-tier-select');
        renderApplyVisaModal();
      });
    });

    var addBtn = document.getElementById('avAddApplicantBtn');
    if (addBtn) addBtn.addEventListener('click', function () {
      avEditingId = null;
      avFormData = emptyApplicant();
      avStep = 'form';
      renderApplyVisaModal();
    });

    var closeBtn = document.getElementById('avCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', function () { closeModal('applyVisaModal'); });

    var toPaymentBtn = document.getElementById('avToPaymentBtn');
    if (toPaymentBtn) toPaymentBtn.addEventListener('click', function () {
      if (!avApplicants.length) return;
      avStep = 'payment';
      renderApplyVisaModal();
    });

    var backToSummaryBtn = document.getElementById('avBackToSummaryBtn');
    if (backToSummaryBtn) backToSummaryBtn.addEventListener('click', function () { avStep = 'summary'; renderApplyVisaModal(); });

    document.querySelectorAll('[data-payment-method]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        avSelectedPaymentMethod = btn.getAttribute('data-payment-method');
        renderApplyVisaModal();
      });
    });

    var copyBtn = document.getElementById('avCopyAccountBtn');
    if (copyBtn) copyBtn.addEventListener('click', function () {
      var value = copyBtn.getAttribute('data-copy-value');
      if (navigator.clipboard) {
        navigator.clipboard.writeText(value).then(function () { showToast('Copied to clipboard.'); }).catch(function () {});
      }
    });

    var dropzone = document.getElementById('avDropzone');
    var receiptInput = document.getElementById('avReceiptInput');
    if (dropzone && receiptInput) {
      dropzone.addEventListener('click', function () { receiptInput.click(); });
      receiptInput.addEventListener('change', function () {
        var file = receiptInput.files && receiptInput.files[0];
        if (file) { avReceiptFile = file; renderApplyVisaModal(); }
      });
    }
    var removeReceiptBtn = document.getElementById('avRemoveReceiptBtn');
    if (removeReceiptBtn) removeReceiptBtn.addEventListener('click', function () { avReceiptFile = null; renderApplyVisaModal(); });

    var submitPaymentBtn = document.getElementById('avSubmitPaymentBtn');
    if (submitPaymentBtn) submitPaymentBtn.addEventListener('click', handlePaymentSubmit);

    document.querySelectorAll('[data-av-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () { avEditApplicant(btn.getAttribute('data-av-edit')); });
    });
    document.querySelectorAll('[data-av-delete]').forEach(function (btn) {
      btn.addEventListener('click', function () { avDeleteApplicantInModal(btn.getAttribute('data-av-delete')); });
    });

    var viewAppBtn = document.getElementById('avViewApplicationBtn');
    if (viewAppBtn) viewAppBtn.addEventListener('click', function () { closeModal('applyVisaModal'); });

    var returnDashBtn = document.getElementById('avReturnDashboardBtn');
    if (returnDashBtn) returnDashBtn.addEventListener('click', function () { closeModal('applyVisaModal'); goToPanel('dashboard'); });
  }

  /* ==================================================================
     Documents access gating — locked until an application has a
     staff-verified payment
     ================================================================== */
  function getDocumentsAccessState(clientId) {
    return Promise.all([
      supabaseClient.from('visa_applicants').select('id', { count: 'exact', head: true }).eq('client_id', clientId),
      supabaseClient.from('payment_submissions').select('*').eq('client_id', clientId).order('submitted_at', { ascending: false }).limit(1)
    ]).then(function (results) {
      var applicantCount = results[0].count || 0;
      var latestPayment = (results[1].data && results[1].data[0]) || null;

      if (!applicantCount) return { allowed: false, reason: 'no_application' };
      if (!latestPayment) return { allowed: false, reason: 'no_payment' };
      if (latestPayment.status === 'verified') return { allowed: true };
      if (latestPayment.status === 'rejected') return { allowed: false, reason: 'payment_rejected' };
      return { allowed: false, reason: 'awaiting_verification' };
    }).catch(function () {
      return { allowed: false, reason: 'no_application' };
    });
  }

  function loadDocumentsAccessState() {
    return getDocumentsAccessState(session.user.id).then(function (state) {
      documentsAccessState = state;
      renderDocumentsNavLockState();
      renderDocumentsPanel();
      return state;
    });
  }

  function renderDocumentsNavLockState() {
    var navBtn = document.querySelector('#psNav .ps-nav-item[data-panel="documents"]');
    if (!navBtn) return;
    var locked = documentsAccessState && !documentsAccessState.allowed;
    navBtn.classList.toggle('ps-nav-item-locked', locked);
    navBtn.setAttribute('aria-disabled', locked ? 'true' : 'false');

    var badge = document.getElementById('psNavDocsBadge');
    if (locked && badge) badge.classList.add('is-hidden');

    var lockIcon = navBtn.querySelector('.ps-nav-lock-icon');
    if (locked && !lockIcon) {
      var span = document.createElement('span');
      span.className = 'ps-nav-lock-icon';
      span.innerHTML = window.PSIcon('lock', 13);
      navBtn.appendChild(span);
    } else if (!locked && lockIcon) {
      lockIcon.remove();
    }
  }

  function renderDocumentsPanel() {
    if (!documentsAccessState) return;
    if (documentsAccessState.allowed) loadDocuments();
    else renderDocumentsLockedState(documentsAccessState.reason);
  }

  function renderDocumentsLockedState(reason) {
    var info = DOCS_LOCK_MESSAGES[reason] || DOCS_LOCK_MESSAGES.no_application;
    var grid = document.getElementById('psDocumentsGrid');
    if (!grid) return;

    var ctaHTML = info.cta ? '<button type="button" class="ps-btn ps-btn-primary" id="psDocsLockedCtaBtn">' + escapeHTML(info.cta) + '</button>' : '';

    grid.innerHTML =
      '<div class="ps-empty" style="grid-column:1/-1;">' +
      '<div class="ps-empty-icon" style="position:relative;">' + window.PSIcon('file-text', 26) +
      '<span style="position:absolute;bottom:-2px;right:-2px;width:20px;height:20px;border-radius:50%;background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;">' + window.PSIcon('lock', 11) + '</span>' +
      '</div>' +
      '<h3>' + escapeHTML(info.title) + '</h3>' +
      '<p>' + escapeHTML(info.desc) + '</p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">' +
      ctaHTML +
      '<button type="button" class="ps-btn ps-btn-outline" id="psDocsRefreshStatusBtn">Refresh Status</button>' +
      '</div>' +
      '</div>';

    var ctaBtn = document.getElementById('psDocsLockedCtaBtn');
    if (ctaBtn) ctaBtn.addEventListener('click', function () {
      if (reason === 'no_application') openApplyVisaModal();
      else openApplyVisaModalAtPayment();
    });

    var refreshBtn = document.getElementById('psDocsRefreshStatusBtn');
    refreshBtn.addEventListener('click', function () {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing…';
      loadDocumentsAccessState().then(function (state) {
        if (state.allowed) { showToast('Documents unlocked!'); return; }
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh Status';
        var stillInfo = DOCS_LOCK_MESSAGES[state.reason] || DOCS_LOCK_MESSAGES.no_application;
        showToast('Still locked — ' + stillInfo.title);
      });
    });
  }

  function openApplyVisaModalAtPayment() {
    avSelectedPaymentMethod = null;
    avReceiptFile = null;
    loadApplyVisaApplicants().then(function () {
      avEditingId = null;
      avFormData = emptyApplicant();
      avStep = avApplicants.length ? 'payment' : 'form';
      renderApplyVisaModal();
      openModal('applyVisaModal');
    });
  }

  /* ==================================================================
     Documents
     ================================================================== */
  function loadDocuments() {
    supabaseClient.from('documents').select('*').eq('client_id', session.user.id)
      .then(function (result) { renderDocuments(result.error ? [] : (result.data || [])); })
      .catch(function () { renderDocuments([]); });
  }

  var DOC_STATUS_BADGE = {
    pending: 'gray', under_review: 'blue', verified: 'green', rejected: 'red', reupload_requested: 'amber'
  };
  var DOC_STATUS_LABEL = {};
  (window.CALESTIA_DOCUMENT_STATUSES || []).forEach(function (s) { DOC_STATUS_LABEL[s.key] = s.label; });

  function renderDocuments(rows) {
    documentsByType = {};
    rows.forEach(function (d) { documentsByType[d.document_type] = d; });

    var types = window.CALESTIA_DOCUMENT_TYPES || [];
    var submitted = 0, pendingActions = 0;

    var html = types.map(function (t) {
      var doc = documentsByType[t.key];
      var hasFile = !!(doc && doc.file_path);
      if (hasFile) submitted++;
      if (doc && (doc.status === 'rejected' || doc.status === 'reupload_requested')) pendingActions++;

      var badgeColor = hasFile ? (DOC_STATUS_BADGE[doc.status] || 'gray') : 'gray';
      var badgeLabel = hasFile ? (DOC_STATUS_LABEL[doc.status] || doc.status) : 'Not Uploaded';

      var remarkHTML = '';
      if (doc && doc.remarks) {
        var negative = doc.status === 'rejected' || doc.status === 'reupload_requested';
        remarkHTML = '<div class="ps-doc-remark ' + (negative ? 'is-negative' : 'is-positive') + '">' + window.PSIcon('message-square', 13) + '<span>' + escapeHTML(doc.remarks) + '</span></div>';
      }

      var fileChip = hasFile ? '<div class="ps-doc-file-chip">' + window.PSIcon('file-text', 14) + '<span>' + escapeHTML(doc.file_name || 'file') + '</span></div>' : '';

      var actions = hasFile
        ? '<div class="ps-doc-actions">' +
            '<button type="button" class="ps-btn ps-btn-outline ps-btn-sm" data-doc-replace="' + t.key + '">Replace</button>' +
            '<button type="button" class="ps-btn ps-btn-outline ps-btn-sm" data-doc-preview="' + t.key + '">Preview</button>' +
            '<button type="button" class="ps-btn ps-btn-danger ps-btn-sm" data-doc-remove="' + t.key + '">Remove</button>' +
          '</div>'
        : '<button type="button" class="ps-btn ps-btn-primary" style="width:100%;justify-content:center;" data-doc-replace="' + t.key + '">' + window.PSIcon('upload', 14) + ' Upload File</button>';

      return '<div class="ps-doc-card">' +
        '<div class="ps-doc-card-top"><div><h4>' + escapeHTML(t.label) + '</h4><p>' + escapeHTML(t.description) + '</p></div>' +
        '<span class="ps-badge ps-badge-' + badgeColor + '">' + escapeHTML(badgeLabel) + '</span></div>' +
        fileChip + remarkHTML + actions +
        '</div>';
    }).join('');

    document.getElementById('psDocumentsGrid').innerHTML = html;
    document.getElementById('statDocsSubmitted').textContent = submitted + '/' + types.length;
    document.getElementById('statPendingActions').textContent = String(pendingActions);

    var navBadge = document.getElementById('psNavDocsBadge');
    if (pendingActions > 0) { navBadge.textContent = String(pendingActions); navBadge.classList.remove('is-hidden'); }
    else navBadge.classList.add('is-hidden');

    document.querySelectorAll('[data-doc-replace]').forEach(function (btn) {
      btn.addEventListener('click', function () { openUploadModal(btn.getAttribute('data-doc-replace')); });
    });
    document.querySelectorAll('[data-doc-preview]').forEach(function (btn) {
      btn.addEventListener('click', function () { openDocumentPreview(btn.getAttribute('data-doc-preview')); });
    });
    document.querySelectorAll('[data-doc-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () { handleDocumentRemove(btn.getAttribute('data-doc-remove')); });
    });
  }

  function openUploadModal(docType) {
    uploadDocType = docType;
    var type = (window.CALESTIA_DOCUMENT_TYPES || []).filter(function (t) { return t.key === docType; })[0];
    document.getElementById('uploadModalTitle').textContent = 'Upload — ' + (type ? type.label : docType);
    openModal('uploadModal');
  }

  function handleDocumentUpload(docType, file) {
    if (ALLOWED_DOC_MIME.indexOf(file.type) === -1) { showToast('Only PDF, JPG, JPEG, or PNG files are allowed.', true); return; }
    if (file.size > MAX_DOC_BYTES) { showToast('File is too large. Maximum size is 10 MB.', true); return; }

    var confirmBtn = document.getElementById('uploadConfirmBtn');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Uploading…';

    var clientId = session.user.id;
    var path = clientId + '/' + docType + '/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');

    supabaseClient.from('documents').select('file_path').eq('client_id', clientId).eq('document_type', docType).maybeSingle()
      .then(function (existing) {
        var oldPath = existing.data && existing.data.file_path;
        return supabaseClient.storage.from(DOCUMENTS_BUCKET).upload(path, file, { upsert: false })
          .then(function (uploadResult) {
            if (uploadResult.error) throw uploadResult.error;
            if (oldPath) supabaseClient.storage.from(DOCUMENTS_BUCKET).remove([oldPath]).catch(function () {});
            return supabaseClient.from('documents').upsert({
              client_id: clientId, document_type: docType, file_path: path, file_name: file.name,
              file_size: file.size, mime_type: file.type, uploaded_at: new Date().toISOString(), status: 'pending'
            }, { onConflict: 'client_id,document_type' });
          });
      })
      .then(function (upsertResult) {
        if (upsertResult && upsertResult.error) throw upsertResult.error;
        showToast(file.name + ' uploaded successfully.');
        closeModal('uploadModal');
        loadDocuments();
      })
      .catch(function (err) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Upload';
        showToast((err && err.message) || 'Upload failed. Please try again.', true);
      });
  }

  function handleDocumentRemove(docType) {
    var clientId = session.user.id;
    supabaseClient.from('documents').select('file_path').eq('client_id', clientId).eq('document_type', docType).maybeSingle()
      .then(function (existing) {
        var oldPath = existing.data && existing.data.file_path;
        var removeStorage = oldPath ? supabaseClient.storage.from(DOCUMENTS_BUCKET).remove([oldPath]) : Promise.resolve();
        return removeStorage.then(function () {
          return supabaseClient.from('documents').update({
            file_path: null, file_name: null, file_size: null, mime_type: null, uploaded_at: null, status: 'pending'
          }).eq('client_id', clientId).eq('document_type', docType);
        });
      })
      .then(function (result) {
        if (result && result.error) throw result.error;
        showToast('File removed.');
        loadDocuments();
      })
      .catch(function (err) { showToast((err && err.message) || 'Could not remove file.', true); });
  }

  function openDocumentPreview(docType) {
    var clientId = session.user.id;
    supabaseClient.from('documents').select('file_path').eq('client_id', clientId).eq('document_type', docType).maybeSingle()
      .then(function (result) {
        var path = result.data && result.data.file_path;
        if (!path) return null;
        return supabaseClient.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, 300);
      })
      .then(function (signed) {
        if (signed && signed.data && signed.data.signedUrl) window.open(signed.data.signedUrl, '_blank', 'noopener');
      })
      .catch(function () { showToast('Could not open file.', true); });
  }

  /* ==================================================================
     Forms & Checklist
     ================================================================== */
  function loadForms() {
    var forms = window.CALESTIA_FORMS || [];
    document.getElementById('psFormsGrid').innerHTML = forms.map(function (f) {
      return '<div class="ps-card ps-card-pad">' +
        '<div style="width:40px;height:40px;border-radius:12px;background:var(--sky-lt);color:var(--navy);display:flex;align-items:center;justify-content:center;margin-bottom:12px;">' +
        '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + f.icon + '</svg></div>' +
        '<h4 style="font-size:0.9rem;font-weight:700;color:var(--navy-dk);margin-bottom:4px;">' + escapeHTML(f.title) + '</h4>' +
        '<p class="ps-hint" style="margin-bottom:14px;line-height:1.5;">' + escapeHTML(f.description) + '</p>' +
        '<a class="ps-btn ps-btn-primary ps-btn-sm" href="' + f.file + '" download>' + window.PSIcon('download', 14) + ' Download</a>' +
        '</div>';
    }).join('');
  }

  /* ==================================================================
     Notifications
     ================================================================== */
  function loadNotifications() {
    supabaseClient.from('notifications').select('*').eq('client_id', session.user.id).order('created_at', { ascending: false }).limit(50)
      .then(function (result) { notificationRows = result.error ? [] : (result.data || []); renderNotifications(); })
      .catch(function () { notificationRows = []; renderNotifications(); });
  }

  function renderNotifications() {
    var unread = notificationRows.filter(function (n) { return !n.is_read; });
    var dot = document.getElementById('psBellDot');
    var navBadge = document.getElementById('psNavNotifBadge');
    document.getElementById('statUnreadNotifs').textContent = String(unread.length);

    if (unread.length) { dot.classList.remove('is-hidden'); navBadge.textContent = unread.length > 9 ? '9+' : String(unread.length); navBadge.classList.remove('is-hidden'); }
    else { dot.classList.add('is-hidden'); navBadge.classList.add('is-hidden'); }

    var renderRow = function (n) {
      var when = n.created_at ? timeAgo(n.created_at) : '';
      return '<div style="padding:12px 14px;border-bottom:1px solid var(--ps-border);' + (n.is_read ? '' : 'background:var(--sky-lt);') + '">' +
        '<p style="font-size:0.82rem;color:var(--navy-dk);line-height:1.4;">' + escapeHTML(n.message) + '</p>' +
        '<p class="ps-hint" style="font-size:0.7rem;margin-top:3px;">' + when + '</p></div>';
    };

    var bellList = document.getElementById('psBellList');
    bellList.innerHTML = notificationRows.length ? notificationRows.slice(0, 8).map(renderRow).join('') : '<p class="ps-hint" style="padding:16px;">No notifications yet.</p>';

    var fullList = document.getElementById('psNotificationsList');
    fullList.innerHTML = notificationRows.length ? notificationRows.map(function (n) {
      return '<div class="ps-card ps-card-pad" style="' + (n.is_read ? '' : 'border-left:3px solid var(--navy);') + '">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;">' +
        '<p style="font-size:0.86rem;color:var(--navy-dk);line-height:1.5;">' + escapeHTML(n.message) + '</p>' +
        '<span class="ps-hint" style="flex-shrink:0;font-size:0.72rem;">' + timeAgo(n.created_at) + '</span></div></div>';
    }).join('') : '<p class="ps-hint">No notifications yet.</p>';

    renderRecentActivity();
  }

  function markNotificationsRead() {
    supabaseClient.from('notifications').update({ is_read: true }).eq('client_id', session.user.id).eq('is_read', false)
      .then(function () { document.getElementById('psBellDot').classList.add('is-hidden'); })
      .catch(function () {});
  }

  /* ==================================================================
     Reviews
     ================================================================== */
  var SERVICE_BADGES = {
    'Japan Visa Assistance': 'Visa', 'Flight Booking': 'Flights', 'Hotel & Accommodation': 'Hotel',
    'Domestic Tour': 'Tours', 'International Tour': 'Tours', 'Travel Insurance': 'Insurance', 'Airport Transfers': 'Transfers'
  };

  function loadReviews() {
    supabaseClient.from('reviews').select('*').order('created_at', { ascending: false })
      .then(function (result) {
        var reviews = result.error ? [] : (result.data || []);
        ownReview = reviews.filter(function (r) { return r.user_id === session.user.id; })[0] || null;
        renderReviews(reviews);
      })
      .catch(function () { renderReviews([]); });
  }

  function renderReviews(reviews) {
    var count = reviews.length;
    var avg = count ? reviews.reduce(function (s, r) { return s + (r.rating || 0); }, 0) / count : 0;
    document.getElementById('psReviewAvg').textContent = count ? avg.toFixed(1) : '—';
    document.getElementById('psReviewCount').textContent = 'Based on ' + count + (count === 1 ? ' review' : ' reviews');

    var grid = document.getElementById('psReviewsGrid');
    if (!reviews.length) { grid.innerHTML = '<p class="ps-hint">No reviews yet — be the first to share your experience.</p>'; return; }

    grid.innerHTML = reviews.map(function (r) {
      var initials = (r.name || '?').trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase();
      var dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short' }) : '';
      var stars = starsHTML(r.rating || 0);
      var badge = SERVICE_BADGES[r.service] || r.service || '';
      return '<div class="ps-card ps-card-pad">' +
        '<div style="display:flex;gap:2px;margin-bottom:10px;">' + stars + '</div>' +
        '<p style="font-size:0.85rem;color:#445a73;line-height:1.5;margin-bottom:14px;">"' + escapeHTML(r.review_text) + '"</p>' +
        '<div style="display:flex;align-items:center;gap:9px;">' +
        (r.photo_url ? '<img src="' + r.photo_url + '" style="width:34px;height:34px;border-radius:50%;object-fit:cover;" alt="" />' : '<div class="ps-avatar ps-avatar-sm">' + initials + '</div>') +
        '<div><p style="font-size:0.82rem;font-weight:600;color:var(--navy-dk);">' + escapeHTML(r.name) + '</p>' +
        '<p class="ps-hint" style="font-size:0.7rem;">' + (badge ? badge + ' · ' : '') + dateStr + '</p></div></div></div>';
    }).join('');
  }

  function starsHTML(rating) {
    var html = '';
    for (var i = 1; i <= 5; i++) {
      html += '<svg width="14" height="14" viewBox="0 0 24 24" fill="' + (i <= Math.round(rating) ? '#f59e0b' : '#e5e7eb') + '" stroke="none"><path d="M11.5 2.6a.55.55 0 0 1 1 0l2.6 5.3 5.8.9c.5.07.7.7.35 1.06l-4.2 4.1 1 5.8a.55.55 0 0 1-.8.58l-5.2-2.7-5.2 2.7a.55.55 0 0 1-.8-.58l1-5.8-4.2-4.1a.55.55 0 0 1 .35-1.06l5.8-.9Z"/></svg>';
    }
    return html;
  }

  function openReviewModal() {
    reviewSelectedRating = ownReview ? ownReview.rating : 0;
    document.getElementById('reviewModalTitle').textContent = ownReview ? 'Update Your Review' : 'Leave a Review';
    document.getElementById('reviewSubmitBtn').textContent = ownReview ? 'Update Review' : 'Submit Review';
    document.getElementById('reviewText').value = ownReview ? ownReview.review_text : '';
    if (ownReview) document.getElementById('reviewService').value = ownReview.service;
    paintStarPicker();
    openModal('reviewModal');
  }

  function paintStarPicker() {
    var picker = document.getElementById('reviewStarPicker');
    picker.innerHTML = '';
    for (var i = 1; i <= 5; i++) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.style.background = 'none'; btn.style.border = 'none'; btn.style.cursor = 'pointer'; btn.style.padding = '2px';
      btn.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" fill="' + (i <= reviewSelectedRating ? '#f59e0b' : 'none') + '" stroke="' + (i <= reviewSelectedRating ? '#f59e0b' : '#d1d5db') + '" stroke-width="1.5"><path d="M11.5 2.6a.55.55 0 0 1 1 0l2.6 5.3 5.8.9c.5.07.7.7.35 1.06l-4.2 4.1 1 5.8a.55.55 0 0 1-.8.58l-5.2-2.7-5.2 2.7a.55.55 0 0 1-.8-.58l1-5.8-4.2-4.1a.55.55 0 0 1 .35-1.06l5.8-.9Z"/></svg>';
      (function (n) {
        btn.addEventListener('click', function () { reviewSelectedRating = n; paintStarPicker(); });
      })(i);
      picker.appendChild(btn);
    }
  }

  function submitReview() {
    var service = document.getElementById('reviewService').value;
    var text = document.getElementById('reviewText').value.trim();
    if (!reviewSelectedRating) { showToast('Please select a star rating.', true); return; }
    if (!text || text.length < 10) { showToast('Please write a bit more about your experience.', true); return; }

    var btn = document.getElementById('reviewSubmitBtn');
    btn.disabled = true;
    var payload = { user_id: session.user.id, name: profile.full_name || profile.email, service: service, rating: reviewSelectedRating, review_text: text };

    var op = ownReview
      ? supabaseClient.from('reviews').update(payload).eq('id', ownReview.id)
      : supabaseClient.from('reviews').insert(payload);

    op.then(function (result) {
      btn.disabled = false;
      if (result.error) { showToast(result.error.message || 'Could not submit review.', true); return; }
      showToast('Thank you for your review!');
      closeModal('reviewModal');
      loadReviews();
    }).catch(function () { btn.disabled = false; showToast('Something went wrong. Please try again.', true); });
  }

  /* ==================================================================
     Profile
     ================================================================== */
  var profileEditing = false;
  var PROFILE_FIELDS = ['pfFullName', 'pfEmail', 'pfPhone', 'pfNationality', 'pfPassport', 'pfDob'];

  function loadProfile() {
    document.getElementById('pfFullName').value = profile.full_name || '';
    document.getElementById('pfEmail').value = profile.email || '';
    document.getElementById('pfPhone').value = profile.phone || '';
    document.getElementById('pfNationality').value = profile.nationality || '';
    document.getElementById('pfPassport').value = profile.passport_number || '';
    document.getElementById('pfDob').value = profile.date_of_birth || '';

    document.getElementById('psEditProfileBtn').addEventListener('click', function () {
      profileEditing = !profileEditing;
      PROFILE_FIELDS.forEach(function (id) {
        if (id === 'pfEmail') return; // email is never client-editable here
        document.getElementById(id).disabled = !profileEditing;
      });
      this.textContent = profileEditing ? 'Cancel' : 'Edit Profile';
      document.getElementById('psProfileSaveRow').classList.toggle('is-hidden', !profileEditing);
    });

    document.getElementById('psSaveProfileBtn').addEventListener('click', saveProfile);
  }

  function saveProfile() {
    var payload = {
      full_name: document.getElementById('pfFullName').value.trim(),
      phone: document.getElementById('pfPhone').value.trim() || null,
      nationality: document.getElementById('pfNationality').value.trim() || null,
      passport_number: document.getElementById('pfPassport').value.trim() || null,
      date_of_birth: document.getElementById('pfDob').value || null
    };
    supabaseClient.from('profiles').update(payload).eq('id', session.user.id)
      .then(function (result) {
        if (result.error) { showToast(result.error.message || 'Could not save profile.', true); return; }
        Object.assign(profile, payload);
        showToast('Profile updated.');
        profileEditing = false;
        PROFILE_FIELDS.forEach(function (id) { document.getElementById(id).disabled = true; });
        document.getElementById('psEditProfileBtn').textContent = 'Edit Profile';
        document.getElementById('psProfileSaveRow').classList.add('is-hidden');
        document.getElementById('psUserName').textContent = payload.full_name || profile.email;
        document.getElementById('psProfileName').textContent = payload.full_name || profile.email;
        document.getElementById('psBannerName').textContent = (payload.full_name || profile.email).split(' ')[0];
      })
      .catch(function () { showToast('Something went wrong. Please try again.', true); });
  }

  /* ==================================================================
     Realtime
     ================================================================== */
  function subscribeRealtime() {
    var clientId = session.user.id;
    supabaseClient.channel('client-portal-' + clientId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents', filter: 'client_id=eq.' + clientId }, function () { if (documentsAccessState && documentsAccessState.allowed) loadDocuments(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'applications', filter: 'client_id=eq.' + clientId }, function () { loadDashboard(); loadVisaPanel(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: 'client_id=eq.' + clientId }, loadNotifications)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visa_applicants', filter: 'client_id=eq.' + clientId }, function () { loadVisaPanel(); loadDocumentsAccessState(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_submissions', filter: 'client_id=eq.' + clientId }, function () { loadVisaPanel(); loadDocumentsAccessState(); })
      .subscribe();
  }

  /* ==================================================================
     Helpers
     ================================================================== */
  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  var toastTimer = null;
  function showToast(message, isError) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.background = isError ? '#c0392b' : '';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 3200);
  }
})();
