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
    documents: ['My Documents', 'Upload and manage your visa documents'],
    forms: ['Forms & Checklist', 'Download official forms and requirements'],
    notifications: ['Notifications', 'Updates on your application and documents'],
    reviews: ['Client Reviews', 'See what other clients say about us'],
    profile: ['My Profile', 'Manage your personal information']
  };

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
    loadDocuments();
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
    var navItems = document.querySelectorAll('#psNav .ps-nav-item');
    navItems.forEach(function (btn) {
      btn.addEventListener('click', function () { goToPanel(btn.getAttribute('data-panel')); });
    });
    document.querySelectorAll('[data-goto-panel]').forEach(function (btn) {
      btn.addEventListener('click', function () { goToPanel(btn.getAttribute('data-goto-panel')); });
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
  }

  function openModal(id) {
    var modal = document.getElementById(id);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }
  function closeModal(id) {
    var modal = document.getElementById(id);
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
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
    var el = document.getElementById('psTimeline');
    var statuses = window.CALESTIA_APPLICATION_STATUSES || [];

    if (!app) {
      el.innerHTML = '<p class="ps-hint">Your application will appear here once Calestia sets it up.</p>';
      document.getElementById('psBannerStatus').textContent = '—';
      document.getElementById('statDaysInProcess').textContent = '—';
      return;
    }

    document.getElementById('psBannerStatus').textContent = statusLabel(statuses, app.status);
    var days = app.created_at ? Math.max(0, Math.floor((Date.now() - new Date(app.created_at).getTime()) / 86400000)) : 0;
    document.getElementById('statDaysInProcess').textContent = String(days);

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
    el.innerHTML = html;
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents', filter: 'client_id=eq.' + clientId }, loadDocuments)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'applications', filter: 'client_id=eq.' + clientId }, loadDashboard)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: 'client_id=eq.' + clientId }, loadNotifications)
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
