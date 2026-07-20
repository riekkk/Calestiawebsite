/* ==========================================================================
   Calestia Travel & Tours — script.js
   Handles: sakura petals, nav toggle, contact form (EmailJS), toast,
   fade-in observer, auth modal (Supabase-ready).
   ========================================================================== */

(function () {
  'use strict';

  /* ------------------------------------------------------------------
     CONFIG
     ------------------------------------------------------------------ */
  var EMAILJS_PUBLIC_KEY = 'Bp_1nflmnjqr7recy';
  var EMAILJS_SERVICE_ID = 'service_y33oto9';
  var EMAILJS_TEMPLATE_ID = 'template_svk1i9k';

  // Supabase config — normally supplied by config.js (window.CALESTIA_SUPABASE_*).
  // These are just a fallback so the file still makes sense if config.js is missing.
  var SUPABASE_URL = 'YOUR_SUPABASE_URL_HERE';
  var SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY_HERE';

  /* ------------------------------------------------------------------
     Initialize when DOM is ready
     ------------------------------------------------------------------ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    initEmailJS();
    initPetals();
    initSupabase();
    initNav();
    initContactForm();
    initFadeInObserver();
    initAuthModal();
    initAuthState();
    initResetPassword();
    initTestimonials();
    initReviewForm();
    initTourFilters();
  }

  /* ==================================================================
     1. EmailJS init
     ================================================================== */
  function initEmailJS() {
    if (typeof window.emailjs !== 'undefined' && typeof window.emailjs.init === 'function') {
      try {
        window.emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
      } catch (e) {
        // Older SDK versions accept a string
        window.emailjs.init(EMAILJS_PUBLIC_KEY);
      }
    }
  }

  /* ==================================================================
     2. Falling sakura petals (hero only)
     ================================================================== */
  function initPetals() {
    var petalContainer = document.getElementById('petals');
    if (!petalContainer) return;

    // Respect reduced-motion preference
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    function createPetal() {
      var p = document.createElement('div');
      p.className = 'petal';
      p.textContent = '🌸';
      var size = 12 + Math.random() * 14;
      var left = Math.random() * 100;
      var duration = 5 + Math.random() * 4;
      var drift = (Math.random() * 80 - 40).toFixed(0) + 'px';
      p.style.left = left + '%';
      p.style.fontSize = size + 'px';
      p.style.setProperty('--drift', drift);
      p.style.animation = 'petal-fall ' + duration + 's linear forwards';
      petalContainer.appendChild(p);
      setTimeout(function () { p.remove(); }, duration * 1000 + 200);
    }

    setInterval(createPetal, 450);
    for (var i = 0; i < 6; i++) {
      setTimeout(createPetal, i * 250);
    }
  }

  /* ==================================================================
     3. Nav toggle (mobile menu + auth buttons)
     ================================================================== */
  function initNav() {
    var hamburger  = document.getElementById('hamburger');
    var mobileMenu = document.getElementById('mobileMenu');
    var closeMenu  = document.getElementById('closeMenu');
    var authTrigger = document.getElementById('authTriggerBtn');
    var mmAuthBtn = document.getElementById('mmAuthBtn');

    // Desktop auth button opens the modal
    if (authTrigger) {
      authTrigger.addEventListener('click', openAuthModal);
    }

    // Mobile auth button opens the modal (and closes the mobile menu)
    if (mmAuthBtn) {
      mmAuthBtn.addEventListener('click', function () {
        if (mobileMenu) mobileMenu.classList.remove('open');
        openAuthModal();
      });
    }

    // Backdrop click closes menu
    if (mobileMenu) {
      mobileMenu.addEventListener('click', function (e) {
        if (e.target === mobileMenu) mobileMenu.classList.remove('open');
      });
    }

    // Hamburger open
    if (hamburger && mobileMenu) {
      hamburger.addEventListener('click', function () { mobileMenu.classList.add('open'); });
      hamburger.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mobileMenu.classList.add('open'); }
      });
    }

    // Close button
    if (closeMenu && mobileMenu) {
      closeMenu.addEventListener('click', function () { mobileMenu.classList.remove('open'); });
      closeMenu.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mobileMenu.classList.remove('open'); }
      });
    }

    // Close menu when a link is tapped
    var mmLinks = document.querySelectorAll('.mm-link');
    for (var i = 0; i < mmLinks.length; i++) {
      mmLinks[i].addEventListener('click', function () {
        var mm = document.getElementById('mobileMenu');
        if (mm) mm.classList.remove('open');
      });
    }
  }

  /* ==================================================================
     4. Contact form submit (EmailJS)
     ================================================================== */
  function initContactForm() {
    var submitBtn = document.getElementById('submitBtn');
    if (!submitBtn) return;

    var originalHTML = submitBtn.innerHTML;

    submitBtn.addEventListener('click', function () {
      var fname       = getValue('fname');
      var lname       = getValue('lname');
      var email       = getValue('email');
      var phone       = getValue('phone');
      var visa        = getValue('visatype');
      var travelDate  = getValue('traveldate');
      var message     = getValue('message');

      if (!fname || !lname || !email || !phone || !visa) {
        showToast('Please fill in all required fields.', true);
        return;
      }

      submitBtn.innerHTML = '<span>Sending...</span> <span>⏳</span>';
      submitBtn.disabled = true;

      if (typeof window.emailjs === 'undefined') {
        submitBtn.innerHTML = originalHTML;
        submitBtn.disabled = false;
        showToast('Email service not available. Please contact us directly.', true);
        return;
      }

      window.emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        fname: fname,
        lname: lname,
        email: email,
        phone: phone,
        visa: visa,
        travelDate: travelDate,
        message: message
      }, EMAILJS_PUBLIC_KEY).then(function () {
        submitBtn.innerHTML = originalHTML;
        submitBtn.disabled = false;
        ['fname', 'lname', 'email', 'phone', 'message', 'traveldate'].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.value = '';
        });
        var vt = document.getElementById('visatype');
        if (vt) vt.value = '';
        showToast("Inquiry sent! We'll get back to you within 24 hours.");
      }).catch(function () {
        submitBtn.innerHTML = originalHTML;
        submitBtn.disabled = false;
        showToast('Something went wrong. Please try again or contact us directly.', true);
      });
    });
  }

  function getValue(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  /* ==================================================================
     5. Toast
     ================================================================== */
  function showToast(msg, warn) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.background = warn ? '#c0392b' : '#335686';
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 3200);
  }
  // Expose for other pages
  window.calestiaToast = showToast;

  /* ==================================================================
     6. Fade-in on scroll
     ================================================================== */
  function initFadeInObserver() {
    if (!('IntersectionObserver' in window)) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
        }
      });
    }, { threshold: 0.1 });

    var targets = document.querySelectorAll('.timeline-step, .testimonial-card, .service-mini, .req-item, .tour-card, .form-doc-card');
    for (var i = 0; i < targets.length; i++) {
      targets[i].style.opacity = '0';
      targets[i].style.transition = 'opacity 0.6s ease';
      observer.observe(targets[i]);
    }
  }

  /* ==================================================================
     7. Supabase client (auth)
     ================================================================== */
  var supabaseClient = null;

  function initSupabase() {
    var url = window.CALESTIA_SUPABASE_URL || SUPABASE_URL;
    var key = window.CALESTIA_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;
    if (typeof window.supabase !== 'undefined' &&
        url && url.indexOf('YOUR_') !== 0 &&
        key && key.indexOf('YOUR_') !== 0) {
      supabaseClient = window.supabase.createClient(url, key);
    }
  }

  /* ==================================================================
     8. Auth Modal
     ================================================================== */
  function initAuthModal() {
    var modal = document.getElementById('authModal');
    if (!modal) return;

    // Listen for the custom "open auth" event (kept for backward compat with old TSX)
    window.addEventListener('calestia:auth-open', openAuthModal);

    // Any other "sign in to continue" trigger on the page (e.g. Leave a Review)
    var openAuthBtns = document.querySelectorAll('.js-open-auth');
    for (var o = 0; o < openAuthBtns.length; o++) {
      openAuthBtns[o].addEventListener('click', openAuthModal);
    }

    // Close handlers (backdrop + close button + [data-close-auth])
    var closers = modal.querySelectorAll('[data-close-auth]');
    for (var i = 0; i < closers.length; i++) {
      closers[i].addEventListener('click', closeAuthModal);
    }

    // Escape key closes the modal
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) {
        closeAuthModal();
      }
    });

    // Tab switching
    var tabs = modal.querySelectorAll('.auth-tab');
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].addEventListener('click', function () {
        setAuthTab(this.getAttribute('data-tab'));
      });
    }

    // In-form tab switch links ("Don't have an account?" etc.)
    var switchLinks = modal.querySelectorAll('[data-switch-tab]');
    for (var k = 0; k < switchLinks.length; k++) {
      switchLinks[k].addEventListener('click', function (e) {
        e.preventDefault();
        setAuthTab(this.getAttribute('data-switch-tab'));
      });
    }

    // Sign In form
    var signinForm = document.getElementById('signinForm');
    if (signinForm) {
      signinForm.addEventListener('submit', function (e) {
        e.preventDefault();
        handleSignIn();
      });
    }

    // Sign Up form
    var signupForm = document.getElementById('signupForm');
    if (signupForm) {
      signupForm.addEventListener('submit', function (e) {
        e.preventDefault();
        handleSignUp();
      });
    }

    // Forgot password link
    var forgotLink = document.getElementById('forgotPasswordLink');
    if (forgotLink) {
      forgotLink.addEventListener('click', function (e) {
        e.preventDefault();
        handleForgotPassword();
      });
    }
  }

  function openAuthModal() {
    var modal = document.getElementById('authModal');
    if (!modal) return;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      var first = modal.querySelector('.auth-form.is-active input');
      if (first) first.focus();
    }, 100);
  }

  function closeAuthModal() {
    var modal = document.getElementById('authModal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  function setAuthTab(tab) {
    var tabs  = document.querySelectorAll('.auth-tab');
    var forms = document.querySelectorAll('.auth-form');
    var title = document.getElementById('authTitle');
    var sub   = document.querySelector('.auth-sub');

    for (var i = 0; i < tabs.length; i++) {
      var isActive = tabs[i].getAttribute('data-tab') === tab;
      tabs[i].classList.toggle('is-active', isActive);
      tabs[i].setAttribute('aria-selected', isActive ? 'true' : 'false');
    }
    for (var j = 0; j < forms.length; j++) {
      forms[j].classList.toggle('is-active', forms[j].getAttribute('data-panel') === tab);
    }
    if (title && sub) {
      if (tab === 'signup') {
        title.textContent = 'Create your account';
        sub.textContent = 'Start your Japan journey with a personalized dashboard.';
      } else {
        title.textContent = 'Welcome back';
        sub.textContent = 'Sign in to track your application or create an account to get started.';
      }
    }
  }

  function handleSignIn() {
    var email = getValue('signinEmail');
    var password = getValue('signinPassword');

    if (!email || !password) {
      showToast('Please enter your email and password.', true);
      return;
    }

    if (!supabaseClient) {
      // Placeholder path — no backend wired yet
      showToast('Sign-in is not connected yet. Check config.js.', true);
      return;
    }

    var btn = document.querySelector('#signinForm .auth-submit');
    var originalText = btn.textContent;
    btn.textContent = 'Signing in...';
    btn.disabled = true;

    supabaseClient.auth.signInWithPassword({ email: email, password: password })
      .then(function (result) {
        btn.textContent = originalText;
        btn.disabled = false;
        if (result.error) {
          showToast(result.error.message || 'Sign-in failed.', true);
          return;
        }
        showToast('Signed in! Redirecting to your client portal...');
        closeAuthModal();
        setTimeout(function () { window.location.href = 'client-portal.html'; }, 700);
      })
      .catch(function () {
        btn.textContent = originalText;
        btn.disabled = false;
        showToast('Something went wrong. Please try again.', true);
      });
  }

  function handleSignUp() {
    var name     = getValue('signupName');
    var email    = getValue('signupEmail');
    var password = getValue('signupPassword');

    if (!name || !email || !password) {
      showToast('Please fill in all fields.', true);
      return;
    }
    if (password.length < 8) {
      showToast('Password must be at least 8 characters.', true);
      return;
    }

    if (!supabaseClient) {
      showToast('Account creation is not connected yet. Check config.js.', true);
      return;
    }

    var btn = document.querySelector('#signupForm .auth-submit');
    var originalText = btn.textContent;
    btn.textContent = 'Creating account...';
    btn.disabled = true;

    supabaseClient.auth.signUp({
      email: email,
      password: password,
      options: { data: { full_name: name } }
    })
      .then(function (result) {
        btn.textContent = originalText;
        btn.disabled = false;
        if (result.error) {
          showToast(result.error.message || 'Sign-up failed.', true);
          return;
        }
        showToast('Account created! Check your email to confirm.');
        setAuthTab('signin');
      })
      .catch(function () {
        btn.textContent = originalText;
        btn.disabled = false;
        showToast('Something went wrong. Please try again.', true);
      });
  }

  function handleForgotPassword() {
    var email = getValue('signinEmail');
    if (!email) {
      showToast('Enter your email above, then click "Forgot password?" again.', true);
      return;
    }
    if (!supabaseClient) {
      showToast('Password reset is not connected yet. Check config.js.', true);
      return;
    }
    supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: new URL('reset-password.html', window.location.href).href
    })
      .then(function (result) {
        if (result.error) {
          showToast(result.error.message || 'Could not send reset email.', true);
        } else {
          showToast('Password reset link sent to your email.');
        }
      })
      .catch(function () {
        showToast('Something went wrong. Please try again.', true);
      });
  }

  /* ==================================================================
     9. Auth state (nav UI, session persistence, protected pages)
     ================================================================== */
  function initAuthState() {
    var signOutBtns = document.querySelectorAll('.js-signout');
    for (var i = 0; i < signOutBtns.length; i++) {
      signOutBtns[i].addEventListener('click', handleSignOut);
    }

    if (!supabaseClient) {
      // No Supabase config available — protected pages can't verify a
      // session, so send visitors back to the homepage.
      if (document.body.hasAttribute('data-protected')) {
        window.location.href = 'index.html';
      }
      return;
    }

    // Fires on sign-in, sign-out, token refresh, and on page load once the
    // session is restored from localStorage (session persistence).
    supabaseClient.auth.onAuthStateChange(function (event, session) {
      updateAuthUI(session);
      if (event === 'SIGNED_OUT' && document.body.hasAttribute('data-protected')) {
        window.location.href = 'index.html';
      }
    });

    supabaseClient.auth.getSession().then(function (result) {
      var session = result.data && result.data.session;
      updateAuthUI(session);
      if (document.body.hasAttribute('data-protected') && !session) {
        window.location.href = 'index.html';
      }
    });
  }

  var currentSession = null;

  function updateAuthUI(session) {
    currentSession = session || null;
    var signedIn = !!(session && session.user);

    var slotsOut = document.querySelectorAll('.auth-slot-signed-out');
    var slotsIn  = document.querySelectorAll('.auth-slot-signed-in');
    for (var i = 0; i < slotsOut.length; i++) slotsOut[i].classList.toggle('is-hidden', signedIn);
    for (var j = 0; j < slotsIn.length; j++)  slotsIn[j].classList.toggle('is-hidden', !signedIn);

    if (!signedIn) return;

    var meta = session.user.user_metadata || {};
    var fullName = meta.full_name || [meta.first_name, meta.last_name].filter(Boolean).join(' ') || session.user.email;
    var firstName = fullName.split(' ')[0];

    var portalLinks = document.querySelectorAll('.js-portal-link');
    for (var k = 0; k < portalLinks.length; k++) portalLinks[k].textContent = 'Hi, ' + firstName;

    var nameEls = document.querySelectorAll('.js-portal-username');
    for (var m = 0; m < nameEls.length; m++) nameEls[m].textContent = fullName;

    var emailEls = document.querySelectorAll('.js-portal-email');
    for (var n = 0; n < emailEls.length; n++) emailEls[n].textContent = session.user.email;

    var reviewName = document.getElementById('reviewName');
    if (reviewName) reviewName.value = fullName;
  }

  function handleSignOut() {
    if (!supabaseClient) return;
    supabaseClient.auth.signOut().then(function (result) {
      if (result.error) {
        showToast(result.error.message || 'Could not sign out.', true);
        return;
      }
      showToast('Signed out.');
      if (document.body.hasAttribute('data-protected')) {
        window.location.href = 'index.html';
      }
    });
  }

  /* ==================================================================
     10. Password reset (reset-password.html)
     ================================================================== */
  function initResetPassword() {
    var form = document.getElementById('resetPasswordForm');
    if (!form) return;

    if (!supabaseClient) {
      showToast('Password reset is not connected. Check config.js.', true);
      return;
    }

    // Supabase parses the recovery token from the URL when the client loads
    // and fires this event once that temporary session is ready.
    supabaseClient.auth.onAuthStateChange(function (event) {
      if (event === 'PASSWORD_RECOVERY') {
        var notice = document.getElementById('resetPasswordNotice');
        if (notice) notice.textContent = 'Enter your new password below.';
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw  = getValue('newPassword');
      var pw2 = getValue('confirmNewPassword');

      if (!pw || pw.length < 8) {
        showToast('Password must be at least 8 characters.', true);
        return;
      }
      if (pw !== pw2) {
        showToast('Passwords do not match.', true);
        return;
      }

      var btn = form.querySelector('.auth-submit');
      var originalText = btn.textContent;
      btn.textContent = 'Updating...';
      btn.disabled = true;

      supabaseClient.auth.updateUser({ password: pw })
        .then(function (result) {
          btn.textContent = originalText;
          btn.disabled = false;
          if (result.error) {
            showToast(result.error.message || 'Could not update password.', true);
            return;
          }
          showToast('Password updated! Redirecting to your client portal...');
          setTimeout(function () { window.location.href = 'client-portal.html'; }, 900);
        })
        .catch(function () {
          btn.textContent = originalText;
          btn.disabled = false;
          showToast('Something went wrong. Please try again.', true);
        });
    });
  }

  /* ==================================================================
     11. Testimonials / Reviews (homepage)
     ================================================================== */
  var SERVICE_BADGES = {
    'Japan Visa Assistance': 'Visa',
    'Flight Booking': 'Flights',
    'Hotel & Accommodation': 'Hotel',
    'Domestic Tour': 'Tours',
    'International Tour': 'Tours',
    'Travel Insurance': 'Insurance',
    'Airport Transfers': 'Transfers'
  };

  function starString(rating) {
    var full = Math.round(rating);
    return '★★★★★☆☆☆☆☆'.slice(5 - full, 10 - full);
  }

  function initTestimonials() {
    var grid = document.getElementById('testimonialGrid');
    if (!grid || !supabaseClient) return;

    supabaseClient
      .from('reviews')
      .select('*')
      .order('created_at', { ascending: false })
      .then(function (result) {
        if (result.error) return; // table not provisioned yet — leave empty state
        renderTestimonials(result.data || []);
      })
      .catch(function () { /* leave empty state */ });
  }

  function renderTestimonials(reviews) {
    var grid = document.getElementById('testimonialGrid');
    var empty = document.getElementById('testimonialEmpty');
    if (!grid) return;

    if (!reviews.length) return; // keep default empty state

    if (empty) empty.remove();
    grid.innerHTML = '';

    reviews.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'testimonial-card';

      var initials = (r.name || '?').trim().split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase();
      var badge = SERVICE_BADGES[r.service] || r.service || '';
      var dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

      card.innerHTML =
        '<div class="tc-stars" aria-hidden="true">' + starString(r.rating || 0) + '</div>' +
        '<p class="tc-text"></p>' +
        '<div class="tc-divider"></div>' +
        '<div class="tc-author">' +
          (r.photo_url
            ? '<img class="tc-avatar" src="' + r.photo_url + '" alt="" />'
            : '<div class="tc-avatar">' + initials + '</div>') +
          '<div>' +
            '<div class="tc-author-name"></div>' +
            '<div class="tc-author-meta">' +
              (badge ? '<span class="tc-badge">' + badge + '</span>' : '') +
              '<span class="tc-date">' + dateStr + '</span>' +
            '</div>' +
          '</div>' +
        '</div>';

      card.querySelector('.tc-text').textContent = r.review_text || '';
      card.querySelector('.tc-author-name').textContent = r.name || 'Calestia Client';
      grid.appendChild(card);
    });

    // Rating summary
    var count = reviews.length;
    var avg = reviews.reduce(function (s, r) { return s + (r.rating || 0); }, 0) / count;
    var scoreNum = document.getElementById('rsScoreNum');
    var rsStars = document.getElementById('rsStars');
    var rsCount = document.getElementById('rsCount');
    var rsBars = document.getElementById('rsBars');
    var heroRating = document.getElementById('heroRatingValue');

    if (scoreNum) scoreNum.textContent = avg.toFixed(1);
    if (rsStars) rsStars.textContent = starString(avg);
    if (rsCount) rsCount.textContent = count + (count === 1 ? ' review' : ' reviews');
    if (heroRating) heroRating.textContent = avg.toFixed(1) + '★';

    if (rsBars) {
      rsBars.innerHTML = '';
      for (var star = 5; star >= 1; star--) {
        var starCount = reviews.filter(function (r) { return Math.round(r.rating) === star; }).length;
        var pct = count ? (starCount / count) * 100 : 0;
        var row = document.createElement('div');
        row.className = 'rs-bar-row';
        row.innerHTML =
          '<span class="rs-bar-label">' + star + '★</span>' +
          '<span class="rs-bar-track"><span class="rs-bar-fill" style="width:' + pct + '%"></span></span>' +
          '<span class="rs-bar-count">' + starCount + '</span>';
        rsBars.appendChild(row);
      }
    }
  }

  /* ==================================================================
     12. Leave a Review (homepage)
     ================================================================== */
  function initReviewForm() {
    var form = document.getElementById('reviewForm');
    if (!form) return;

    var picker = document.getElementById('starPicker');
    var selectedRating = 0;

    if (picker) {
      var starBtns = picker.querySelectorAll('.star-btn');
      var paintStars = function (n) {
        for (var i = 0; i < starBtns.length; i++) {
          starBtns[i].classList.toggle('is-active', i < n);
        }
      };
      for (var i = 0; i < starBtns.length; i++) {
        starBtns[i].addEventListener('click', function () {
          selectedRating = parseInt(this.getAttribute('data-star'), 10);
          paintStars(selectedRating);
        });
      }
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      if (!currentSession || !currentSession.user) {
        showToast('Please sign in to leave a review.', true);
        return;
      }
      if (!supabaseClient) {
        showToast('Reviews are not connected yet. Check config.js.', true);
        return;
      }

      var service = getValue('reviewService');
      var text = getValue('reviewText');
      var photoInput = document.getElementById('reviewPhoto');
      var photoFile = photoInput && photoInput.files && photoInput.files[0];

      if (!service) { showToast('Please select the service you availed.', true); return; }
      if (!selectedRating) { showToast('Please select a star rating.', true); return; }
      if (!text || text.length < 10) { showToast('Please write a bit more about your experience.', true); return; }

      var btn = document.getElementById('reviewSubmitBtn');
      var originalHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>Submitting...</span>';

      var meta = currentSession.user.user_metadata || {};
      var fullName = meta.full_name || [meta.first_name, meta.last_name].filter(Boolean).join(' ') || currentSession.user.email;

      var insertReview = function (photoUrl) {
        supabaseClient.from('reviews').insert({
          user_id: currentSession.user.id,
          name: fullName,
          service: service,
          rating: selectedRating,
          review_text: text,
          photo_url: photoUrl || null
        }).then(function (result) {
          btn.disabled = false;
          btn.innerHTML = originalHTML;
          if (result.error) {
            showToast(result.error.message || 'Could not submit review.', true);
            return;
          }
          showToast('Thank you for your review!');
          form.reset();
          selectedRating = 0;
          if (picker) paintStars(0);
          var reviewName = document.getElementById('reviewName');
          if (reviewName) reviewName.value = fullName;
          initTestimonials();
        }).catch(function () {
          btn.disabled = false;
          btn.innerHTML = originalHTML;
          showToast('Something went wrong. Please try again.', true);
        });
      };

      if (photoFile) {
        var path = currentSession.user.id + '/' + Date.now() + '-' + photoFile.name;
        supabaseClient.storage.from('review-photos').upload(path, photoFile)
          .then(function (uploadResult) {
            if (uploadResult.error) { insertReview(null); return; }
            var pub = supabaseClient.storage.from('review-photos').getPublicUrl(path);
            insertReview(pub.data ? pub.data.publicUrl : null);
          })
          .catch(function () { insertReview(null); });
      } else {
        insertReview(null);
      }
    });
  }

  /* ==================================================================
     13. Tour package search & filters (tour-packages-domestic/international)
     ================================================================== */
  function initTourFilters() {
    var searchInput = document.getElementById('tourSearch');
    var categorySelect = document.getElementById('tourCategory');
    var cards = document.querySelectorAll('.tour-card');
    if (!cards.length || (!searchInput && !categorySelect)) return;

    function applyFilters() {
      var query = searchInput ? searchInput.value.trim().toLowerCase() : '';
      var category = categorySelect ? categorySelect.value : '';

      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var name = (card.getAttribute('data-name') || '').toLowerCase();
        var location = (card.getAttribute('data-location') || '').toLowerCase();
        var cardCategory = card.getAttribute('data-category') || '';

        var matchesQuery = !query || name.indexOf(query) !== -1 || location.indexOf(query) !== -1;
        var matchesCategory = !category || cardCategory === category;

        card.classList.toggle('is-filtered-out', !(matchesQuery && matchesCategory));
      }

      var grid = document.getElementById('tourGrid');
      var visibleCount = document.querySelectorAll('.tour-card:not(.is-filtered-out)').length;
      var noResults = document.getElementById('tourNoResults');
      if (noResults) noResults.classList.toggle('is-hidden', visibleCount > 0);
      if (grid) grid.classList.toggle('is-hidden', visibleCount === 0);
    }

    if (searchInput) searchInput.addEventListener('input', applyFilters);
    if (categorySelect) categorySelect.addEventListener('change', applyFilters);
  }

})();
