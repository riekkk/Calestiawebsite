/* ==========================================================================
   Calestia Travel & Tours — staff-shared.js
   ==========================================================================
   Shared between employee-portal.html and admin-portal.html: the session
   gate, the Client Detail Modal (status update, per-document verify/
   reject/reupload, client-visible remarks, staff-only internal notes),
   realtime wiring, sidebar/topbar shell mechanics, and small formatting
   helpers. Business logic that's genuinely business-logic-identical
   between the two roles lives here ONCE so it can't drift out of sync —
   employee-portal.js / admin-portal.js own everything role-specific
   (dashboards, Employees/Audit/Reports for admin, Remarks/Notes feeds for
   employee) on top of this.

   Exposes a single window.PSStaff namespace. Owns its own Supabase client
   (same pattern as client-portal.js / accept-invite.js).
   ========================================================================== */
window.PSStaff = (function () {
  'use strict';

  var supabaseClient = null;
  var profile = null;
  var profilesCache = {};
  var activeClientId = null;
  var lastKnownApplicationUpdatedAt = null;
  var pendingDocAction = null;

  function client() { return supabaseClient; }

  /* ------------------------------------------------------------------
     Session gate
     ------------------------------------------------------------------ */
  function gate(expectedRole, onReady) {
    if (typeof window.supabase === 'undefined' || !window.CALESTIA_SUPABASE_URL) {
      document.getElementById('psGate').textContent = 'Portal is not connected yet. Check config.js.';
      return;
    }
    supabaseClient = window.supabase.createClient(window.CALESTIA_SUPABASE_URL, window.CALESTIA_SUPABASE_ANON_KEY);

    supabaseClient.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') window.location.href = 'index.html';
    });

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (!session) { window.location.href = 'index.html'; return; }

      supabaseClient.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
        .then(function (result2) {
          var p = result2.data;
          var urls = window.CALESTIA_ROLE_PORTAL_URLS || {};
          if (!p || p.status !== 'active' || p.role !== expectedRole) {
            window.location.href = (p && urls[p.role]) || 'client-portal.html';
            return;
          }
          profile = p;
          document.getElementById('psGate').classList.add('is-hidden');
          document.getElementById('psShell').classList.remove('is-hidden');
          onReady(profile);
        })
        .catch(function () { window.location.href = 'index.html'; });
    });
  }

  /* ------------------------------------------------------------------
     Formatting helpers
     ------------------------------------------------------------------ */
  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function formatDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function timeAgo(iso) {
    if (!iso) return '';
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
  function labelFor(list, key) {
    var found = (list || []).filter(function (s) { return s.key === key; })[0];
    return found ? found.label : (key || '');
  }
  var DOC_STATUS_BADGE = { pending: 'gray', under_review: 'blue', verified: 'green', rejected: 'red', reupload_requested: 'amber' };
  var APP_STATUS_BADGE = {
    documents_incomplete: 'gray', documents_under_review: 'purple', ready_for_submission: 'blue',
    submitted_to_jvac: 'blue', under_embassy_review: 'purple', additional_documents_requested: 'amber',
    visa_approved: 'green', visa_denied: 'red', passport_ready_for_pickup: 'green', completed: 'green'
  };

  var toastTimer = null;
  function toast(message, isError) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.style.background = isError ? '#c0392b' : '';
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  function exportCSV(filename, rows, columns) {
    if (!rows.length) { toast('Nothing to export.', true); return; }
    var cols = columns || Object.keys(rows[0]);
    var esc = function (v) { v = v == null ? '' : String(v); return '"' + v.replace(/"/g, '""') + '"'; };
    var lines = [cols.map(esc).join(',')];
    rows.forEach(function (r) { lines.push(cols.map(function (c) { return esc(r[c]); }).join(',')); });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /* ------------------------------------------------------------------
     Profile cache (id -> profile), shared for name lookups everywhere
     ------------------------------------------------------------------ */
  function loadAllProfiles() {
    return supabaseClient.from('profiles').select('*').then(function (result) {
      profilesCache = {};
      (result.data || []).forEach(function (p) { profilesCache[p.id] = p; });
      return profilesCache;
    });
  }
  function profileName(id) {
    var p = profilesCache[id];
    return p ? (p.full_name || p.email) : 'Unknown';
  }

  /* ------------------------------------------------------------------
     Shell: sidebar nav / mobile drawer / bell / sign out
     panelLoaders: { panelKey: function(){ ... } } called each time that
     panel is switched into (page-specific tab data loading).
     ------------------------------------------------------------------ */
  function wireShell(pageMeta, panelLoaders) {
    document.querySelectorAll('#psNav .ps-nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () { goToPanel(btn.getAttribute('data-panel'), pageMeta, panelLoaders); });
    });
    document.querySelectorAll('[data-goto-panel]').forEach(function (btn) {
      btn.addEventListener('click', function () { goToPanel(btn.getAttribute('data-goto-panel'), pageMeta, panelLoaders); });
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
      });
      document.addEventListener('click', function (e) {
        if (!bellPanel.classList.contains('is-hidden') && !bellPanel.contains(e.target) && e.target !== bellBtn && !bellBtn.contains(e.target)) {
          bellPanel.classList.add('is-hidden');
          bellBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    var signoutBtn = document.getElementById('psSignoutBtn');
    if (signoutBtn) signoutBtn.addEventListener('click', function () {
      supabaseClient.auth.signOut().then(function () { window.location.href = 'index.html'; });
    });

    var role = profile.role;
    document.getElementById('psUserName').textContent = profile.full_name || profile.email;
    document.getElementById('psUserEmail').textContent = profile.email || '';
    document.getElementById('psUserAvatar').textContent = (profile.full_name || profile.email || '?').charAt(0).toUpperCase();
    document.querySelectorAll('.ps-role-pill').forEach(function (el) { el.textContent = role === 'admin' ? 'Admin Portal' : 'Employee Portal'; });
  }

  function goToPanel(panel, pageMeta, panelLoaders) {
    document.querySelectorAll('#psNav .ps-nav-item').forEach(function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-panel') === panel);
    });
    document.querySelectorAll('.ps-panel').forEach(function (p) {
      p.classList.toggle('is-active', p.getAttribute('data-panel') === panel);
    });
    var meta = pageMeta[panel];
    if (meta) {
      document.getElementById('psPageTitle').textContent = meta[0];
      document.getElementById('psPageSubtitle').textContent = meta[1];
    }
    document.getElementById('psShell').classList.remove('ps-sidebar-open');
    if (panelLoaders && panelLoaders[panel]) panelLoaders[panel]();
  }

  /* ------------------------------------------------------------------
     Shared Client Detail Modal — injected once into document.body so
     employee-portal.html and admin-portal.html don't each carry their
     own copy of this markup (and can't drift out of sync).
     ------------------------------------------------------------------ */
  function injectSharedModals() {
    if (document.getElementById('clientDetailModal')) return; // already injected

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="ps-modal" id="clientDetailModal" aria-hidden="true">' +
        '<div class="ps-modal-backdrop" data-close-client-modal></div>' +
        '<div class="ps-modal-card ps-modal-card-lg" role="dialog" aria-modal="true">' +
          '<div class="ps-modal-head">' +
            '<div><h2 id="clientDetailName">Client</h2><p id="clientDetailEmail"></p></div>' +
            '<button type="button" class="auth-close" data-close-client-modal aria-label="Close">✕</button>' +
          '</div>' +
          '<div class="ps-modal-body">' +
            '<div class="ps-modal-section">' +
              '<h3>Application Status</h3>' +
              '<div style="display:flex;gap:10px;flex-wrap:wrap;">' +
                '<select id="applicationStatusSelect" style="flex:1;min-width:200px;padding:10px 14px;border-radius:12px;border:1.5px solid var(--ps-border);font-family:inherit;"></select>' +
                '<button type="button" class="ps-btn ps-btn-primary" id="saveStatusBtn">Save</button>' +
              '</div>' +
              '<p class="ps-hint is-hidden" id="statusConflictWarning" style="color:#b91c1c;margin-top:8px;">⚠ This application was updated by someone else since you opened it. Refresh before saving.</p>' +
            '</div>' +
            '<div class="ps-modal-section">' +
              '<h3>Documents</h3>' +
              '<div id="clientDetailDocuments" style="display:flex;flex-direction:column;gap:10px;"></div>' +
            '</div>' +
            '<div class="ps-modal-section">' +
              '<h3>Visa Applicants <span style="font-weight:400;color:var(--ps-text-dim);">(entered by the client)</span></h3>' +
              '<div id="clientDetailApplicants" style="display:flex;flex-direction:column;gap:10px;"></div>' +
            '</div>' +
            '<div class="ps-modal-section">' +
              '<h3>Payment Submissions</h3>' +
              '<div id="clientDetailPayments" style="display:flex;flex-direction:column;gap:10px;"></div>' +
            '</div>' +
            '<div class="ps-modal-section">' +
              '<h3>Remarks <span style="font-weight:400;color:var(--ps-text-dim);">(visible to the client)</span></h3>' +
              '<div id="clientRemarksList"></div>' +
              '<div class="ps-add-note-row"><textarea id="newRemarkText" placeholder="e.g. Please upload a clearer copy of your passport bio page."></textarea>' +
              '<button type="button" class="ps-btn ps-btn-primary" id="addRemarkBtn">Send</button></div>' +
            '</div>' +
            '<div class="ps-modal-section">' +
              '<h3>Internal Notes <span style="font-weight:400;color:var(--ps-text-dim);">(staff only)</span></h3>' +
              '<div id="internalNotesList"></div>' +
              '<div class="ps-add-note-row"><textarea id="newInternalNoteText" placeholder="Notes visible only to Calestia staff…"></textarea>' +
              '<button type="button" class="ps-btn ps-btn-outline" id="addInternalNoteBtn">Add Note</button></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ps-modal" id="docActionModal" aria-hidden="true">' +
        '<div class="ps-modal-backdrop" data-close-doc-modal></div>' +
        '<div class="ps-modal-card" role="dialog" aria-modal="true">' +
          '<div class="ps-modal-head"><div><h2 id="docActionTitle">Reject document</h2></div>' +
          '<button type="button" class="auth-close" data-close-doc-modal aria-label="Close">✕</button></div>' +
          '<div class="ps-modal-body">' +
            '<div class="form-group"><label>Remark for the client</label><textarea id="docActionRemark" placeholder="Explain what needs to be fixed…" style="width:100%;min-height:90px;border:1.5px solid var(--ps-border);border-radius:12px;padding:10px 13px;font-family:inherit;"></textarea></div>' +
            '<button type="button" class="ps-btn ps-btn-primary" id="docActionConfirmBtn" style="width:100%;justify-content:center;">Confirm</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  function wireClientDetailModal(onChanged) {
    var modal = document.getElementById('clientDetailModal');
    modal.querySelectorAll('[data-close-client-modal]').forEach(function (el) { el.addEventListener('click', closeClientDetail); });

    document.getElementById('saveStatusBtn').addEventListener('click', function () { saveApplicationStatus(onChanged); });
    document.getElementById('addRemarkBtn').addEventListener('click', addRemark);
    document.getElementById('addInternalNoteBtn').addEventListener('click', addInternalNote);

    var select = document.getElementById('applicationStatusSelect');
    (window.CALESTIA_APPLICATION_STATUSES || []).forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.key; opt.textContent = s.label;
      select.appendChild(opt);
    });

    wireDocActionModal(onChanged);
  }

  function openClientDetail(clientId) {
    activeClientId = clientId;
    var p = profilesCache[clientId];
    var modal = document.getElementById('clientDetailModal');
    document.getElementById('clientDetailName').textContent = (p && (p.full_name || p.email)) || 'Client';
    document.getElementById('clientDetailEmail').textContent = (p && p.email) || '';
    document.getElementById('statusConflictWarning').classList.add('is-hidden');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    refreshClientDetail(clientId);
  }

  function closeClientDetail() {
    var modal = document.getElementById('clientDetailModal');
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
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
    refreshClientVisaApplicants(clientId);
    refreshClientPayments(clientId);
    refreshClientRemarks(clientId);
    refreshInternalNotes(clientId);
  }

  function saveApplicationStatus(onChanged) {
    if (!activeClientId) return;
    var select = document.getElementById('applicationStatusSelect');
    var newStatus = select.value;
    var btn = document.getElementById('saveStatusBtn');
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    var query = supabaseClient.from('applications').update({ status: newStatus }).eq('client_id', activeClientId);
    if (lastKnownApplicationUpdatedAt) query = query.eq('updated_at', lastKnownApplicationUpdatedAt);

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
      if (onChanged) onChanged();
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
    var byType = {};
    documentRows.forEach(function (d) { byType[d.document_type] = d; });

    container.innerHTML = (window.CALESTIA_DOCUMENT_TYPES || []).map(function (t) {
      var doc = byType[t.key];
      var hasFile = !!(doc && doc.file_path);
      var badgeColor = hasFile ? (DOC_STATUS_BADGE[doc.status] || 'gray') : 'gray';
      var badgeLabel = doc ? labelFor(window.CALESTIA_DOCUMENT_STATUSES, doc.status) : 'Not Uploaded';
      return (
        '<div class="ps-doc-card" data-doc-type="' + t.key + '">' +
          '<div class="ps-doc-card-top"><h4>' + escapeHTML(t.label) + '</h4>' +
          '<span class="ps-badge ps-badge-' + badgeColor + '">' + escapeHTML(hasFile ? badgeLabel : 'Not Uploaded') + '</span></div>' +
          (hasFile ? '<div class="ps-doc-file-chip">' + window.PSIcon('file-text', 14) + '<span>' + escapeHTML(doc.file_name || '') + '</span></div>' : '<p class="ps-hint">No file uploaded yet</p>') +
          (doc && doc.remarks ? '<div class="ps-doc-remark is-negative">' + window.PSIcon('message-square', 13) + '<span>' + escapeHTML(doc.remarks) + '</span></div>' : '') +
          (hasFile ? '<div class="ps-doc-actions">' +
            '<button type="button" class="ps-btn ps-btn-outline ps-btn-sm" data-doc-action="preview">Preview</button>' +
            '<button type="button" class="ps-btn ps-btn-outline ps-btn-sm" data-doc-action="download">Download</button>' +
            '<button type="button" class="ps-btn ps-btn-primary ps-btn-sm" data-doc-action="verify">Verify</button>' +
            '<button type="button" class="ps-btn ps-btn-danger ps-btn-sm" data-doc-action="reject">Reject</button>' +
            '<button type="button" class="ps-btn ps-btn-outline ps-btn-sm" data-doc-action="reupload">Request Re-upload</button>' +
          '</div>' : '') +
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
          if (!path) return null;
          return supabaseClient.storage.from('client-documents').createSignedUrl(path, 300, action === 'download' ? { download: result.data.file_name } : undefined);
        })
        .then(function (signed) { if (signed && signed.data && signed.data.signedUrl) window.open(signed.data.signedUrl, '_blank', 'noopener'); })
        .catch(function () { toast('Could not open file.', true); });
      return;
    }
    if (action === 'verify') { updateDocumentStatus(clientId, docType, 'verified', null); return; }

    pendingDocAction = { kind: 'document', clientId: clientId, docType: docType, action: action };
    document.getElementById('docActionTitle').textContent = action === 'reject' ? 'Reject document' : 'Request re-upload';
    document.getElementById('docActionRemark').value = '';
    var modal = document.getElementById('docActionModal');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function handlePaymentAction(clientId, paymentId, action, onChanged) {
    if (action === 'verify') { updatePaymentStatus(clientId, paymentId, 'verified', null, onChanged); return; }

    pendingDocAction = { kind: 'payment', clientId: clientId, paymentId: paymentId, action: action, onChanged: onChanged };
    document.getElementById('docActionTitle').textContent = 'Reject payment submission';
    document.getElementById('docActionRemark').value = '';
    var modal = document.getElementById('docActionModal');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
  }

  function wireDocActionModal(onChanged) {
    var modal = document.getElementById('docActionModal');
    modal.querySelectorAll('[data-close-doc-modal]').forEach(function (el) {
      el.addEventListener('click', function () {
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        pendingDocAction = null;
      });
    });
    document.getElementById('docActionConfirmBtn').addEventListener('click', function () {
      if (!pendingDocAction) return;
      var remark = document.getElementById('docActionRemark').value.trim();
      if (!remark) { toast('Please add a remark for the client.', true); return; }
      if (pendingDocAction.kind === 'payment') {
        updatePaymentStatus(pendingDocAction.clientId, pendingDocAction.paymentId, 'rejected', remark, pendingDocAction.onChanged || onChanged);
      } else {
        var status = pendingDocAction.action === 'reject' ? 'rejected' : 'reupload_requested';
        updateDocumentStatus(pendingDocAction.clientId, pendingDocAction.docType, status, remark, onChanged);
      }
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      pendingDocAction = null;
    });
  }

  function updateDocumentStatus(clientId, docType, status, remark, onChanged) {
    var payload = { status: status, verified_by: profile.id, verified_at: new Date().toISOString() };
    if (remark !== null && remark !== undefined) payload.remarks = remark;
    if (status === 'verified') payload.remarks = null;

    supabaseClient.from('documents').update(payload).eq('client_id', clientId).eq('document_type', docType)
      .then(function (result) {
        if (result.error) { toast(result.error.message || 'Could not update document.', true); return; }
        toast('Document updated.');
        if (activeClientId === clientId) refreshClientDocuments(clientId);
        if (onChanged) onChanged();
      })
      .catch(function () { toast('Something went wrong.', true); });
  }

  function refreshClientVisaApplicants(clientId) {
    supabaseClient.from('visa_applicants').select('*').eq('client_id', clientId).order('created_at', { ascending: true })
      .then(function (result) { renderClientVisaApplicants(result.data || []); });
  }

  function tierBadgeHTML(tier) {
    var isPremium = tier === 'premium';
    return '<span class="ps-badge" style="margin-left:8px;' + (isPremium ? 'background:#FEF3C7;color:#D97706;' : 'background:#EAF0F6;color:#3B5583;') + '">' + (isPremium ? 'Premium' : 'Standard') + '</span>';
  }

  function renderClientVisaApplicants(rows) {
    var container = document.getElementById('clientDetailApplicants');
    if (!rows.length) { container.innerHTML = '<p class="ps-hint">No applicants submitted yet.</p>'; return; }
    container.innerHTML = rows.map(function (a, i) {
      var name = ((a.first_name || '') + ' ' + (a.last_name || '')).trim() || 'Unnamed';
      var travelDateStr = a.travel_date ? formatDate(a.travel_date) : '—';
      return '<div class="ps-doc-card">' +
        '<div class="ps-doc-card-top"><div><h4>Applicant ' + (i + 1) + ' — ' + escapeHTML(name) + '</h4></div>' + tierBadgeHTML(a.service_tier || 'standard') + '</div>' +
        '<p class="ps-hint">' + escapeHTML(a.visa_type || '—') + ' · Passport ' + escapeHTML(a.passport_number || '—') + ' · Travel ' + travelDateStr + '</p>' +
        '</div>';
    }).join('');
  }

  var PAYMENT_STATUS_BADGE = { pending_verification: 'amber', verified: 'green', rejected: 'red' };
  var PAYMENT_STATUS_LABEL = { pending_verification: 'Pending Verification', verified: 'Verified', rejected: 'Rejected' };

  function refreshClientPayments(clientId) {
    supabaseClient.from('payment_submissions').select('*').eq('client_id', clientId).order('submitted_at', { ascending: false })
      .then(function (result) { renderClientPayments(clientId, result.data || []); });
  }

  function renderClientPayments(clientId, rows) {
    var container = document.getElementById('clientDetailPayments');
    if (!rows.length) { container.innerHTML = '<p class="ps-hint">No payment submissions yet.</p>'; return; }

    container.innerHTML = rows.map(function (p) {
      var badgeColor = PAYMENT_STATUS_BADGE[p.status] || 'gray';
      var badgeLabel = PAYMENT_STATUS_LABEL[p.status] || p.status;
      var actions = '<div class="ps-doc-actions">' +
        '<button type="button" class="ps-btn ps-btn-outline ps-btn-sm" data-payment-action="preview" data-payment-id="' + p.id + '">Preview Receipt</button>' +
        (p.status === 'pending_verification'
          ? '<button type="button" class="ps-btn ps-btn-primary ps-btn-sm" data-payment-action="verify" data-payment-id="' + p.id + '">Verify</button>' +
            '<button type="button" class="ps-btn ps-btn-danger ps-btn-sm" data-payment-action="reject" data-payment-id="' + p.id + '">Reject</button>'
          : '') +
        '</div>';

      return '<div class="ps-doc-card">' +
        '<div class="ps-doc-card-top"><div><h4>' + escapeHTML((p.method || '').toUpperCase()) + ' · ₱' + Number(p.amount || 0).toLocaleString() + '</h4>' +
        '<p>' + p.applicant_count + ' applicant(s) · Submitted ' + timeAgo(p.submitted_at) + '</p></div>' +
        '<span class="ps-badge ps-badge-' + badgeColor + '">' + escapeHTML(badgeLabel) + '</span></div>' +
        (p.remarks ? '<div class="ps-doc-remark is-negative">' + window.PSIcon('message-square', 13) + '<span>' + escapeHTML(p.remarks) + '</span></div>' : '') +
        actions +
        '</div>';
    }).join('');

    container.querySelectorAll('[data-payment-action]').forEach(function (btn) {
      var paymentId = btn.getAttribute('data-payment-id');
      var action = btn.getAttribute('data-payment-action');
      btn.addEventListener('click', function () {
        if (action === 'preview') { previewPaymentReceipt(paymentId, rows); return; }
        handlePaymentAction(clientId, paymentId, action, function () { if (activeClientId === clientId) refreshClientPayments(clientId); });
      });
    });
  }

  function previewPaymentReceipt(paymentId, rows) {
    var row = rows.filter(function (r) { return r.id === paymentId; })[0];
    var path = row && row.receipt_path;
    if (!path) { toast('No receipt on file.', true); return; }
    supabaseClient.storage.from('payment-receipts').createSignedUrl(path, 300)
      .then(function (signed) { if (signed && signed.data && signed.data.signedUrl) window.open(signed.data.signedUrl, '_blank', 'noopener'); })
      .catch(function () { toast('Could not open receipt.', true); });
  }

  function updatePaymentStatus(clientId, paymentId, status, remark, onChanged) {
    var payload = { status: status, verified_by: profile.id, verified_at: new Date().toISOString() };
    if (remark !== null && remark !== undefined) payload.remarks = remark;
    if (status === 'verified') payload.remarks = null;

    supabaseClient.from('payment_submissions').update(payload).eq('id', paymentId).eq('client_id', clientId)
      .then(function (result) {
        if (result.error) { toast(result.error.message || 'Could not update payment.', true); return; }
        toast('Payment submission updated.');
        if (activeClientId === clientId) refreshClientPayments(clientId);
        if (onChanged) onChanged();
      })
      .catch(function () { toast('Something went wrong.', true); });
  }

  function refreshClientRemarks(clientId) {
    supabaseClient.from('remarks').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).then(function (result) {
      var list = document.getElementById('clientRemarksList');
      var rows = result.data || [];
      list.innerHTML = rows.length ? rows.map(function (r) {
        return '<div class="ps-remark-item"><div><p class="ps-remark-body">' + escapeHTML(r.message) + '</p></div><span class="ps-remark-time">' + formatDate(r.created_at) + '</span></div>';
      }).join('') : '<p class="ps-hint">No remarks yet.</p>';
    });
  }

  function addRemark() {
    if (!activeClientId) return;
    var textarea = document.getElementById('newRemarkText');
    var message = textarea.value.trim();
    if (!message) { toast('Write a remark first.', true); return; }
    supabaseClient.from('remarks').insert({ client_id: activeClientId, author_id: profile.id, message: message })
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
      list.innerHTML = rows.length ? rows.map(function (n) {
        return '<div class="ps-remark-item"><div><p class="ps-remark-body">' + escapeHTML(n.note) + '</p><p class="ps-remark-meta" style="margin-top:2px;">' + escapeHTML(profileName(n.author_id)) + '</p></div><span class="ps-remark-time">' + formatDate(n.created_at) + '</span></div>';
      }).join('') : '<p class="ps-hint">No internal notes yet.</p>';
    });
  }

  function addInternalNote() {
    if (!activeClientId) return;
    var textarea = document.getElementById('newInternalNoteText');
    var note = textarea.value.trim();
    if (!note) { toast('Write a note first.', true); return; }
    supabaseClient.from('internal_notes').insert({ client_id: activeClientId, author_id: profile.id, note: note })
      .then(function (result) {
        if (result.error) { toast(result.error.message || 'Could not add note.', true); return; }
        textarea.value = '';
        toast('Internal note added.');
        refreshInternalNotes(activeClientId);
      })
      .catch(function () { toast('Something went wrong.', true); });
  }

  /* ------------------------------------------------------------------
     Settings panel — identical on Employee and Admin portals (display
     name + notification_preferences toggles), so it's implemented once
     here rather than copy-pasted into both page controllers.
     ------------------------------------------------------------------ */
  var NOTIF_PREF_KEYS = [
    ['document_alerts', 'Email alerts for new documents'],
    ['application_updates', 'In-app notifications for application updates'],
    ['daily_summary', 'Daily workload summary email'],
    ['deadline_reminders', 'Deadline reminders']
  ];

  function wireSettingsPanel() {
    document.getElementById('settingsFullName').value = profile.full_name || '';

    var saveBtn = document.getElementById('settingsSaveNameBtn');
    if (!saveBtn.dataset.wired) {
      saveBtn.dataset.wired = '1';
      saveBtn.addEventListener('click', function () {
        var name = document.getElementById('settingsFullName').value.trim();
        supabaseClient.from('profiles').update({ full_name: name }).eq('id', profile.id)
          .then(function (result) {
            if (result.error) { toast(result.error.message || 'Could not save.', true); return; }
            profile.full_name = name;
            document.getElementById('psUserName').textContent = name;
            var banner = document.getElementById('psBannerName');
            if (banner) banner.textContent = name.split(' ')[0];
            toast('Settings saved.');
          })
          .catch(function () { toast('Something went wrong.', true); });
      });
    }

    renderNotifPrefs();
  }

  function renderNotifPrefs() {
    var prefs = profile.notification_preferences || {};
    var el = document.getElementById('psNotifPrefs');
    el.innerHTML = NOTIF_PREF_KEYS.map(function (pair) {
      var key = pair[0], label = pair[1];
      var isOn = prefs[key] !== false; // missing key = on, matches the migration's documented default
      return '<div class="ps-toggle-row"><span>' + escapeHTML(label) + '</span><button type="button" class="ps-toggle' + (isOn ? ' is-on' : '') + '" data-pref-key="' + key + '"></button></div>';
    }).join('');

    el.querySelectorAll('[data-pref-key]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-pref-key');
        var newPrefs = Object.assign({}, profile.notification_preferences || {});
        newPrefs[key] = !(newPrefs[key] !== false);
        btn.classList.toggle('is-on', newPrefs[key]);
        supabaseClient.from('profiles').update({ notification_preferences: newPrefs }).eq('id', profile.id)
          .then(function (result) {
            if (result.error) { toast('Could not save preference.', true); return; }
            profile.notification_preferences = newPrefs;
          })
          .catch(function () { toast('Something went wrong.', true); });
      });
    });
  }

  /* ------------------------------------------------------------------
     Realtime
     ------------------------------------------------------------------ */
  function subscribeRealtime(opts) {
    opts = opts || {};
    var debounceTimer = null;
    var channel = supabaseClient.channel('staff-portal-' + profile.role)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, function (payload) { handleCoreChange(payload, opts); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, function (payload) { handleCoreChange(payload, opts); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'remarks' }, function (payload) { handleCoreChange(payload, opts); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'visa_applicants' }, function (payload) { handleCoreChange(payload, opts); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_submissions' }, function (payload) { handleCoreChange(payload, opts); });

    if (opts.onProfilesChange) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, opts.onProfilesChange);
    if (opts.onInvitationsChange) channel.on('postgres_changes', { event: '*', schema: 'public', table: 'employee_invitations' }, opts.onInvitationsChange);

    channel.subscribe();

    function handleCoreChange(payload, opts) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        if (opts.onCoreChange) opts.onCoreChange();
        var row = payload && payload.new;
        var affectedClientId = row && row.client_id;
        if (activeClientId && affectedClientId === activeClientId) refreshClientDetail(activeClientId);
      }, 400);
    }
  }

  return {
    client: client,
    gate: gate,
    get profile() { return profile; },
    escapeHTML: escapeHTML,
    formatDate: formatDate,
    timeAgo: timeAgo,
    labelFor: labelFor,
    toast: toast,
    exportCSV: exportCSV,
    loadAllProfiles: loadAllProfiles,
    profileName: profileName,
    get profilesCache() { return profilesCache; },
    wireShell: wireShell,
    goToPanel: goToPanel,
    injectSharedModals: injectSharedModals,
    wireClientDetailModal: wireClientDetailModal,
    openClientDetail: openClientDetail,
    updateDocumentStatus: updateDocumentStatus,
    handleDocAction: handleDocAction,
    wireSettingsPanel: wireSettingsPanel,
    subscribeRealtime: subscribeRealtime,
    DOC_STATUS_BADGE: DOC_STATUS_BADGE,
    APP_STATUS_BADGE: APP_STATUS_BADGE
  };
})();
