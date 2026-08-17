/* Vale Reflexology — shared site behaviour */

document.addEventListener('DOMContentLoaded', async () => {
  await loadPartials();
  initNav();
  initReveal();
  initYear();
  initFootMap();
  initNews();
  initBooking();
  initContactForm();
});

/* ---------------- Shared nav/footer includes ---------------- */
/* Keeps the header and footer markup in one place (nav.html / footer.html)
   instead of duplicated in every page. Requires the site to be served over
   http/https (GitHub Pages, a local dev server, etc.) — browsers block
   fetch() of local files when a page is opened directly as file://. */
async function loadPartials() {
  const navSlot = document.getElementById('nav-include');
  const footerSlot = document.getElementById('footer-include');
  const jobs = [];
  if (navSlot) jobs.push(includeInto(navSlot, 'nav.html'));
  if (footerSlot) jobs.push(includeInto(footerSlot, 'footer.html'));
  await Promise.all(jobs);
  markActiveNavLink();
}

async function includeInto(slot, url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('not ok');
    slot.outerHTML = await res.text();
  } catch (err) {
    console.warn(`Could not load ${url} — if you're viewing this by double-clicking the file, serve it with a local server instead (e.g. "python3 -m http.server").`);
  }
}

function markActiveNavLink() {
  const page = (location.pathname.split('/').pop() || 'index.html');
  document.querySelectorAll('.nav-links a[data-page]').forEach(a => {
    if (a.dataset.page === page) a.classList.add('active');
  });
}

/* ---------------- Nav ---------------- */
function initNav() {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', () => {
    links.classList.toggle('open');
    const expanded = links.classList.contains('open');
    toggle.setAttribute('aria-expanded', expanded);
  });
  links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => links.classList.remove('open')));
}

/* ---------------- Scroll reveal ---------------- */
function initReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!items.length) return;
  if (!('IntersectionObserver' in window)) { items.forEach(i => i.classList.add('in')); return; }
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); } });
  }, { threshold: 0.15 });
  items.forEach(i => obs.observe(i));
}

function initYear() {
  document.querySelectorAll('.js-year').forEach(el => el.textContent = new Date().getFullYear());
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), 2600);
}

/* ---------------- Reflex zone map (signature element) ---------------- */
const ZONE_INFO = {
  head: { name: 'Head & Sinuses', text: 'The tips of the toes mirror the head, brain and sinuses — a common area of focus for tension headaches and migraines.' },
  chest: { name: 'Chest & Solar Plexus', text: 'The centre of the ball of the foot reflects the chest and solar plexus, often worked to ease tension and encourage a full, relaxed breath.' },
  lung: { name: 'Lungs & Shoulders', text: 'Just below the toes on the outer edge, this zone reflects the lungs and shoulders, often worked to ease tightness through the chest and upper back.' },
  kidneys: { name: 'Kidneys & Balance', text: 'The centre of the foot relates to the kidneys and adrenal glands, linked to energy levels and the body\u2019s stress response.' },
  digestion: { name: 'Stomach & Digestive System', text: 'The centre of the arch reflects the stomach and digestive system, a key area for clients managing IBS or general digestive discomfort.' },
  spine: { name: 'Spine & Nerves', text: 'The inner edge of the foot traces the spine, from neck to lower back — useful when working with back and neck pain.' },
  hormones: { name: 'Hormonal Balance', text: 'The ankle area corresponds to the reproductive and hormonal system, often a focus for PMS, cycles and menopause support.' }
};

function initFootMap() {
  const dots = document.querySelectorAll('.zone-dot');
  const nameEl = document.querySelector('.map-info .cond-name');
  const textEl = document.querySelector('.map-info .cond-text');
  if (!dots.length || !nameEl || !textEl) return;
  dots.forEach(dot => {
    dot.addEventListener('mouseenter', () => activateZone(dot));
    dot.addEventListener('focus', () => activateZone(dot));
    dot.addEventListener('click', () => activateZone(dot));
  });
  function activateZone(dot) {
    dots.forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    const key = dot.dataset.zone;
    const info = ZONE_INFO[key];
    if (info) { nameEl.textContent = info.name; textEl.textContent = info.text; }
  }
}

