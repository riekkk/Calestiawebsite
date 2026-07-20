/* ==========================================================================
   Calestia Travel & Tours — staff-portal.js
   Employee/Admin portal only. Loaded only on staff-portal.html, separately
   from script.js, to keep the shared site script from ballooning — this
   file owns its own Supabase client instance (same project, same session
   in localStorage, so signing in on any page carries over here).
   ========================================================================== */
(function () {
  'use strict';

  var supabaseClient = null;
  var currentProfile = null;
  var profilesCache = null; // id -> profile, refreshed per view load
  var activeClientId = null; // client currently open in the detail modal
  var lastKnownApplicationUpdatedAt = null;
  var pendingDocAction = null; // { docType, action }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    if (typeof window.supabase === 'undefined' || !window.CALESTIA_SUPABASE_URL || !window.CALESTIA_SUPABASE_ANON_KEY) {
      redirectAway('index.html');
      return;
    }
    supabaseClient = window.supabase.createClient(window.CALESTIA_SUPABASE_URL, window.CALESTIA_SUPABASE_ANON_KEY);

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) { redirectAway('index.html'); return; }
      verifyStaffAccess();
    });

    supabaseClient.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') redirectAway('index.html');
    });
  }

  function redirectAway(url) {
    window.location.href = url;
  }

  function verifyStaffAccess() {
    supabaseClient.auth.getUser().then(function (userResult) {
      var user = userResult.data && userResult.data.user;
      if (!user) { redirectAway('index.html'); return; }

      supabaseClient.from('profiles').select('*').eq('id', user.id).maybeSingle()
        .then(function (result) {
          var profile = result.data;
          if (!profile || profile.role === 'client' || profile.status !== 'active') {
            redirectAway('client-portal.html');
            return;
          }
          currentProfile = profile;
          revealStaffApp();
        })
        .catch(function () { redirectAway('index.html'); });
    });
  }

  function revealStaffApp() {
    var gate = document.getElementById('staffGate');
    var app = document.getElementById('staffApp');
    if (gate) gate.classList.add('is-hidden');
    if (app) app.classList.remove('is-hidden');

    var badge = document.getElementById('staffRoleBadge');
    if (badge) badge.textContent = currentProfile.role === 'admin' ? 'Administrator' : 'Employee';

    if (currentProfile.role === 'admin') {
      var empTab = document.getElementById('employeesTabBtn');
      var auditTab = document.getElementById('auditTabBtn');
      if (empTab) empTab.classList.remove('is-hidden');
      if (auditTab) auditTab.classList.remove('is-hidden');
    }

    populateStatusFilterOptions();
    initTabs();
    wireClientDetailModal();
    wireDocActionModal();

    loadDashboard();
    loadClients();
    if (currentProfile.role === 'admin') {
      loadEmployees();
      loadAuditLog();
    }

    subscribeStaffRealtime();
  }

  function toast(msg, warn) {
    if (window.calestiaToast) window.calestiaToast(msg, warn);
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function labelFor(list, key) {
    var found = (list || []).filter(function (s) { return s.key === key; })[0];
    return found ? found.label : (key || '');
  }

  /* ------------------------------------------------------------------
     Tabs
     ------------------------------------------------------------------ */
  function initTabs() {
    var tabs = document.querySelectorAll('.staff-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        var target = this.getAttribute('data-tab');
        document.querySelectorAll('.staff-tab').forEach(function (t) { t.classList.toggle('is-active', t.getAttribute('data-tab') === target); });
        document.querySelectorAll('.staff-panel').forEach(function (p) { p.classList.toggle('is-active', p.getAttribute('data-panel') === target); });
      });
    }
  }

  /* ------------------------------------------------------------------
     Shared: profile lookups
     ------------------------------------------------------------------ */
  function loadAllProfiles() {
    return supabaseClient.from('profiles').select('*').then(function (result) {
      profilesCache = {};
      (result.data || []).forEach(function (p) { profilesCache[p.id] = p; });
      return profilesCache;
    });
  }

  function profileName(id) {
    var p = profilesCache && profilesCache[id];
    return p ? (p.full_name || p.email) : 'Unknown';
  }

  /* ------------------------------------------------------------------
     Dashboard
     ------------------------------------------------------------------ */
  function loadDashboard() {
    Promise.all([
      supabaseClient.from('profiles').select('id').eq('role', 'client'),
      supabaseClient.from('applications').select('*'),
      supabaseClient.from('documents').select('*')
    ]).then(function (results) {
      var clients = results[0].data || [];
      var applications = results[1].data || [];
      var documents = results[2].data || [];

      setText('statTotalClients', clients.length);
      setText('statActive', applications.filter(function (a) { return a.status !== 'completed' && a.status !== 'visa_denied'; }).length);
      setText('statPendingDocs', documents.filter(function (d) { return d.status === 'pending' && d.file_path; }).length);
      setText('statUnderReview', applications.filter(function (a) { return a.status === 'documents_under_review'; }).length);
      setText('statApproved', applications.filter(function (a) { return ['visa_approved', 'passport_ready_for_pickup', 'completed'].indexOf(a.status) !== -1; }).length);
      setText('statDenied', applications.filter(function (a) { return a.status === 'visa_denied'; }).length);

      loadAllProfiles().then(function () {
        renderRecentApplications(applications);
      });
    }).catch(function () { /* leave dashes on failure */ });

    renderRecentActivity();
  }

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function renderRecentApplications(applications) {
    var container = document.getElementById('recentApplications');
    if (!container) return;
    var sorted = applications.slice().sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); }).slice(0, 8);
    if (!sorted.length) { container.innerHTML = '<p class="portal-hint">No applications yet.</p>'; return; }
    container.innerHTML = sorted.map(function (a) {
      return '<div class="staff-list-row"><span>' + escapeHTML(profileName(a.client_id)) + '</span>' +
        '<span class="staff-pill">' + escapeHTML(labelFor(window.CALESTIA_APPLICATION_STATUSES, a.status)) + '</span></div>';
    }).join('');
  }

  function renderRecentActivity() {
    var container = document.getElementById('recentActivity');
    if (!container) return;
    Promise.all([
      supabaseClient.from('documents').select('*').order('updated_at', { ascending: false }).limit(6),
      supabaseClient.from('applications').select('*').order('updated_at', { ascending: false }).limit(6)
    ]).then(function (results) {
      var items = [];
      (results[0].data || []).forEach(function (d) {
        items.push({ when: d.updated_at, text: profileName(d.client_id) + ' — ' + labelFor(window.CALESTIA_DOCUMENT_TYPES, d.document_type) + ' is now "' + labelFor(window.CALESTIA_DOCUMENT_STATUSES, d.status) + '"' });
      });
      (results[1].data || []).forEach(function (a) {
        items.push({ when: a.updated_at, text: profileName(a.client_id) + '’s application is now "' + labelFor(window.CALESTIA_APPLICATION_STATUSES, a.status) + '"' });
      });
      items.sort(function (a, b) { return new Date(b.when) - new Date(a.when); });
      items = items.slice(0, 8);
      if (!items.length) { container.innerHTML = '<p class="portal-hint">Nothing yet.</p>'; return; }
      container.innerHTML = items.map(function (i) {
        return '<div class="staff-list-row"><span>' + escapeHTML(i.text) + '</span><span class="staff-list-time">' + formatDate(i.when) + '</span></div>';
      }).join('');
    }).catch(function () {});
  }

  /* ------------------------------------------------------------------
     Clients list
     ------------------------------------------------------------------ */
  function populateStatusFilterOptions() {
    var select = document.getElementById('clientStatusFilter');
    if (!select) return;
    (window.CALESTIA_APPLICATION_STATUSES || []).forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.key;
      opt.textContent = s.label;
      select.appendChild(opt);
    });
  }

  var allClientsCache = [];

  function loadClients() {
    supabaseClient
      .from('profiles')
      .select('*, applications(status, updated_at), documents(document_type, status, file_path)')
      .eq('role', 'client')
      .then(function (result) {
        allClientsCache = result.data || [];
        renderClientsTable();
      })
      .catch(function () {
        var tbody = document.getElementById('clientsTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="portal-hint">Could not load clients.</td></tr>';
      });

    var search = document.getElementById('clientSearch');
    var filter = document.getElementById('clientStatusFilter');
    if (search && !search.dataset.wired) {
      search.dataset.wired = '1';
      search.addEventListener('input', renderClientsTable);
    }
    if (filter && !filter.dataset.wired) {
      filter.dataset.wired = '1';
      filter.addEventListener('change', renderClientsTable);
    }
  }

  function renderClientsTable() {
    var tbody = document.getElementById('clientsTableBody');
    if (!tbody) return;

    var query = (document.getElementById('clientSearch') || {}).value || '';
    query = query.trim().toLowerCase();
    var statusFilter = (document.getElementById('clientStatusFilter') || {}).value || '';

    var rows = allClientsCache.filter(function (c) {
      var app = (c.applications && c.applications[0]) || null;
      var matchesQuery = !query || (c.full_name || '').toLowerCase().indexOf(query) !== -1 || (c.email || '').toLowerCase().indexOf(query) !== -1;
      var matchesStatus = !statusFilter || (app && app.status === statusFilter);
      return matchesQuery && matchesStatus;
    });

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="portal-hint">No clients match.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function (c) {
      var app = (c.applications && c.applications[0]) || null;
      var docs = c.documents || [];
      var verifiedCount = docs.filter(function (d) { return d.status === 'verified'; }).length;
      var totalTypes = (window.CALESTIA_DOCUMENT_TYPES || []).length;
      return '<tr>' +
        '<td><strong>' + escapeHTML(c.full_name || 'Unnamed') + '</strong></td>' +
        '<td>' + escapeHTML(c.email) + '</td>' +
        '<td><span class="staff-pill">' + escapeHTML(app ? labelFor(window.CALESTIA_APPLICATION_STATUSES, app.status) : '—') + '</span></td>' +
        '<td>' + docs.filter(function (d) { return d.file_path; }).length + '/' + totalTypes + ' uploaded · ' + verifiedCount + ' verified</td>' +
        '<td><button type="button" class="portal-attach-btn js-open-client" data-client-id="' + c.id + '">Review →</button></td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('.js-open-client').forEach(function (btn) {
      btn.addEventListener('click', function () { openClientDetail(this.getAttribute('data-client-id')); });
    });
  }

  /* ------------------------------------------------------------------
     Client detail modal
     ------------------------------------------------------------------ */
  function wireClientDetailModal() {
    var modal = document.getElementById('clientDetailModal');
    if (!modal) return;

    modal.querySelectorAll('[data-close-client-modal]').forEach(function (el) {
      el.addEventListener('click', closeClientDetail);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) closeClientDetail();
    });

    var saveBtn = document.getElementById('saveStatusBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveApplicationStatus);

    var addRemarkBtn = document.getElementById('addRemarkBtn');
    if (addRemarkBtn) addRemarkBtn.addEventListener('click', addRemark);

    var addNoteBtn = document.getElementById('addInternalNoteBtn');
    if (addNoteBtn) addNoteBtn.addEventListener('click', addInternalNote);

    var statusSelect = document.getElementById('applicationStatusSelect');
    if (statusSelect) {
      (window.CALESTIA_APPLICATION_STATUSES || []).forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.key;
        opt.textContent = s.label;
        statusSelect.appendChild(opt);
      });
    }
  }

  function openClientDetail(clientId) {
    activeClientId = clientId;
    var profile = profilesCache && profilesCache[clientId];
    var modal = document.getElementById('clientDetailModal');

    document.getElementById('clientDetailName').textContent = (profile && (profile.full_name || profile.email)) || 'Client';
    document.getElementById('clientDetailEmail').textContent = (profile && profile.email) || '';
    document.getElementById('statusConflictWarning').classList.add('is-hidden');

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    refreshClientDetail(clientId);
  }

  function closeClientDetail() {
    var modal = document.getElementById('clientDetailModal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    activeClientId = null;
  }

  function refreshClientDetail(clientId) {
    supabaseClient.from('applications').select('*').eq('client_id', clientId).maybeSingle().then(function (result) {
      var app = result.data;
      lastKnownApplicationUpdatedAt = app ? app.updated_at : null;
      var select = document.getElementById('applicationStatusSelect');
      if (select && app) select.value = app.status;
    });

    refreshClientDocuments(clientId);
    refreshClientRemarks(clientId);
    refreshInternalNotes(clientId);
  }

  function saveApplicationStatus() {
    if (!activeClientId) return;
    var select = document.getElementById('applicationStatusSelect');
    var newStatus = select.value;
    var btn = document.getElementById('saveStatusBtn');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    var query = supabaseClient.from('applications').update({ status: newStatus }).eq('client_id', activeClientId);
    if (lastKnownApplicationUpdatedAt) {
      query = query.eq('updated_at', lastKnownApplicationUpdatedAt);
    }

    query.select().then(function (result) {
      btn.disabled = false;
      btn.textContent = originalText;
      if (result.error) { toast(result.error.message || 'Could not update status.', true); return; }
      if (!result.data || !result.data.length) {
        document.getElementById('statusConflictWarning').classList.remove('is-hidden');
        refreshClientDetail(activeClientId);
        return;
      }
      document.getElementById('statusConflictWarning').classList.add('is-hidden');
      lastKnownApplicationUpdatedAt = result.data[0].updated_at;
      toast('Application status updated.');
      loadDashboard();
      loadClients();
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = originalText;
      toast('Something went wrong. Please try again.', true);
    });
  }

  function refreshClientDocuments(clientId) {
    supabaseClient.from('documents').select('*').eq('client_id', clientId).then(function (result) {
      renderClientDocuments(clientId, result.data || []);
    });
  }

  function renderClientDocuments(clientId, documentRows) {
    var container = document.getElementById('clientDetailDocuments');
    if (!container) return;
    var byType = {};
    documentRows.forEach(function (d) { byType[d.document_type] = d; });

    container.innerHTML = (window.CALESTIA_DOCUMENT_TYPES || []).map(function (t) {
      var doc = byType[t.key];
      var hasFile = !!(doc && doc.file_path);
      var statusLabel = doc ? labelFor(window.CALESTIA_DOCUMENT_STATUSES, doc.status) : 'Not Uploaded';
      return (
        '<div class="staff-doc-row" data-doc-type="' + t.key + '">' +
          '<div class="staff-doc-row-main">' +
            '<strong>' + escapeHTML(t.label) + '</strong>' +
            '<span class="staff-pill">' + escapeHTML(statusLabel) + '</span>' +
          '</div>' +
          (hasFile ? '<div class="staff-doc-row-file">' + escapeHTML(doc.file_name || '') + '</div>' : '<div class="staff-doc-row-file portal-hint">No file uploaded yet</div>') +
          (doc && doc.remarks ? '<div class="staff-doc-row-remark">Remark: ' + escapeHTML(doc.remarks) + '</div>' : '') +
          '<div class="staff-doc-row-actions">' +
            (hasFile ? '<button type="button" class="btn-outline" data-doc-action="preview" style="padding:8px 14px;">Preview</button>' : '') +
            (hasFile ? '<button type="button" class="btn-outline" data-doc-action="download" style="padding:8px 14px;">Download</button>' : '') +
            (hasFile ? '<button type="button" class="staff-doc-approve" data-doc-action="verify">✓ Verify</button>' : '') +
            (hasFile ? '<button type="button" class="staff-doc-reject" data-doc-action="reject">✕ Reject</button>' : '') +
            (hasFile ? '<button type="button" class="btn-outline" data-doc-action="reupload" style="padding:8px 14px;">Request Re-upload</button>' : '') +
          '</div>' +
        '</div>'
      );
    }).join('');

    container.querySelectorAll('[data-doc-action]').forEach(function (btn) {
      var row = btn.closest('[data-doc-type]');
      var docType = row.getAttribute('data-doc-type');
      var action = btn.getAttribute('data-doc-action');
      btn.addEventListener('click', function () { handleDocAction(clientId, docType, action); });
    });
  }

  function handleDocAction(clientId, docType, action) {
    if (action === 'preview' || action === 'download') {
      supabaseClient.from('documents').select('file_path, file_name').eq('client_id', clientId).eq('document_type', docType).maybeSingle()
        .then(function (result) {
          var path = result.data && result.data.file_path;
          if (!path) return;
          return supabaseClient.storage.from('client-documents').createSignedUrl(path, 300, action === 'download' ? { download: result.data.file_name } : undefined);
        })
        .then(function (signed) {
          if (signed && signed.data && signed.data.signedUrl) window.open(signed.data.signedUrl, '_blank', 'noopener');
        })
        .catch(function () { toast('Could not open file.', true); });
      return;
    }

    if (action === 'verify') {
      updateDocumentStatus(clientId, docType, 'verified', null);
      return;
    }

    // reject / reupload both need a remark from the employee first
    pendingDocAction = { clientId: clientId, docType: docType, action: action };
    var title = action === 'reject' ? 'Reject document' : 'Request re-upload';
    document.getElementById('docActionTitle').textContent = title;
    document.getElementById('docActionRemark').value = '';
    var modal = document.getElementById('docActionModal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function wireDocActionModal() {
    var modal = document.getElementById('docActionModal');
    if (!modal) return;
    modal.querySelectorAll('[data-close-doc-modal]').forEach(function (el) {
      el.addEventListener('click', function () {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        pendingDocAction = null;
      });
    });
    var confirmBtn = document.getElementById('docActionConfirmBtn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        if (!pendingDocAction) return;
        var remark = document.getElementById('docActionRemark').value.trim();
        if (!remark) { toast('Please add a remark for the client.', true); return; }
        var status = pendingDocAction.action === 'reject' ? 'rejected' : 'reupload_requested';
        updateDocumentStatus(pendingDocAction.clientId, pendingDocAction.docType, status, remark);
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        pendingDocAction = null;
      });
    }
  }

  function updateDocumentStatus(clientId, docType, status, remark) {
    var payload = { status: status, verified_by: currentProfile.id, verified_at: new Date().toISOString() };
    if (remark !== null) payload.remarks = remark;
    if (status === 'verified') { payload.remarks = null; }

    supabaseClient.from('documents').update(payload).eq('client_id', clientId).eq('document_type', docType)
      .then(function (result) {
        if (result.error) { toast(result.error.message || 'Could not update document.', true); return; }
        toast('Document updated.');
        if (activeClientId === clientId) refreshClientDocuments(clientId);
        loadDashboard();
        loadClients();
      })
      .catch(function () { toast('Something went wrong.', true); });
  }

  function refreshClientRemarks(clientId) {
    supabaseClient.from('remarks').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).then(function (result) {
      var list = document.getElementById('clientRemarksList');
      var rows = result.data || [];
      if (!rows.length) { list.innerHTML = '<p class="portal-hint">No remarks yet.</p>'; return; }
      list.innerHTML = rows.map(function (r) {
        return '<div class="portal-remark-item"><div>' + escapeHTML(r.message) + '</div><span class="portal-remark-time">' + formatDate(r.created_at) + '</span></div>';
      }).join('');
    });
  }

  function addRemark() {
    if (!activeClientId) return;
    var textarea = document.getElementById('newRemarkText');
    var message = textarea.value.trim();
    if (!message) { toast('Write a remark first.', true); return; }

    supabaseClient.from('remarks').insert({ client_id: activeClientId, author_id: currentProfile.id, message: message })
      .then(function (result) {
        if (result.error) { toast(result.error.message || 'Could not send remark.', true); return; }
        textarea.value = '';
        toast('Remark sent to client.');
        refreshClientRemarks(activeClientId);
      })
      .catch(function () { toast('Something went wrong.', true); });
  }

  function refreshInternalNotes(clientId) {
    supabaseClient.from('internal_notes').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).then(function (result) {
      var list = document.getElementById('internalNotesList');
      var rows = result.data || [];
      if (!rows.length) { list.innerHTML = '<p class="portal-hint">No internal notes yet.</p>'; return; }
      list.innerHTML = rows.map(function (n) {
        return '<div class="portal-remark-item"><div>' + escapeHTML(n.note) + '</div><span class="portal-remark-time">' + escapeHTML(profileName(n.author_id)) + ' · ' + formatDate(n.created_at) + '</span></div>';
      }).join('');
    });
  }

  function addInternalNote() {
    if (!activeClientId) return;
    var textarea = document.getElementById('newInternalNoteText');
    var note = textarea.value.trim();
    if (!note) { toast('Write a note first.', true); return; }

    supabaseClient.from('internal_notes').insert({ client_id: activeClientId, author_id: currentProfile.id, note: note })
      .then(function (result) {
        if (result.error) { toast(result.error.message || 'Could not add note.', true); return; }
        textarea.value = '';
        toast('Internal note added.');
        refreshInternalNotes(activeClientId);
      })
      .catch(function () { toast('Something went wrong.', true); });
  }

  /* ------------------------------------------------------------------
     Employees (admin only)
     ------------------------------------------------------------------ */
  var allProfilesCache = [];

  function loadEmployees() {
    supabaseClient.from('profiles').select('*').order('created_at', { ascending: false }).then(function (result) {
      allProfilesCache = result.data || [];
      renderEmployeesTable();
    });

    var search = document.getElementById('employeeSearch');
    if (search && !search.dataset.wired) {
      search.dataset.wired = '1';
      search.addEventListener('input', renderEmployeesTable);
    }
  }

  function renderEmployeesTable() {
    var tbody = document.getElementById('employeesTableBody');
    if (!tbody) return;
    var query = ((document.getElementById('employeeSearch') || {}).value || '').trim().toLowerCase();

    var rows = allProfilesCache.filter(function (p) {
      return !query || (p.full_name || '').toLowerCase().indexOf(query) !== -1 || (p.email || '').toLowerCase().indexOf(query) !== -1;
    });

    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" class="portal-hint">No accounts match.</td></tr>'; return; }

    tbody.innerHTML = rows.map(function (p) {
      var roleLabel = p.role.charAt(0).toUpperCase() + p.role.slice(1);
      var statusLabel = p.status.charAt(0).toUpperCase() + p.status.slice(1);
      var actions = [];
      if (p.role === 'client') actions.push('<button type="button" class="btn-outline" style="padding:8px 12px;" data-emp-action="make_employee" data-id="' + p.id + '">Make Employee</button>');
      if (p.role === 'employee') {
        actions.push('<button type="button" class="btn-outline" style="padding:8px 12px;" data-emp-action="make_admin" data-id="' + p.id + '">Make Admin</button>');
        actions.push('<button type="button" class="btn-outline" style="padding:8px 12px;" data-emp-action="make_client" data-id="' + p.id + '">Demote to Client</button>');
      }
      if (p.role === 'admin') {
        actions.push('<button type="button" class="btn-outline" style="padding:8px 12px;" data-emp-action="make_employee" data-id="' + p.id + '">Demote to Employee</button>');
      }
      if (p.role !== 'client') {
        actions.push(p.status === 'active'
          ? '<button type="button" class="staff-doc-reject" data-emp-action="disable" data-id="' + p.id + '">Disable</button>'
          : '<button type="button" class="staff-doc-approve" data-emp-action="enable" data-id="' + p.id + '">Enable</button>');
      }
      return '<tr>' +
        '<td><strong>' + escapeHTML(p.full_name || 'Unnamed') + '</strong></td>' +
        '<td>' + escapeHTML(p.email) + '</td>' +
        '<td><span class="staff-pill">' + roleLabel + '</span></td>' +
        '<td><span class="staff-pill ' + (p.status === 'disabled' ? 'is-danger' : '') + '">' + statusLabel + '</span></td>' +
        '<td class="staff-action-cell">' + actions.join('') + '</td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('[data-emp-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        handleEmployeeAction(this.getAttribute('data-emp-action'), this.getAttribute('data-id'));
      });
    });
  }

  function handleEmployeeAction(action, targetId) {
    if (targetId === currentProfile.id && (action === 'disable' || action === 'make_employee' || action === 'make_client')) {
      if (!window.confirm('This will change your own account. Continue?')) return;
    }

    var payload = {};
    if (action === 'make_employee') payload.role = 'employee';
    if (action === 'make_admin') payload.role = 'admin';
    if (action === 'make_client') payload.role = 'client';
    if (action === 'disable') payload.status = 'disabled';
    if (action === 'enable') payload.status = 'active';

    supabaseClient.from('profiles').update(payload).eq('id', targetId)
      .then(function (result) {
        if (result.error) { toast(result.error.message || 'Could not update account.', true); return; }
        toast('Account updated.');
        loadEmployees();
        loadAuditLog();
      })
      .catch(function () { toast('Something went wrong.', true); });
  }

  /* ------------------------------------------------------------------
     Audit log (admin only)
     ------------------------------------------------------------------ */
  function loadAuditLog() {
    supabaseClient.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200)
      .then(function (result) { renderAuditLog(result.data || []); })
      .catch(function () {
        var tbody = document.getElementById('auditTableBody');
        if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="portal-hint">Could not load audit log.</td></tr>';
      });
  }

  function renderAuditLog(rows) {
    var tbody = document.getElementById('auditTableBody');
    if (!tbody) return;
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" class="portal-hint">No activity recorded yet.</td></tr>'; return; }

    tbody.innerHTML = rows.map(function (r) {
      var change = r.field_changed ? (escapeHTML(r.field_changed) + ': ' + escapeHTML(r.old_value || '—') + ' → ' + escapeHTML(r.new_value || '—')) : '';
      return '<tr>' +
        '<td>' + formatDate(r.created_at) + '</td>' +
        '<td>' + escapeHTML(r.actor_name || 'Unknown') + '</td>' +
        '<td>' + escapeHTML(r.action) + '</td>' +
        '<td>' + escapeHTML(profileName(r.client_id)) + '</td>' +
        '<td>' + change + '</td>' +
      '</tr>';
    }).join('');
  }

  /* ------------------------------------------------------------------
     Realtime — every staff member always sees the latest data
     ------------------------------------------------------------------ */
  function subscribeStaffRealtime() {
    supabaseClient
      .channel('staff-portal')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, handleRealtimeUpdate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, handleRealtimeUpdate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'remarks' }, handleRealtimeUpdate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, function () {
        if (currentProfile.role === 'admin') loadEmployees();
      })
      .subscribe();
  }

  var realtimeDebounce = null;
  function handleRealtimeUpdate(payload) {
    // Batch bursts of changes (e.g. bulk updates) into a single refresh.
    clearTimeout(realtimeDebounce);
    realtimeDebounce = setTimeout(function () {
      loadDashboard();
      loadClients();
      var row = payload && payload.new;
      var affectedClientId = row && row.client_id;
      if (activeClientId && affectedClientId === activeClientId) {
        refreshClientDetail(activeClientId);
      }
    }, 400);
  }

})();
