# Calestia Travel & Tours — Static Site

Plain HTML/CSS/JS conversion of the original Next.js project. No build step,
no npm install. Just open `index.html` in a browser (or run VS Code's Live
Server extension for auto-reload).

## Structure

```
calestia-website/
├── index.html              Main landing page (all sections)
├── flight-booking.html     Coming-soon placeholder
├── tour-packages.html      Coming-soon placeholder
├── travel-insurance.html   Coming-soon placeholder
├── airport-transfers.html  Coming-soon placeholder
├── style.css               All styles (design tokens + sections + modal + responsive)
├── script.js               All JS (petals, nav, form, modal, Supabase-ready auth)
├── assets/
│   └── images/
│       ├── calestia-logo.png    ← copy from your Next.js public/images/
│       └── route-map.png        ← copy from your Next.js public/images/
└── README.md
```

## First run

1. Copy your two image files from the old Next.js project's
   `public/images/` folder into `assets/images/` here. File names must match:
   - `calestia-logo.png`
   - `route-map.png`
2. Open `index.html` in a browser, or right-click → **Open with Live Server**
   in VS Code.

That's it. The contact form is already wired to your EmailJS account and
will send inquiries the moment the page loads.

## What's preserved from the original

- Full design system (sky/navy palette, Poppins, 26px radius, soft shadows)
- Falling sakura petals animation in the hero
- Sticky glass navbar with hamburger + slide-in mobile menu
- All 6 sections: Hero, Services, Process, Requirements, Why Us, Contact
- Contact form → EmailJS (`service_y33oto9` / `template_svk1i9k`)
- Toast notifications
- Fade-in on scroll (IntersectionObserver)
- Full responsive breakpoints (1024 / 900 / 767 / 480)

## What's new / to wire up

### Auth modal (Supabase-ready)
The **Sign In / Create Account** modal UI is fully built. To enable real auth:

1. In `index.html`, uncomment the Supabase script tag (near the bottom):
   ```html
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
   ```
2. In `script.js`, fill in your credentials near the top:
   ```js
   var SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
   var SUPABASE_ANON_KEY = 'your-anon-key';
   ```
3. The sign-in, sign-up, and forgot-password flows will start working
   automatically. Toast notifications show success/error messages.

Until then, the modal shows friendly toasts explaining the wiring is
pending — nothing breaks.

## Planned features (from your roadmap)

These are ready to build on top of the current structure:

- Client portal / dashboard (dashboard.html)
- Visa application system (application-form.html)
- Application tracking (track.html)
- Admin panel UI (admin/index.html)
- Payment integration (Stripe/PayMongo placeholders)
- Booking management, notifications, email integration

When you ask for any of these, they'll follow the same file layout: a new
top-level `.html`, styles added to `style.css`, and logic added to
`script.js` (or a dedicated `dashboard.js` when the file grows).

## Notes

- The site is fully static — no backend calls except EmailJS (contact form)
  and, once wired, Supabase (auth). Both are third-party CDN scripts.
- All animations respect `prefers-reduced-motion`.
- All interactive controls hit the 44px minimum tap target.
- Semantic HTML5 (`<nav>`, `<section>`, `<main>`, `<footer>`, `role="dialog"`
  on the modal, `aria-*` attributes where appropriate).