/* ---------------- Weekly reflexology news + social sharing ---------------- */
const NEWS_QUERY = '"reflexology" OR "reflexologist"';
// Google News pads sparse results with unrelated filler rather than returning nothing — this is
// the actual guard against off-topic stories slipping through, not the search query itself.
const RELEVANCE_PATTERN = /reflexolog/i;
// Crime/court stories occasionally mention "reflexology" in passing (e.g. an assault that
// happened during a session) — these must never reach a one-click "Share to Facebook" button,
// so they're excluded even if they'd otherwise pass the relevance check above.
const EXCLUDE_PATTERN = /assault|abuse|rape|sex offen|paedophil|pedophil|arrest|charged|court|jailed|prison|sentenc|guilty|convicted|crime|murder|attack|police|stalk|harass/i;
const MIN_RELEVANT_ITEMS = 2;
const FALLBACK_ARTICLES = [
  { title: 'Why reflexology sessions are becoming part of weekly self-care routines', source: 'Evergreen tip', link: 'https://www.valereflexology.com', summary: 'More clients are booking reflexology on a regular schedule, rather than as a one-off treat, to support ongoing stress management and sleep.' },
  { title: 'The link between foot health and everyday wellbeing', source: 'Evergreen tip', link: 'https://www.valereflexology.com', summary: 'Looking after the feet supports posture, circulation and balance — reflexology sessions are a relaxing way to build this into your routine.' },
  { title: 'Understanding holistic therapies alongside conventional care', source: 'Evergreen tip', link: 'https://www.valereflexology.com', summary: 'Reflexology is increasingly used alongside, not instead of, conventional healthcare — supporting relaxation and general wellbeing.' }
];

function initNews() {
  const list = document.querySelector('.js-news-list');
  if (!list) return;
  const updatedBadge = document.querySelector('.js-updated');
  const refreshBtn = document.querySelector('.js-refresh');
  const load = () => fetchWeeklyNews(list, updatedBadge);
  if (refreshBtn) refreshBtn.addEventListener('click', load);
  load();
}

async function fetchWeeklyNews(list, updatedBadge) {
  list.innerHTML = '<p><span class="spinner"></span>&nbsp; Fetching this week\u2019s reflexology &amp; wellbeing stories\u2026</p>';
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(NEWS_QUERY)}+when:90d&hl=en-GB&gl=GB&ceid=GB:en`;
  const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error('feed unavailable');
    const data = await res.json();
    if (!data.items || !data.items.length) throw new Error('no items');
    const relevant = data.items.filter(item => {
      const text = item.title + ' ' + item.description;
      return (RELEVANCE_PATTERN.test(item.title) || RELEVANCE_PATTERN.test(item.description)) && !EXCLUDE_PATTERN.test(text);
    });
    if (relevant.length < MIN_RELEVANT_ITEMS) throw new Error('not enough relevant items');
    renderNews(list, relevant.slice(0, 6).map(item => ({
      title: stripTags(item.title),
      source: (item.title.match(/- (.*?)$/) || [])[1] || 'Google News',
      link: item.link,
      summary: stripTags(item.description).slice(0, 220)
    })));
  } catch (err) {
    renderNews(list, FALLBACK_ARTICLES, true);
  }
  if (updatedBadge) updatedBadge.textContent = 'Last checked: ' + new Date().toLocaleString('en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' });
}

function stripTags(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; }

function renderNews(list, items, isFallback) {
  list.innerHTML = '';
  if (isFallback) {
    const note = document.createElement('p');
    note.className = 'updated-badge';
    note.style.marginBottom = '18px';
    note.textContent = 'Live feed unavailable right now, showing evergreen reflexology tips instead — try refreshing shortly.';
    list.appendChild(note);
  }
  items.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card news-card reveal in';
    const caption = buildCaption(item);
    card.innerHTML = `
      <span class="src">${escapeHtml(item.source)}</span>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary)}</p>
      <div class="news-actions">
        <a class="btn btn-fb" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(item.link)}&quote=${encodeURIComponent(item.title)}">Share to Facebook</a>
        <button class="btn btn-ig js-copy-ig" type="button">Copy caption for Instagram</button>
        <a class="btn btn-outline on-light" target="_blank" rel="noopener" href="${item.link}">Read source</a>
      </div>
      <div class="caption-box" hidden>${escapeHtml(caption)}</div>
    `;
    card.querySelector('.js-copy-ig').addEventListener('click', () => copyCaption(card, caption));
    list.appendChild(card);
  });
}

function buildCaption(item) {
  return `${item.title}\n\n${item.summary}\n\n🦶 Booking now at Vale Reflexology, Vale of Glamorgan.\nLink in bio to book with Kim.\n\n#Reflexology #ValeOfGlamorgan #HolisticHealth #Wellbeing #FootHealth #SelfCare`;
}

