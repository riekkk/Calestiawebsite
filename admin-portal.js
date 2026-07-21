/* ==========================================================================
   Calestia Travel & Tours — admin-portal.js
   ==========================================================================
   Page-specific controller for admin-portal.html. Reuses the session
   gate, Client Detail Modal, realtime plumbing and Settings panel from
   staff-shared.js (window.PSStaff) — owns only Admin-specific screens
   (Employees, Applications/Documents overviews, Audit Logs, Reports).
   ========================================================================== */
(function () {
  'use strict';

  var PS = window.PSStaff;
  var supabaseClient = null;
  var clientsCache = [];
  var employeesCache = [];
  var applicationsCache = [];
  var documentsCache = [];

  var PAGE_META = {
    dashboard: ['Dashboard', 'Administrator Portal · Calestia Travel & Tours'],
    payments: ['Payments', 'Review and verify client payment submissions'],
    employees: ['Employees', 'Invite, activate, and manage staff accounts'],
    clients: ['Clients', 'All registered clients'],
    applications: ['Applications', 'Organization-wide visa applications'],
    documents: ['Documents', 'Across all clients and employees'],
    audit: ['Audit Logs', 'Complete record of all staff actions'],
    notifications: ['Notifications', 'Recent updates across all clients'],
    reports: ['Reports', 'Performance insights across the organization'],
    settings: ['Settings', 'Your account preferences']
  };

  document.addEventListener('DOMContentLoaded', function () {
    PS.gate('admin', onReady);
  });

  var PANEL_LOADERS = {
    payments: PS.loadPaymentsQueue,
    employees: loadEmployees,
    clients: loadClients,
    applications: loadApplications,
    documents: loadDocumentsOverview,
    audit: loadAuditLog,
    notifications: loadNotifications,
    reports: loadReports,
    settings: loadSettings
  };

  function onReady(profile) {
    supabaseClient = PS.client();

    PS.injectSharedModals();
    PS.wireClientDetailModal(refreshAllData);
    PS.wireShell(PAGE_META, PANEL_LOADERS);

    var pendingCard = document.getElementById('statPendingVerificationsCard');
    if (pendingCard) pendingCard.addEventListener('click', function () { PS.goToPendingPayments(PAGE_META, PANEL_LOADERS); });

    wireInviteModal();
    wireEmployeeTabs();

    populateStatusFilterOptions();
    PS.loadAllProfiles().then(function () {
      loadDashboard();
      loadClients();
    });

    PS.subscribeRealtime({
      onCoreChange: refreshAllData,
      onProfilesChange: function () { PS.loadAllProfiles().then(loadEmployees); }
    });
    PS.startPaymentsBadgePolling();
  }

  function refreshAllData() {
    loadDashboard();
    loadClients();
    var active = document.querySelector('.ps-panel.is-active').getAttribute('data-panel');
    if (active === 'payments') PS.loadPaymentsQueue();
    if (active === 'applications') loadApplications();
    if (active === 'documents') loadDocumentsOverview();
    if (active === 'audit') loadAuditLog();
    if (active === 'reports') loadReports();
  }

  function populateStatusFilterOptions() {
    var select = document.getElementById('clientStatusFilter');
    (window.CALESTIA_APPLICATION_STATUSES || []).forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.key; opt.textContent = s.label;
      select.appendChild(opt);
    });
  }

  /* ------------------------------------------------------------------
     Dashboard
     ------------------------------------------------------------------ */
  function loadDashboard() {
    Promise.all([
      supabaseClient.from('profiles').select('id').eq('role', 'client'),
      supabaseClient.from('profiles').select('id').in('role', ['employee', 'admin']).eq('status', 'active'),
      supabaseClient.from('applications').select('*'),
      supabaseClient.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(6)
    ]).then(function (results) {
      var clients = results[0].data || [];
      var activeStaff = results[1].data || [];
      var applications = results[2].data || [];
      var recentAudit = results[3].data || [];

      setText('statTotalClients', clients.length);
      setText('statActiveEmployees', activeStaff.length);

      var now = new Date();
      var thisMonthCount = applications.filter(function (a) {
        var d = new Date(a.created_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      }).length;
      setText('statMonthlyApps', thisMonthCount);

      var avgDays = applications.length
        ? Math.round(applications.reduce(function (sum, a) { return sum + (Date.now() - new Date(a.created_at).getTime()) / 86400000; }, 0) / applications.length)
        : 0;
      setText('statAvgProcessing', avgDays + 'd');

      applicationsCache = applications;
      renderMonthlyChart('psMonthlyChart', applications);

      var approved = applications.filter(function (a) { return ['visa_approved', 'passport_ready_for_pickup', 'completed'].indexOf(a.status) !== -1; }).length;
      var denied = applications.filter(function (a) { return a.status === 'visa_denied'; }).length;
      renderApprovalDonut('psApprovalDonut', approved, denied);

      renderRecentAudit(recentAudit);
    }).catch(function () {});

    PS.refreshPaymentsBadge().then(function (count) { setText('statPendingVerifications', count); });

    loadStaffActivity();
  }

  function setText(id, value) { var el = document.getElementById(id); if (el) el.textContent = value; }

  function renderMonthlyChart(elId, applications) {
    var months = [];
    var now = new Date();
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: d.getFullYear() + '-' + d.getMonth(), label: d.toLocaleDateString('en-US', { month: 'short' }), count: 0 });
    }
    applications.forEach(function (a) {
      var d = new Date(a.created_at);
      var key = d.getFullYear() + '-' + d.getMonth();
      var m = months.filter(function (m) { return m.key === key; })[0];
      if (m) m.count++;
    });
    var max = Math.max.apply(null, months.map(function (m) { return m.count; }).concat([1]));
    document.getElementById(elId).innerHTML = months.map(function (m) {
      var pct = Math.round((m.count / max) * 100);
      return '<div class="ps-vbar-col"><div class="ps-vbar" style="height:120px;"><div class="ps-vbar-fill" style="height:' + Math.max(pct, 3) + '%;"></div></div><span>' + m.label + '</span></div>';
    }).join('');
  }

  function renderApprovalDonut(elId, approved, denied) {
    var total = approved + denied;
    var pct = total ? Math.round((approved / total) * 100) : 0;
    var r = 54, c = 2 * Math.PI * r;
    var dash = (pct / 100) * c;
    document.getElementById(elId).innerHTML =
      '<div class="ps-donut-wrap"><div class="ps-donut"><svg width="132" height="132" viewBox="0 0 132 132">' +
      '<circle cx="66" cy="66" r="' + r + '" fill="none" stroke="var(--ps-border)" stroke-width="14"/>' +
      '<circle cx="66" cy="66" r="' + r + '" fill="none" stroke="var(--navy)" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + c + '"/>' +
      '</svg><div class="ps-donut-center"><strong>' + pct + '%</strong><span>Approved</span></div></div>' +
      '<div style="margin-top:14px;width:100%;display:flex;justify-content:space-between;font-size:0.78rem;color:var(--ps-text-dim);">' +
      '<span>✓ ' + approved + '</span><span>✕ ' + denied + '</span></div></div>';
  }

  function renderRecentAudit(rows) {
    var el = document.getElementById('psRecentAudit');
    if (!rows.length) { el.innerHTML = '<p class="ps-hint">No activity recorded yet.</p>'; return; }
    el.innerHTML = rows.map(function (r) {
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--ps-border);">' +
        '<div class="ps-avatar ps-avatar-sm" style="background:#8b5cf6;">' + PS.escapeHTML((r.actor_name || '?').charAt(0)) + '</div>' +
        '<div style="flex:1;min-width:0;"><p style="font-size:0.8rem;color:var(--navy-dk);">' + PS.escapeHTML(r.actor_name || 'Unknown') + '</p>' +
        '<p class="ps-hint" style="font-size:0.72rem;">' + PS.escapeHTML(r.action) + (r.client_id ? ' · ' + PS.escapeHTML(PS.profileName(r.client_id)) : '') + '</p></div>' +
        '<span class="ps-hint" style="font-size:0.7rem;flex-shrink:0;">' + PS.timeAgo(r.created_at) + '</span></div>';
    }).join('');
  }

  function loadStaffActivity() {
    var since = new Date(Date.now() - 30 * 86400000).toISOString();
    supabaseClient.from('audit_logs').select('actor_id, actor_name').gte('created_at', since).limit(1000)
      .then(function (result) {
        var rows = result.data || [];
        var counts = {};
        rows.forEach(function (r) {
          var key = r.actor_id || r.actor_name || 'unknown';
          if (!counts[key]) counts[key] = { name: r.actor_name || 'Unknown', count: 0 };
          counts[key].count++;
        });
        var list = Object.keys(counts).map(function (k) { return counts[k]; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 6);
        renderStaffActivity('psStaffActivity', list);
      })
      .catch(function () {});
  }

  function renderStaffActivity(elId, list) {
    var el = document.getElementById(elId);
    if (!list.length) { el.innerHTML = '<p class="ps-hint">No staff activity in the last 30 days.</p>'; return; }
    var max = Math.max.apply(null, list.map(function (l) { return l.count; }));
    el.innerHTML = list.map(function (l) {
      var pct = Math.round((l.count / max) * 100);
      return '<div style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:4px;">' +
        '<span style="font-weight:600;color:var(--navy-dk);">' + PS.escapeHTML(l.name) + '</span><span class="ps-hint">' + l.count + ' actions</span></div>' +
        '<div class="ps-bar-track"><div class="ps-bar-fill" style="width:' + pct + '%;"></div></div></div>';
    }).join('');
  }

  /* ------------------------------------------------------------------
     Employees — invites now go through Supabase Auth itself (the
     invite-employee Edge Function), so a "pending" employee is just a
     profiles row with status='pending', same as any other status. No
     separate invitations table/UI to keep in sync anymore.
     ------------------------------------------------------------------ */
  function wireEmployeeTabs() {
    document.querySelectorAll('[data-emp-tab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('[data-emp-tab]').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
        renderEmployeesGrid(btn.getAttribute('data-emp-tab'));
      });
    });
  }

  function loadEmployees() {
    supabaseClient.from('profiles').select('*').in('role', ['employee', 'admin']).order('created_at', { ascending: false })
      .then(function (result) {
        employeesCache = result.data || [];
        var activeTabBtn = document.querySelector('[data-emp-tab].is-active');
        document.getElementById('psEmployeesCount').textContent =
          employeesCache.filter(function (e) { return e.status === 'active'; }).length + ' active · ' +
          employeesCache.filter(function (e) { return e.status === 'pending'; }).length + ' pending · ' +
          employeesCache.filter(function (e) { return e.status === 'suspended' || e.status === 'disabled'; }).length + ' suspended';
        renderEmployeesGrid(activeTabBtn ? activeTabBtn.getAttribute('data-emp-tab') : 'active');
      })
      .catch(function () { document.getElementById('psEmployeesGrid').innerHTML = '<p class="ps-hint">Could not load employees.</p>'; });
  }

  function renderEmployeesGrid(tab) {
    var grid = document.getElementById('psEmployeesGrid');
    var wanted = tab === 'suspended' ? ['suspended', 'disabled'] : tab === 'pending' ? ['pending'] : ['active'];

    var rows = employeesCache.filter(function (e) { return wanted.indexOf(e.status) !== -1; });
    if (!rows.length) { grid.innerHTML = '<p class="ps-hint">No accounts here.</p>'; return; }

    grid.innerHTML = rows.map(function (p) {
      var roleLabel = p.role.charAt(0).toUpperCase() + p.role.slice(1);
      var statusColor = p.status === 'active' ? 'green' : p.status === 'pending' ? 'amber' : 'red';
      var actions = employeeActionButtons(p);
      return '<div class="ps-card ps-card-pad">' +
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">' +
        '<div class="ps-avatar" style="background:' + (p.status === 'active' ? 'var(--navy)' : '#9ca3af') + ';">' + PS.escapeHTML((p.full_name || '?').charAt(0)) + '</div>' +
        '<div style="flex:1;min-width:0;"><p style="font-weight:700;font-size:0.88rem;color:var(--navy-dk);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + PS.escapeHTML(p.full_name || 'Unnamed') + '</p>' +
        '<p class="ps-hint">' + roleLabel + '</p></div>' +
        '<span class="ps-badge ps-badge-' + statusColor + '">' + p.status.charAt(0).toUpperCase() + p.status.slice(1) + '</span></div>' +
        '<p class="ps-hint" style="margin-bottom:12px;word-break:break-all;">' + PS.escapeHTML(p.email) + '</p>' +
        (p.status === 'pending' ? '<p class="ps-hint" style="margin-bottom:12px;">Waiting for them to open their invite email and set a password.</p>' : '') +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' + actions + '</div></div>';
    }).join('');

    grid.querySelectorAll('[data-emp-action]').forEach(function (btn) {
      btn.addEventListener('click', function () { handleEmployeeAction(btn.getAttribute('data-emp-action'), btn.getAttribute('data-id')); });
    });
  }

  function employeeActionButtons(p) {
    var actions = [];
    if (p.role === 'employee') actions.push(btnHTML('make_admin', 'Make Admin', 'ps-btn-outline'));
    if (p.role === 'admin') actions.push(btnHTML('make_employee', 'Demote to Employee', 'ps-btn-outline'));
    if (p.status === 'active') {
      actions.push(btnHTML('suspend', 'Suspend', 'ps-btn-danger'));
    } else {
      actions.push(btnHTML('reactivate', p.status === 'pending' ? 'Activate' : 'Reactivate', 'ps-btn-primary'));
    }
    actions.push(btnHTML('remove', 'Remove Access', 'ps-btn-danger'));
    return actions.join('');
    function btnHTML(action, label, cls) {
      return '<button type="button" class="ps-btn ' + cls + ' ps-btn-sm" data-emp-action="' + action + '" data-id="' + p.id + '">' + label + '</button>';
    }
  }

  var SELF_RISK_ACTIONS = ['suspend', 'disable', 'make_client', 'remove'];

  function handleEmployeeAction(action, targetId) {
    if (targetId === PS.profile.id && SELF_RISK_ACTIONS.indexOf(action) !== -1) {
      if (!window.confirm('This will reduce your own access. Continue?')) return;
    }
    var payload = {};
    if (action === 'make_employee') { payload.role = 'employee'; payload.status = 'pending'; }
    if (action === 'make_admin') { payload.role = 'admin'; payload.status = 'pending'; }
    if (action === 'activate' || action === 'reactivate') payload.status = 'active';
    if (action === 'suspend') payload.status = 'suspended';
    if (action === 'disable') payload.status = 'disabled';
    if (action === 'remove') { payload.role = 'client'; payload.status = 'active'; }

    supabaseClient.from('profiles').update(payload).eq('id', targetId)
      .then(function (result) {
        if (result.error) { PS.toast(result.error.message || 'Could not update account.', true); return; }
        PS.toast('Account updated.');
        loadEmployees();
      })
      .catch(function () { PS.toast('Something went wrong.', true); });
  }

  /* ---- Invite (Supabase Auth native — see supabase/functions/invite-employee) ---- */
  function wireInviteModal() {
    var modal = document.getElementById('inviteModal');
    document.getElementById('psInviteBtn').addEventListener('click', function () { openModal('inviteModal'); });
    modal.querySelectorAll('[data-close-modal]').forEach(function (el) {
      el.addEventListener('click', function () { closeModal('inviteModal'); });
    });

    document.getElementById('inviteEmployeeForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var email = document.getElementById('inviteEmail').value.trim();
      var role = document.getElementById('inviteRole').value;
      if (!email) { PS.toast('Enter an email address.', true); return; }

      var btn = e.target.querySelector('button[type="submit"]');
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending…';

      supabaseClient.functions.invoke('invite-employee', { body: { email: email, role: role } })
        .then(function (result) {
          btn.disabled = false;
          btn.textContent = originalText;
          if (result.error || !result.data || !result.data.success) {
            var message = (result.data && result.data.error) || (result.error && result.error.message) || 'Could not send the invitation.';
            PS.toast(message, true);
            return;
          }
          PS.toast('Invitation sent — ' + email + ' will receive an email to set up their account.');
          document.getElementById('inviteEmployeeForm').reset();
          closeModal('inviteModal');
          loadEmployees();
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = originalText;
          PS.toast('Something went wrong. Please try again.', true);
        });
    });
  }

  /* ------------------------------------------------------------------
     Clients (org-wide; opens the same shared Client Detail Modal)
     ------------------------------------------------------------------ */
  function loadClients() {
    supabaseClient.from('profiles').select('*, applications(status, updated_at), documents(document_type, status, file_path)').eq('role', 'client')
      .then(function (result) {
        clientsCache = result.data || [];
        document.getElementById('psAdminClientsCount').textContent = clientsCache.length + ' registered clients';
        renderClientsTable();
      })
      .catch(function () { document.getElementById('clientsTableBody').innerHTML = '<tr><td colspan="5" class="ps-table-hint">Could not load clients.</td></tr>'; });

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
     Applications overview
     ------------------------------------------------------------------ */
  function loadApplications() {
    supabaseClient.from('applications').select('*').order('updated_at', { ascending: false })
      .then(function (result) {
        var rows = result.data || [];
        applicationsCache = rows;
        renderAppStats(rows);
        renderAppTable(rows);
      })
      .catch(function () { document.getElementById('psAppTableBody').innerHTML = '<tr><td colspan="4" class="ps-table-hint">Could not load applications.</td></tr>'; });
  }

  function renderAppStats(rows) {
    var approved = rows.filter(function (a) { return ['visa_approved', 'passport_ready_for_pickup', 'completed'].indexOf(a.status) !== -1; }).length;
    var denied = rows.filter(function (a) { return a.status === 'visa_denied'; }).length;
    var active = rows.length - approved - denied;
    var tiles = [
      ['Total', rows.length, 'var(--navy)'],
      ['Active', active, '#8b5cf6'],
      ['Approved', approved, '#10b981'],
      ['Denied', denied, '#ef4444']
    ];
    document.getElementById('psAppStats').innerHTML = tiles.map(function (t) {
      return '<div class="ps-stat" style="text-align:center;"><p class="ps-stat-value" style="color:' + t[2] + ';">' + t[1] + '</p><p class="ps-stat-label">' + t[0] + '</p></div>';
    }).join('');
  }

  function renderAppTable(rows) {
    var tbody = document.getElementById('psAppTableBody');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="4" class="ps-table-hint">No applications yet.</td></tr>'; return; }
    tbody.innerHTML = rows.slice(0, 200).map(function (a) {
      return '<tr>' +
        '<td>' + PS.escapeHTML(PS.profileName(a.client_id)) + '</td>' +
        '<td><span class="ps-badge ps-badge-' + (PS.APP_STATUS_BADGE[a.status] || 'gray') + '">' + PS.escapeHTML(PS.labelFor(window.CALESTIA_APPLICATION_STATUSES, a.status)) + '</span></td>' +
        '<td>' + PS.formatDate(a.updated_at) + '</td>' +
        '<td><button type="button" class="ps-btn ps-btn-outline ps-btn-sm js-open-client" data-client-id="' + a.client_id + '">Review</button></td>' +
      '</tr>';
    }).join('');
    tbody.querySelectorAll('.js-open-client').forEach(function (btn) {
      btn.addEventListener('click', function () { PS.openClientDetail(btn.getAttribute('data-client-id')); });
    });
  }

  /* ------------------------------------------------------------------
     Documents overview
     ------------------------------------------------------------------ */
  function loadDocumentsOverview() {
    supabaseClient.from('documents').select('*').not('file_path', 'is', null).order('uploaded_at', { ascending: false })
      .then(function (result) {
        var rows = result.data || [];
        documentsCache = rows;
        renderDocStats(rows);
        renderDocTable(rows);
      })
      .catch(function () { document.getElementById('psDocTableBody').innerHTML = '<tr><td colspan="4" class="ps-table-hint">Could not load documents.</td></tr>'; });
  }

  function renderDocStats(rows) {
    var verified = rows.filter(function (d) { return d.status === 'verified'; }).length;
    var pending = rows.filter(function (d) { return d.status === 'pending' || d.status === 'under_review'; }).length;
    var rejected = rows.filter(function (d) { return d.status === 'rejected' || d.status === 'reupload_requested'; }).length;
    var tiles = [['Total', rows.length, 'var(--navy)'], ['Verified', verified, '#10b981'], ['Pending', pending, '#f59e0b'], ['Rejected', rejected, '#ef4444']];
    document.getElementById('psDocStats').innerHTML = tiles.map(function (t) {
      return '<div class="ps-stat" style="text-align:center;"><p class="ps-stat-value" style="color:' + t[2] + ';">' + t[1] + '</p><p class="ps-stat-label">' + t[0] + '</p></div>';
    }).join('');
  }

  function renderDocTable(rows) {
    var tbody = document.getElementById('psDocTableBody');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="4" class="ps-table-hint">No documents uploaded yet.</td></tr>'; return; }
    tbody.innerHTML = rows.slice(0, 200).map(function (d) {
      return '<tr>' +
        '<td>' + PS.escapeHTML(PS.profileName(d.client_id)) + '</td>' +
        '<td>' + PS.escapeHTML(PS.labelFor(window.CALESTIA_DOCUMENT_TYPES, d.document_type)) + '</td>' +
        '<td><span class="ps-badge ps-badge-' + (PS.DOC_STATUS_BADGE[d.status] || 'gray') + '">' + PS.escapeHTML(PS.labelFor(window.CALESTIA_DOCUMENT_STATUSES, d.status)) + '</span></td>' +
        '<td>' + PS.formatDate(d.uploaded_at) + '</td>' +
      '</tr>';
    }).join('');
  }

  /* ------------------------------------------------------------------
     Audit Logs
     ------------------------------------------------------------------ */
  var auditCache = [];
  function loadAuditLog() {
    supabaseClient.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(200)
      .then(function (result) { auditCache = result.data || []; renderAuditTable(); })
      .catch(function () { document.getElementById('auditTableBody').innerHTML = '<tr><td colspan="5" class="ps-table-hint">Could not load audit log.</td></tr>'; });

    var exportBtn = document.getElementById('psExportAuditBtn');
    if (!exportBtn.dataset.wired) {
      exportBtn.dataset.wired = '1';
      exportBtn.addEventListener('click', function () {
        PS.exportCSV('calestia-audit-log.csv', auditCache.map(function (r) {
          return { when: r.created_at, staff: r.actor_name, action: r.action, client: PS.profileName(r.client_id), field: r.field_changed, old_value: r.old_value, new_value: r.new_value };
        }), ['when', 'staff', 'action', 'client', 'field', 'old_value', 'new_value']);
      });
    }
  }

  function renderAuditTable() {
    var tbody = document.getElementById('auditTableBody');
    if (!auditCache.length) { tbody.innerHTML = '<tr><td colspan="5" class="ps-table-hint">No activity recorded yet.</td></tr>'; return; }
    tbody.innerHTML = auditCache.map(function (r) {
      var change = r.field_changed ? (PS.escapeHTML(r.field_changed) + ': ' + PS.escapeHTML(r.old_value || '—') + ' → ' + PS.escapeHTML(r.new_value || '—')) : '';
      return '<tr><td>' + PS.formatDate(r.created_at) + '</td><td>' + PS.escapeHTML(r.actor_name || 'Unknown') + '</td>' +
        '<td>' + PS.escapeHTML(r.action) + '</td><td>' + PS.escapeHTML(PS.profileName(r.client_id)) + '</td><td>' + change + '</td></tr>';
    }).join('');
  }

  /* ------------------------------------------------------------------
     Notifications — staff feed + account-change alerts from audit_logs
     ------------------------------------------------------------------ */
  function loadNotifications() {
    Promise.all([
      supabaseClient.from('notifications').select('*').order('created_at', { ascending: false }).limit(30),
      supabaseClient.from('audit_logs').select('*').in('action', ['Changed account role', 'Changed account status', 'Invited employee']).order('created_at', { ascending: false }).limit(20)
    ]).then(function (results) {
      var notifs = (results[0].data || []).map(function (n) { return { when: n.created_at, text: PS.profileName(n.client_id) + ' — ' + n.message }; });
      var alerts = (results[1].data || []).map(function (a) { return { when: a.created_at, text: a.action + (a.new_value ? ': ' + a.new_value : ''), alert: true }; });
      var merged = notifs.concat(alerts).sort(function (a, b) { return new Date(b.when) - new Date(a.when); }).slice(0, 40);

      document.getElementById('psNotificationsFeed').innerHTML = merged.length ? merged.map(function (n) {
        return '<div class="ps-card ps-card-pad" style="' + (n.alert ? 'border-left:3px solid #f59e0b;' : '') + '">' +
          '<p style="font-size:0.85rem;color:var(--navy-dk);line-height:1.5;">' + PS.escapeHTML(n.text) + '</p>' +
          '<p class="ps-hint" style="margin-top:4px;">' + PS.timeAgo(n.when) + '</p></div>';
      }).join('') : '<p class="ps-hint">No notifications yet.</p>';

      var bellRows = merged.slice(0, 8);
      document.getElementById('psBellList').innerHTML = bellRows.length
        ? bellRows.map(function (n) { return '<div style="padding:10px 14px;border-bottom:1px solid var(--ps-border);"><p style="font-size:0.8rem;color:var(--navy-dk);">' + PS.escapeHTML(n.text) + '</p><p class="ps-hint" style="font-size:0.68rem;margin-top:2px;">' + PS.timeAgo(n.when) + '</p></div>'; }).join('')
        : '<p class="ps-hint" style="padding:16px;">Nothing yet.</p>';
      if (merged.length) document.getElementById('psBellDot').classList.remove('is-hidden');
    }).catch(function () {});
  }

  /* ------------------------------------------------------------------
     Reports
     ------------------------------------------------------------------ */
  function loadReports() {
    var rows = applicationsCache.length ? applicationsCache : [];
    var reload = !applicationsCache.length;
    var p = reload ? supabaseClient.from('applications').select('*') : Promise.resolve({ data: applicationsCache });

    p.then(function (result) {
      var apps = result.data || [];
      var now = new Date();
      var thisMonth = apps.filter(function (a) { var d = new Date(a.created_at); return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth(); }).length;
      var approved = apps.filter(function (a) { return ['visa_approved', 'passport_ready_for_pickup', 'completed'].indexOf(a.status) !== -1; }).length;
      var denied = apps.filter(function (a) { return a.status === 'visa_denied'; }).length;
      var decided = approved + denied;
      var approvalRate = decided ? Math.round((approved / decided) * 100) : 0;
      var avgDays = apps.length ? Math.round(apps.reduce(function (s, a) { return s + (Date.now() - new Date(a.created_at).getTime()) / 86400000; }, 0) / apps.length) : 0;

      document.getElementById('psReportStats').innerHTML = [
        ['Apps This Month', thisMonth, 'var(--navy)'],
        ['Approval Rate', approvalRate + '%', '#10b981'],
        ['Denial Rate', decided ? Math.round((denied / decided) * 100) + '%' : '0%', '#ef4444'],
        ['Avg Processing', avgDays + 'd', '#f59e0b']
      ].map(function (t) { return '<div class="ps-stat" style="text-align:center;"><p class="ps-stat-value" style="color:' + t[2] + ';">' + t[1] + '</p><p class="ps-stat-label">' + t[0] + '</p></div>'; }).join('');

      renderMonthlyChart('psReportMonthlyChart', apps);
    });

    var since = new Date(Date.now() - 30 * 86400000).toISOString();
    supabaseClient.from('audit_logs').select('actor_id, actor_name').gte('created_at', since).limit(1000)
      .then(function (result) {
        var counts = {};
        (result.data || []).forEach(function (r) {
          var key = r.actor_id || r.actor_name || 'unknown';
          if (!counts[key]) counts[key] = { name: r.actor_name || 'Unknown', count: 0 };
          counts[key].count++;
        });
        var list = Object.keys(counts).map(function (k) { return counts[k]; }).sort(function (a, b) { return b.count - a.count; }).slice(0, 8);
        renderStaffActivity('psEmployeePerformance', list);
      })
      .catch(function () {});
  }

  /* ------------------------------------------------------------------
     Settings
     ------------------------------------------------------------------ */
  function loadSettings() { PS.wireSettingsPanel(); }

  /* ------------------------------------------------------------------
     Small modal helpers (Invite Employee modal only — the shared Client
     Detail / Doc Action modals are wired by staff-shared.js)
     ------------------------------------------------------------------ */
  function openModal(id) {
    var modal = document.getElementById(id);
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }
  function closeModal(id) {
    var modal = document.getElementById(id);
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
  }
})();
