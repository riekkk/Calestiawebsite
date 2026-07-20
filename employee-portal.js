/* ==========================================================================
   Calestia Travel & Tours — employee-portal.js
   ==========================================================================
   Page-specific controller for employee-portal.html. Everything reusable
   (session gate, Client Detail Modal, realtime plumbing, formatting
   helpers) lives in staff-shared.js (window.PSStaff) — this file only
   owns the Employee-specific dashboard/tabs.
   ========================================================================== */
(function () {
  'use strict';

  var PS = window.PSStaff;
  var supabaseClient = null;
  var clientsCache = []; // profiles joined with applications + documents

  var PAGE_META = {
    dashboard: ['Dashboard', "Employee Dashboard · Calestia Travel & Tours"],
    clients: ['Clients', 'Manage and review your assigned clients'],
    applications: ['Applications', 'Review and update visa application statuses'],
    documents: ['Documents', 'Verify, reject, or request re-uploads'],
    remarks: ['Remarks', 'All client-visible remarks'],
    notifications: ['Notifications', 'Recent updates across all clients'],
    notes: ['Internal Notes', 'Private notes visible to staff only'],
    settings: ['Settings', 'Your account preferences']
  };

  document.addEventListener('DOMContentLoaded', function () {
    PS.gate('employee', onReady);
  });

  function onReady(profile) {
    supabaseClient = PS.client();

    PS.injectSharedModals();
    PS.wireClientDetailModal(refreshAllData);
    PS.wireShell(PAGE_META, {
      clients: loadClients,
      applications: loadApplications,
      documents: loadDocumentQueue,
      remarks: loadRemarks,
      notifications: loadNotifications,
      notes: loadNotes,
      settings: loadSettings
    });

    document.getElementById('psBannerName').textContent = (profile.full_name || profile.email || '').split(' ')[0];

    populateStatusFilterOptions();
    PS.loadAllProfiles().then(function () {
      loadDashboard();
      loadClients();
    });

    PS.subscribeRealtime({ onCoreChange: refreshAllData });
  }

  function refreshAllData() {
    loadDashboard();
    loadClients();
    if (document.querySelector('.ps-panel[data-panel="applications"]').classList.contains('is-active')) loadApplications();
    if (document.querySelector('.ps-panel[data-panel="documents"]').classList.contains('is-active')) loadDocumentQueue();
  }

  function populateStatusFilterOptions() {
    var select = document.getElementById('clientStatusFilter');
    (window.CALESTIA_APPLICATION_STATUSES || []).forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.key; opt.textContent = s.label;
      select.appendChild(opt);
    });

    var tabs = document.getElementById('psAppStatusTabs');
    var allBtn = makeTabButton('', 'All');
    allBtn.classList.add('is-active');
    tabs.appendChild(allBtn);
    (window.CALESTIA_APPLICATION_STATUSES || []).forEach(function (s) { tabs.appendChild(makeTabButton(s.key, s.label)); });
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('.ps-tab-btn');
      if (!btn) return;
      tabs.querySelectorAll('.ps-tab-btn').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
      renderApplications();
    });
  }
  function makeTabButton(value, label) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'ps-tab-btn'; b.textContent = label; b.setAttribute('data-status', value);
    return b;
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
      var approved = applications.filter(function (a) { return ['visa_approved', 'passport_ready_for_pickup', 'completed'].indexOf(a.status) !== -1; }).length;
      var denied = applications.filter(function (a) { return a.status === 'visa_denied'; }).length;
      setText('statApproved', approved);
      setText('statDenied', denied);

      renderStatusBars(applications);
      renderApprovalDonut(approved, denied);
      renderRecentApplications(applications);

      var docBadge = document.getElementById('psNavDocsBadge');
      var pendingCount = documents.filter(function (d) { return d.file_path && (d.status === 'pending' || d.status === 'under_review'); }).length;
      if (pendingCount > 0) { docBadge.textContent = String(pendingCount); docBadge.classList.remove('is-hidden'); }
      else docBadge.classList.add('is-hidden');
    }).catch(function () {});
  }

  function setText(id, value) { var el = document.getElementById(id); if (el) el.textContent = value; }

  function renderStatusBars(applications) {
    var el = document.getElementById('psStatusBars');
    var total = applications.length || 1;
    el.innerHTML = (window.CALESTIA_APPLICATION_STATUSES || []).map(function (s) {
      var count = applications.filter(function (a) { return a.status === s.key; }).length;
      var pct = Math.round((count / total) * 100);
      return '<div class="ps-bar-row"><span style="width:150px;font-size:0.78rem;color:var(--navy-dk);flex-shrink:0;">' + PS.escapeHTML(s.label) + '</span>' +
        '<div class="ps-bar-track"><div class="ps-bar-fill" style="width:' + pct + '%;"></div></div>' +
        '<span style="width:34px;font-size:0.75rem;color:var(--ps-text-dim);text-align:right;flex-shrink:0;">' + count + '</span></div>';
    }).join('');
  }

  function renderApprovalDonut(approved, denied) {
    var total = approved + denied;
    var pct = total ? Math.round((approved / total) * 100) : 0;
    var r = 54, c = 2 * Math.PI * r;
    var dash = (pct / 100) * c;
    document.getElementById('psApprovalDonut').innerHTML =
      '<div class="ps-donut-wrap"><div class="ps-donut"><svg width="132" height="132" viewBox="0 0 132 132">' +
      '<circle cx="66" cy="66" r="' + r + '" fill="none" stroke="var(--ps-border)" stroke-width="14"/>' +
      '<circle cx="66" cy="66" r="' + r + '" fill="none" stroke="var(--navy)" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + c + '"/>' +
      '</svg><div class="ps-donut-center"><strong>' + pct + '%</strong><span>Approved</span></div></div>' +
      '<div style="margin-top:14px;width:100%;display:flex;justify-content:space-between;font-size:0.78rem;color:var(--ps-text-dim);">' +
      '<span>✓ Approved (' + approved + ')</span><span>✕ Denied (' + denied + ')</span></div></div>';
  }

  function renderRecentApplications(applications) {
    var container = document.getElementById('psRecentApplications');
    var sorted = applications.slice().sort(function (a, b) { return new Date(b.updated_at) - new Date(a.updated_at); }).slice(0, 8);
    if (!sorted.length) { container.innerHTML = '<p class="ps-hint">No applications yet.</p>'; return; }
    container.innerHTML = sorted.map(function (a) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--ps-border);">' +
        '<div class="ps-avatar ps-avatar-sm">' + PS.escapeHTML((PS.profileName(a.client_id) || '?').charAt(0)) + '</div>' +
        '<span style="flex:1;font-size:0.84rem;color:var(--navy-dk);">' + PS.escapeHTML(PS.profileName(a.client_id)) + '</span>' +
        '<span class="ps-badge ps-badge-' + (PS.APP_STATUS_BADGE[a.status] || 'gray') + '">' + PS.escapeHTML(PS.labelFor(window.CALESTIA_APPLICATION_STATUSES, a.status)) + '</span></div>';
    }).join('');
  }

  /* ------------------------------------------------------------------
     Clients
     ------------------------------------------------------------------ */
  function loadClients() {
    supabaseClient.from('profiles')
      .select('*, applications(status, updated_at), documents(document_type, status, file_path)')
      .eq('role', 'client')
      .then(function (result) {
        clientsCache = result.data || [];
        document.getElementById('psClientsCount').textContent = clientsCache.length + ' total clients';
        renderClientsTable();
      })
      .catch(function () {
        document.getElementById('clientsTableBody').innerHTML = '<tr><td colspan="5" class="ps-table-hint">Could not load clients.</td></tr>';
      });

    var search = document.getElementById('clientSearch');
    var filter = document.getElementById('clientStatusFilter');
    if (!search.dataset.wired) { search.dataset.wired = '1'; search.addEventListener('input', renderClientsTable); }
    if (!filter.dataset.wired) { filter.dataset.wired = '1'; filter.addEventListener('change', renderClientsTable); }
  }

  function renderClientsTable() {
    var tbody = document.getElementById('clientsTableBody');
    var query = (document.getElementById('clientSearch').value || '').trim().toLowerCase();
    var statusFilter = document.getElementById('clientStatusFilter').value || '';

    var rows = clientsCache.filter(function (c) {
      var app = (c.applications && c.applications[0]) || null;
      var matchesQuery = !query || (c.full_name || '').toLowerCase().indexOf(query) !== -1 || (c.email || '').toLowerCase().indexOf(query) !== -1;
      var matchesStatus = !statusFilter || (app && app.status === statusFilter);
      return matchesQuery && matchesStatus;
    });

    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="5" class="ps-table-hint">No clients match.</td></tr>'; return; }

    tbody.innerHTML = rows.map(function (c) {
      var app = (c.applications && c.applications[0]) || null;
      var docs = c.documents || [];
      var totalTypes = (window.CALESTIA_DOCUMENT_TYPES || []).length;
      return '<tr>' +
        '<td style="display:flex;align-items:center;gap:9px;"><div class="ps-avatar ps-avatar-sm">' + PS.escapeHTML((c.full_name || '?').charAt(0)) + '</div><strong>' + PS.escapeHTML(c.full_name || 'Unnamed') + '</strong></td>' +
        '<td>' + PS.escapeHTML(c.email) + '</td>' +
        '<td>' + (app ? '<span class="ps-badge ps-badge-' + (PS.APP_STATUS_BADGE[app.status] || 'gray') + '">' + PS.escapeHTML(PS.labelFor(window.CALESTIA_APPLICATION_STATUSES, app.status)) + '</span>' : '—') + '</td>' +
        '<td>' + docs.filter(function (d) { return d.file_path; }).length + '/' + totalTypes + ' uploaded</td>' +
        '<td><button type="button" class="ps-btn ps-btn-outline ps-btn-sm js-open-client" data-client-id="' + c.id + '">View</button></td>' +
      '</tr>';
    }).join('');

    tbody.querySelectorAll('.js-open-client').forEach(function (btn) {
      btn.addEventListener('click', function () { PS.openClientDetail(btn.getAttribute('data-client-id')); });
    });
  }

  /* ------------------------------------------------------------------
     Applications
     ------------------------------------------------------------------ */
  function loadApplications() { renderApplications(); }

  function renderApplications() {
    var container = document.getElementById('psApplicationsList');
    var activeTab = document.querySelector('#psAppStatusTabs .ps-tab-btn.is-active');
    var status = activeTab ? activeTab.getAttribute('data-status') : '';

    var rows = clientsCache.filter(function (c) {
      var app = (c.applications && c.applications[0]) || null;
      return !status || (app && app.status === status);
    });

    if (!rows.length) { container.innerHTML = '<p class="ps-hint">No applications match.</p>'; return; }

    container.innerHTML = rows.map(function (c) {
      var app = (c.applications && c.applications[0]) || null;
      return '<div class="ps-card ps-card-pad" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">' +
        '<div class="ps-avatar">' + PS.escapeHTML((c.full_name || '?').charAt(0)) + '</div>' +
        '<div style="flex:1;min-width:160px;"><p style="font-weight:600;color:var(--navy-dk);font-size:0.88rem;">' + PS.escapeHTML(c.full_name || 'Unnamed') + '</p>' +
        '<p class="ps-hint">' + PS.escapeHTML(c.email) + '</p></div>' +
        (app ? '<span class="ps-badge ps-badge-' + (PS.APP_STATUS_BADGE[app.status] || 'gray') + '">' + PS.escapeHTML(PS.labelFor(window.CALESTIA_APPLICATION_STATUSES, app.status)) + '</span>' : '') +
        '<button type="button" class="ps-btn ps-btn-outline ps-btn-sm js-open-client" data-client-id="' + c.id + '">Review</button>' +
      '</div>';
    }).join('');

    container.querySelectorAll('.js-open-client').forEach(function (btn) {
      btn.addEventListener('click', function () { PS.openClientDetail(btn.getAttribute('data-client-id')); });
    });
  }

  /* ------------------------------------------------------------------
     Documents — cross-client review queue
     ------------------------------------------------------------------ */
  function loadDocumentQueue() {
    supabaseClient.from('documents').select('*').not('file_path', 'is', null).in('status', ['pending', 'under_review']).order('uploaded_at', { ascending: true })
      .then(function (result) { renderDocumentQueue(result.data || []); })
      .catch(function () { document.getElementById('psDocReviewQueue').innerHTML = '<p class="ps-hint">Could not load documents.</p>'; });
  }

  function renderDocumentQueue(rows) {
    var container = document.getElementById('psDocReviewQueue');
    if (!rows.length) { container.innerHTML = '<p class="ps-hint">Nothing pending review right now.</p>'; return; }

    container.innerHTML = rows.map(function (d) {
      return '<div class="ps-card ps-card-pad" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;" data-client-id="' + d.client_id + '" data-doc-type="' + d.document_type + '">' +
        '<div class="ps-avatar ps-avatar-sm">' + PS.escapeHTML((PS.profileName(d.client_id) || '?').charAt(0)) + '</div>' +
        '<div style="flex:1;min-width:180px;"><p style="font-weight:600;color:var(--navy-dk);font-size:0.86rem;">' + PS.escapeHTML(PS.labelFor(window.CALESTIA_DOCUMENT_TYPES, d.document_type)) + '</p>' +
        '<p class="ps-hint">' + PS.escapeHTML(PS.profileName(d.client_id)) + ' · Uploaded ' + PS.timeAgo(d.uploaded_at) + '</p></div>' +
        '<div class="ps-doc-actions" style="flex-wrap:nowrap;">' +
        '<button type="button" class="ps-btn ps-btn-outline ps-btn-sm" data-q-action="preview">Preview</button>' +
        '<button type="button" class="ps-btn ps-btn-primary ps-btn-sm" data-q-action="verify">Verify</button>' +
        '<button type="button" class="ps-btn ps-btn-danger ps-btn-sm" data-q-action="reject">Reject</button>' +
        '</div></div>';
    }).join('');

    container.querySelectorAll('[data-q-action]').forEach(function (btn) {
      var row = btn.closest('[data-client-id]');
      btn.addEventListener('click', function () {
        PS.handleDocAction(row.getAttribute('data-client-id'), row.getAttribute('data-doc-type'), btn.getAttribute('data-q-action'));
      });
    });
  }

  /* ------------------------------------------------------------------
     Remarks — system-wide feed
     ------------------------------------------------------------------ */
  function loadRemarks() {
    supabaseClient.from('remarks').select('*').order('created_at', { ascending: false }).limit(150)
      .then(function (result) {
        var rows = result.data || [];
        var el = document.getElementById('psRemarksFeed');
        if (!rows.length) { el.innerHTML = '<p class="ps-hint">No remarks yet.</p>'; return; }
        el.innerHTML = rows.map(function (r) {
          return '<div class="ps-card ps-card-pad">' +
            '<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;">' +
            '<p style="font-weight:600;font-size:0.85rem;color:var(--navy-dk);">' + PS.escapeHTML(PS.profileName(r.author_id)) + ' → ' + PS.escapeHTML(PS.profileName(r.client_id)) + '</p>' +
            '<span class="ps-hint" style="flex-shrink:0;">' + PS.formatDate(r.created_at) + '</span></div>' +
            '<p style="font-size:0.85rem;color:#445a73;line-height:1.5;background:var(--ps-bg);border-radius:10px;padding:10px 12px;">' + PS.escapeHTML(r.message) + '</p></div>';
        }).join('');
      })
      .catch(function () { document.getElementById('psRemarksFeed').innerHTML = '<p class="ps-hint">Could not load remarks.</p>'; });
  }

  /* ------------------------------------------------------------------
     Notifications — staff-facing activity feed
     ------------------------------------------------------------------ */
  function loadNotifications() {
    supabaseClient.from('notifications').select('*').order('created_at', { ascending: false }).limit(50)
      .then(function (result) {
        var rows = result.data || [];
        var listHTML = rows.length ? rows.map(function (n) {
          return '<div class="ps-card ps-card-pad"><p style="font-size:0.85rem;color:var(--navy-dk);line-height:1.5;">' + PS.escapeHTML(PS.profileName(n.client_id)) + ' — ' + PS.escapeHTML(n.message) + '</p>' +
            '<p class="ps-hint" style="margin-top:4px;">' + PS.timeAgo(n.created_at) + '</p></div>';
        }).join('') : '<p class="ps-hint">No notifications yet.</p>';
        document.getElementById('psNotificationsFeed').innerHTML = listHTML;
        document.getElementById('psBellList').innerHTML = rows.length
          ? rows.slice(0, 8).map(function (n) { return '<div style="padding:10px 14px;border-bottom:1px solid var(--ps-border);"><p style="font-size:0.8rem;color:var(--navy-dk);">' + PS.escapeHTML(PS.profileName(n.client_id)) + ' — ' + PS.escapeHTML(n.message) + '</p><p class="ps-hint" style="font-size:0.68rem;margin-top:2px;">' + PS.timeAgo(n.created_at) + '</p></div>'; }).join('')
          : '<p class="ps-hint" style="padding:16px;">Nothing yet.</p>';
        if (rows.length) document.getElementById('psBellDot').classList.remove('is-hidden');
      })
      .catch(function () {});
  }

  /* ------------------------------------------------------------------
     Internal Notes — system-wide feed
     ------------------------------------------------------------------ */
  function loadNotes() {
    supabaseClient.from('internal_notes').select('*').order('created_at', { ascending: false }).limit(150)
      .then(function (result) {
        var rows = result.data || [];
        var el = document.getElementById('psNotesFeed');
        if (!rows.length) { el.innerHTML = '<p class="ps-hint">No internal notes yet.</p>'; return; }
        el.innerHTML = rows.map(function (n) {
          return '<div class="ps-card ps-card-pad">' +
            '<div style="display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;">' +
            '<p style="font-weight:600;font-size:0.85rem;color:var(--navy-dk);">' + PS.escapeHTML(PS.profileName(n.author_id)) + ' — re: ' + PS.escapeHTML(PS.profileName(n.client_id)) + '</p>' +
            '<span class="ps-hint" style="flex-shrink:0;">' + PS.formatDate(n.created_at) + '</span></div>' +
            '<p style="font-size:0.85rem;color:#445a73;line-height:1.5;">' + PS.escapeHTML(n.note) + '</p></div>';
        }).join('');
      })
      .catch(function () { document.getElementById('psNotesFeed').innerHTML = '<p class="ps-hint">Could not load notes.</p>'; });
  }

  /* ------------------------------------------------------------------
     Settings
     ------------------------------------------------------------------ */
  function loadSettings() { PS.wireSettingsPanel(); }
})();
