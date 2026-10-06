# Vale Reflexology — Website

A redesigned static website for **Vale Reflexology** (Kim Davis), Vale of Glamorgan.
No build step, no backend, no dependencies to install — plain HTML, CSS and JavaScript.

## Structure

```
index.html          Home
about.html           About Kim Davis
services.html        Services & prices, gift vouchers
faq.html             FAQ
testimonials.html    Client reviews
news.html            "Reflexology Weekly" — live content + Facebook/Instagram sharing
booking.html         Appointment request form
contact.html         Contact form
nav.html             Shared header/navigation (loaded into every page by script.js)
footer.html          Shared footer (loaded into every page by script.js)
styles.css           All styles (design tokens at the top)
script.js            All behaviour: nav, includes, reflex-zone map, news feed, booking, contact
```

`nav.html` and `footer.html` are injected into every page at load time (see
`loadPartials()` in `script.js`), so the header and footer only need to be edited
in **one place** rather than in all eight pages.

## Previewing locally

Because the header/footer are loaded with `fetch()`, **double-clicking a file
won't show the nav or footer** — browsers block `fetch()` on the `file://`
protocol. Serve the folder instead:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Any static server works (VS Code's "Live Server" extension, `npx serve`, etc.).
This limitation disappears once the site is deployed, since it'll be served over
`https://`.

## Deploying

The site is a Cloudflare Worker (static files in `site/` plus the booking API in `src/`).
Deploy with `npx wrangler deploy` from the repo root.

**Domains:** the canonical address is `https://www.valereflexology.com`. The bare
`valereflexology.com`, `valereflexology.co.uk` and `www.valereflexology.co.uk` all 301-redirect to it
(see `REDIRECT_HOSTS` in `src/index.ts`). Email is deliberately on `valereflexology.co.uk`
(Resend sending domain + Cloudflare Email Routing for `kim@valereflexology.co.uk`), so don't
change that domain's DNS email records.

## Notes

- **Contact email**: the contact form on the booking page opens the visitor's mail app addressed
  to `kim@valereflexology.co.uk`, which Cloudflare Email Routing forwards to Kim's inbox.
- **Social links**: the Facebook/Instagram icons in `footer.html` point to the
  generic `facebook.com` / `instagram.com` homepages — update to Vale
  Reflexology's actual profile URLs once created.

## How the dynamic bits work

- **Reflexology Weekly** (`news.html`) fetches recent reflexology/wellbeing
  news client-side on every visit (via Google News RSS through the free
  rss2json API) and falls back to a set of evergreen tips if that's ever
  unreachable. "Share to Facebook" opens Facebook's real share dialog — no
  setup needed. "Copy caption for Instagram" copies a ready caption, since no
  website can post to Instagram directly without a Meta Business/Developer
  integration.
- **Booking** (`booking.html`) is a request form, not a live synced calendar:
  it checks a simple in-memory list of taken slots for the session, then
  emails the request to Kim. For real-time availability that clients can book
  instantly, connect it to Wix Bookings, Fresha or Acuity instead.

## Fonts

Fraunces, Work Sans and IBM Plex Mono are loaded from Google Fonts via a
`<link>` tag in each page's `<head>` — no local font files to manage.