async function copyCaption(card, caption) {
  const box = card.querySelector('.caption-box');
  try {
    await navigator.clipboard.writeText(caption);
    box.hidden = false;
    showToast('Caption copied — paste it into a new Instagram post');
  } catch (err) {
    box.hidden = false;
    showToast('Couldn\u2019t access clipboard — caption shown below to copy manually');
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ---------------- Booking form ---------------- */
// Label text only — duration/price/package-eligibility are authoritative server-side
// (src/lib/availability.ts SERVICE_DEFS). Never trust this map for money or scheduling.
const SERVICE_DURATIONS = {
  'Free Discovery Call (15 min, free)': 15,
  'Initial Consultation (1hr 30, £65)': 90,
  'Follow-up Consultation (1hr, £45)': 60,
  'Home Visit — Foot Reflexology (1hr, £65)': 60
};

function initBooking() {
  const form = document.querySelector('.js-booking-form');
  if (!form) return;
  const serviceSel = form.querySelector('[name="service"]');
  const dateInput = form.querySelector('[name="date"]');
  const slotsWrap = form.querySelector('.js-slots');
  const summary = form.querySelector('.js-summary');
  const confirmPanel = document.querySelector('.js-confirm-panel');
  const creditBanner = form.querySelector('.js-pack-credit-banner');
  const emailInput = form.querySelector('[name="email"]');
  const submitBtn = form.querySelector('.js-booking-submit');
  let selectedSlot = null;

  Object.keys(SERVICE_DURATIONS).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    serviceSel.appendChild(opt);
  });

  const today = new Date();
  dateInput.min = today.toISOString().split('T')[0];

  async function buildSlots() {
    slotsWrap.innerHTML = '';
    selectedSlot = null;
    updateSummary();
    const service = serviceSel.value;
    const dateVal = dateInput.value;
    if (!service || !dateVal) return;
    const day = new Date(dateVal + 'T00:00:00').getDay();
    if (day === 0 || day === 6) {
      slotsWrap.innerHTML = '<p class="updated-badge">Kim sees clients Monday–Friday, 9:30am–3pm — please choose a weekday.</p>';
      return;
    }
    slotsWrap.innerHTML = '<p class="updated-badge"><span class="spinner"></span>&nbsp; Checking Kim’s diary…</p>';
    try {
      const res = await fetch(`/api/availability?service=${encodeURIComponent(service)}&date=${encodeURIComponent(dateVal)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'availability check failed');
      renderSlots(data.slots || []);
    } catch (err) {
      slotsWrap.innerHTML = '<p class="updated-badge">Couldn’t check availability right now — please try again in a moment.</p>';
    }
  }

  function renderSlots(slots) {
    slotsWrap.innerHTML = '';
    if (!slots.length) {
      slotsWrap.innerHTML = '<p class="updated-badge">No slots left for this day — try another date.</p>';
      return;
    }
    slots.forEach(label => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => {
        slotsWrap.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedSlot = label;
        updateSummary();
      });
      slotsWrap.appendChild(btn);
    });
  }

  function updateSummary() {
    const service = serviceSel.value;
    const dateVal = dateInput.value;
    if (service && dateVal && selectedSlot) {
      const niceDate = new Date(dateVal + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      summary.innerHTML = `<strong>${escapeHtml(service)}</strong><br>${niceDate} at ${selectedSlot}`;
      summary.parentElement.hidden = false;
    } else {
      summary.parentElement.hidden = true;
    }
  }

  async function checkPackageCredit() {
    const service = serviceSel.value;
    const email = emailInput.value.trim();
    creditBanner.classList.remove('show');
    if (!service || !email || !email.includes('@')) return;
    try {
      const res = await fetch(`/api/packages/credit?email=${encodeURIComponent(email)}&service=${encodeURIComponent(service)}`);
      const data = await res.json();
      creditBanner.classList.toggle('show', !!data.available);
    } catch (err) {
      // silent — this is a nice-to-have banner, not authoritative (the server re-checks on submit)
    }
  }

  serviceSel.addEventListener('change', () => { buildSlots(); checkPackageCredit(); });
  dateInput.addEventListener('change', buildSlots);
  emailInput.addEventListener('blur', checkPackageCredit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const service = serviceSel.value;
    const dateVal = dateInput.value;
    const name = form.querySelector('[name="name"]').value.trim();
    const email = form.querySelector('[name="email"]').value.trim();
    const phone = form.querySelector('[name="phone"]').value.trim();
    const notes = form.querySelector('[name="notes"]').value.trim();

    if (!service || !dateVal || !selectedSlot) { showToast('Please choose a service, date and time'); return; }
    if (!name || !email) { showToast('Please add your name and email'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Booking…';
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, date: dateVal, time: selectedSlot, name, email, phone, notes })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'booking failed');

      if (data.status === 'confirmed') {
        const niceDate = new Date(dateVal + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        if (confirmPanel) {
          confirmPanel.classList.add('show');
          confirmPanel.querySelector('.js-confirm-details').innerHTML = `<strong>${escapeHtml(service)}</strong><br>${niceDate} at ${selectedSlot}<br>${escapeHtml(name)} · ${escapeHtml(email)}`;
          confirmPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        form.reset();
        buildSlots();
      } else if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
    } catch (err) {
      showToast(err.message || 'Something went wrong — please try again');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Book this appointment';
    }
  });

  initBookingReturn(confirmPanel);
  initPackPurchase();
}

/* Handles landing back on booking.html after a Stripe redirect (paid/cancelled). */
function initBookingReturn(confirmPanel) {
  const params = new URLSearchParams(window.location.search);
  if (params.get('paid') === '1' && confirmPanel) {
    confirmPanel.classList.add('show');
    confirmPanel.querySelector('.js-confirm-details').innerHTML = 'Your payment went through — you’ll receive a calendar invite by email shortly.';
    confirmPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else if (params.get('cancelled') === '1') {
    const notice = document.querySelector('.js-cancelled-notice');
    if (notice) notice.hidden = false;
  }
}

/* ---------------- Session pack purchase ---------------- */
function initPackPurchase() {
  const buyForm = document.querySelector('.js-pack-buy-form');
  if (!buyForm) return;
  document.querySelectorAll('.js-pack-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      buyForm.querySelector('[name="pack_type"]').value = btn.dataset.pack;
      buyForm.classList.add('show');
      buyForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
  buyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pack_type = buyForm.querySelector('[name="pack_type"]').value;
    const name = buyForm.querySelector('[name="name"]').value.trim();
    const email = buyForm.querySelector('[name="email"]').value.trim();
    const phone = buyForm.querySelector('[name="phone"]').value.trim();
    if (!pack_type) { showToast('Please choose a pack above first'); return; }
    if (!name || !email) { showToast('Please add your name and email'); return; }
    const submitBtn = buyForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Redirecting…';
    try {
      const res = await fetch('/api/packages/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_type, name, email, phone })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'checkout failed');
      window.location.href = data.checkout_url;
    } catch (err) {
      showToast(err.message || 'Something went wrong — please try again');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue to payment';
    }
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get('pack_paid') === '1') {
    showToast('Pack purchased — you can now book sessions against it at any time');
  } else if (params.get('pack_cancelled') === '1') {
    showToast('Pack purchase cancelled');
  }
}

/* ---------------- Contact form (mailto fallback, no backend required) ---------------- */
function initContactForm() {
  const form = document.querySelector('.js-contact-form');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = form.querySelector('[name="name"]').value.trim();
    const email = form.querySelector('[name="email"]').value.trim();
    const subject = form.querySelector('[name="subject"]').value.trim() || 'Message from valereflexology.co.uk';
    const message = form.querySelector('[name="message"]').value.trim();
    if (!name || !email || !message) { showToast('Please fill in your name, email and message'); return; }
    const body = `${message}\n\n— ${name} (${email})`;
    window.location.href = `mailto:kim@valereflexology.co.uk?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const notice = form.querySelector('.js-contact-notice');
    if (notice) notice.classList.add('show');
  });
}
