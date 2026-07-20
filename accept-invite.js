/* ==========================================================================
   Calestia Travel & Tours — accept-invite.js
   ==========================================================================
   Standalone page: an invited employee/admin lands here from the email
   Supabase Auth sends automatically (via the invite-employee Edge
   Function's call to auth.admin.inviteUserByEmail). Supabase's own client
   SDK auto-detects the invite link's token in the URL and establishes a
   temporary session before this script's first getSession() call resolves
   — there is no separate custom token/RPC flow anymore, and no need to
   match emails or choose between sign-up/sign-in: the fact that a session
   exists here at all IS the proof of identity (Supabase already verified
   the emailed link). All this page does is let them set a password.

   The invited role is never trusted from client-editable data — it was
   already set server-side (profiles.role) by the Edge Function under its
   own admin-authenticated check before this email was ever sent, so it's
   safe to just read it back from the database.
   ========================================================================== */
(function () {
  'use strict';

  var supabaseClient = null;
  var resolved = false;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    if (typeof window.supabase === 'undefined' || !window.CALESTIA_SUPABASE_URL) {
      showState('inviteInvalid');
      return;
    }
    supabaseClient = window.supabase.createClient(window.CALESTIA_SUPABASE_URL, window.CALESTIA_SUPABASE_ANON_KEY);
    wireForm();

    supabaseClient.auth.onAuthStateChange(function (event, session) {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        showInviteForm(session);
      }
    });

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (session) {
        showInviteForm(session);
      } else {
        // Give onAuthStateChange a brief window to fire for links that are
        // still being parsed out of the URL when this resolves first.
        setTimeout(function () { if (!resolved) showState('inviteInvalid'); }, 1500);
      }
    });
  }

  function showInviteForm(session) {
    if (resolved) return;
    resolved = true;

    document.getElementById('inviteEmailLabel').textContent = session.user.email || '';

    supabaseClient.from('profiles').select('role').eq('id', session.user.id).maybeSingle()
      .then(function (result) {
        var role = (result.data && result.data.role) || 'employee';
        var label = role === 'admin' ? 'an Administrator' : 'an Employee';
        document.getElementById('inviteRoleLabel').textContent = label;
        document.getElementById('acceptedRole').textContent = label;
      });

    showState('inviteForm');
  }

  function showState(id) {
    ['inviteLoading', 'inviteInvalid', 'inviteAccepted', 'inviteForm'].forEach(function (s) {
      var el = document.getElementById(s);
      if (el) el.classList.toggle('is-hidden', s !== id);
    });
  }

  function toast(msg, warn) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.background = warn ? '#c0392b' : '#335686';
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  function wireForm() {
    var form = document.getElementById('inviteForm');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = document.getElementById('invitePassword').value;
      var pw2 = document.getElementById('invitePasswordConfirm').value;
      if (pw.length < 8) { toast('Password must be at least 8 characters.', true); return; }
      if (pw !== pw2) { toast('Passwords do not match.', true); return; }

      var btn = form.querySelector('.auth-submit');
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Setting password…';

      supabaseClient.auth.updateUser({ password: pw }).then(function (result) {
        btn.disabled = false;
        btn.textContent = originalText;
        if (result.error) {
          toast(result.error.message || 'Could not set your password.', true);
          return;
        }
        showState('inviteAccepted');
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = originalText;
        toast('Something went wrong. Please try again.', true);
      });
    });
  }
})();
