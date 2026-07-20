/* ==========================================================================
   Calestia Travel & Tours — accept-invite.js
   Standalone page: an invited employee/admin lands here from their email
   link, verifies the token, creates (or signs into) their account, and
   accepts the invitation. Self-contained, same pattern as staff-portal.js —
   no service_role key involved anywhere; everything goes through RLS +
   the two SECURITY DEFINER RPCs defined in supabase/portal-schema.sql.
   ========================================================================== */
(function () {
  'use strict';

  var supabaseClient = null;
  var inviteToken = null;
  var inviteData = null; // { email, role }
  var acceptanceInFlight = false;
  var alreadyAccepted = false;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    inviteToken = new URLSearchParams(window.location.search).get('token');

    if (typeof window.supabase === 'undefined' || !window.CALESTIA_SUPABASE_URL || !inviteToken) {
      showInvalid('This invitation link is missing or malformed.');
      return;
    }

    supabaseClient = window.supabase.createClient(window.CALESTIA_SUPABASE_URL, window.CALESTIA_SUPABASE_ANON_KEY);
    wireForms();

    supabaseClient.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_IN' && inviteData && !alreadyAccepted) {
        handleSignedIn(session);
      }
    });

    loadInvite();
  }

  function loadInvite() {
    supabaseClient.rpc('get_invitation_by_token', { p_token: inviteToken }).then(function (result) {
      if (result.error || !result.data || !result.data.valid) {
        var reason = result.data && result.data.reason;
        var msg = reason === 'expired' ? 'This invitation has expired. Ask your administrator to send a new one.'
          : reason === 'already_used' ? 'This invitation has already been used.'
          : 'This invitation link is not valid.';
        showInvalid(msg);
        return;
      }
      inviteData = result.data;
      checkExistingSession();
    }).catch(function () { showInvalid('This invitation link is not valid.'); });
  }

  function checkExistingSession() {
    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      if (session) {
        handleSignedIn(session);
      } else {
        showInviteForm();
      }
    });
  }

  function handleSignedIn(session) {
    var email = session.user.email || '';
    if (email.toLowerCase() !== inviteData.email.toLowerCase()) {
      document.getElementById('mismatchCurrentEmail').textContent = email;
      document.getElementById('mismatchInviteEmail').textContent = inviteData.email;
      showState('inviteMismatch');
      wireSignOut();
      return;
    }
    acceptInvitation();
  }

  function acceptInvitation() {
    if (acceptanceInFlight || alreadyAccepted) return;
    acceptanceInFlight = true;

    supabaseClient.rpc('accept_employee_invitation', { p_token: inviteToken }).then(function (result) {
      acceptanceInFlight = false;
      if (result.error) {
        toast(result.error.message || 'Could not accept invitation.', true);
        return;
      }
      alreadyAccepted = true;
      var role = result.data && result.data.role;
      document.getElementById('acceptedRole').textContent = role === 'admin' ? 'an Administrator' : 'an Employee';
      showState('inviteAccepted');
    }).catch(function () {
      acceptanceInFlight = false;
      toast('Something went wrong. Please try again.', true);
    });
  }

  function showInviteForm() {
    document.getElementById('inviteRoleLabel').textContent = inviteData.role === 'admin' ? 'an Administrator' : 'an Employee';
    document.getElementById('inviteEmailLabel').textContent = inviteData.email;
    document.getElementById('signinEmailLabel').textContent = inviteData.email;
    showState('inviteForm');
  }

  function showInvalid(message) {
    document.getElementById('inviteInvalidReason').textContent = message;
    showState('inviteInvalid');
  }

  function showState(id) {
    ['inviteLoading', 'inviteInvalid', 'inviteMismatch', 'inviteAccepted', 'inviteConfirmEmail', 'inviteForm', 'inviteSignInForm'].forEach(function (s) {
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

  function wireSignOut() {
    document.querySelectorAll('.js-signout').forEach(function (btn) {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', function () {
        supabaseClient.auth.signOut().then(function () { window.location.reload(); });
      });
    });
  }

  function wireForms() {
    var signupForm = document.getElementById('inviteForm');
    var signinForm = document.getElementById('inviteSignInForm');

    document.getElementById('switchToSignIn').addEventListener('click', function (e) {
      e.preventDefault();
      showState('inviteSignInForm');
    });
    document.getElementById('switchToSignUp').addEventListener('click', function (e) {
      e.preventDefault();
      showInviteForm();
    });

    signupForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = document.getElementById('invitePassword').value;
      var pw2 = document.getElementById('invitePasswordConfirm').value;
      if (pw.length < 8) { toast('Password must be at least 8 characters.', true); return; }
      if (pw !== pw2) { toast('Passwords do not match.', true); return; }

      var btn = signupForm.querySelector('.auth-submit');
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Creating account…';

      supabaseClient.auth.signUp({
        email: inviteData.email,
        password: pw,
        options: { emailRedirectTo: window.location.href }
      }).then(function (result) {
        btn.disabled = false;
        btn.textContent = originalText;
        if (result.error) {
          toast(result.error.message || 'Could not create account.', true);
          return;
        }
        if (result.data.session) {
          acceptInvitation();
        } else {
          document.getElementById('confirmEmailAddress').textContent = inviteData.email;
          showState('inviteConfirmEmail');
        }
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = originalText;
        toast('Something went wrong. Please try again.', true);
      });
    });

    signinForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = document.getElementById('inviteSigninPassword').value;
      if (!pw) { toast('Enter your password.', true); return; }

      var btn = signinForm.querySelector('.auth-submit');
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Signing in…';

      supabaseClient.auth.signInWithPassword({ email: inviteData.email, password: pw }).then(function (result) {
        btn.disabled = false;
        btn.textContent = originalText;
        if (result.error) {
          toast(result.error.message || 'Sign-in failed.', true);
          return;
        }
        acceptInvitation();
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = originalText;
        toast('Something went wrong. Please try again.', true);
      });
    });
  }
})();
