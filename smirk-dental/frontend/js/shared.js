/* ═══════════════════════════════════════════
   SMIRK DENTAL — Shared JS (nav, footer, utils)
═══════════════════════════════════════════ */

// ── NAVBAR SCROLL EFFECT ──
(function () {
  const nav = document.querySelector('.navbar');
  if (!nav) return;
  const handler = () => nav.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', handler, { passive: true });
  handler();
})();

// ── HAMBURGER MENU ──
(function () {
  const btn = document.getElementById('hamburger');
  const menu = document.getElementById('mobileMenu');
  if (!btn || !menu) return;
  btn.addEventListener('click', () => {
    const open = menu.classList.toggle('open');
    btn.setAttribute('aria-expanded', open);
  });
  document.addEventListener('click', (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) menu.classList.remove('open');
  });
})();

// ── MARK ACTIVE NAV LINK ──
(function () {
  const path = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .mobile-menu a').forEach(a => {
    const href = a.getAttribute('href');
    if (!href) return;
    const cleanHref = href.split('/').pop();
    if (cleanHref === path) a.classList.add('active');
  });
})();

// ── INTERSECTION OBSERVER (fade-up) ──
(function () {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); } });
  }, { threshold: 0.08 });
  const init = () => document.querySelectorAll('.fade-up').forEach(el => obs.observe(el));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// ── TOAST NOTIFICATION ──
window.showToast = function (msg, type = 'success', duration = 3500) {
  let toast = document.getElementById('globalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalToast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('show'), duration);
};

// ── ANIMATED NUMBER COUNTER ──
window.animateCounter = function (el, end, suffix = '', duration = 1800) {
  const obs = new IntersectionObserver(([e]) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    let start = 0;
    const step = end / (duration / 16);
    const t = setInterval(() => {
      start = Math.min(start + step, end);
      el.textContent = (Number.isInteger(end) ? Math.floor(start) : start.toFixed(1)) + suffix;
      if (start >= end) clearInterval(t);
    }, 16);
  }, { threshold: 0.5 });
  obs.observe(el);
};

// ── SMOOTH INIT ALL COUNTERS ──
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-counter]').forEach(el => {
    const end = parseFloat(el.dataset.counter);
    const suffix = el.dataset.suffix || '';
    window.animateCounter(el, end, suffix);
  });
});

// ── NAVBAR HTML INJECTOR ──
// (Called inline in each page after DOM ready)
window.injectNav = function (activePage) {
  const isInPages = window.location.pathname.includes('/pages/');
  const base = isInPages ? '' : 'pages/';
  const homeBase = isInPages ? '../' : '';
  const pages = [
    { href: homeBase + 'index.html',       label: 'Home' },
    { href: base + 'services.html',        label: 'Services' },
    { href: base + 'gallery.html',         label: 'Gallery' },
    { href: base + 'doctor.html',          label: 'Doctor' },
    { href: base + 'appointment.html',     label: 'Appointment' },
    { href: base + 'contact.html',         label: 'Contact' }
  ];
  const links = pages.map(p =>
    `<li><a href="${p.href}" ${p.href === activePage ? 'class="active"' : ''}>${p.label}</a></li>`
  ).join('');
  const mobileLinks = pages.map(p =>
    `<a href="${p.href}">${p.label}</a>`
  ).join('');

  document.getElementById('navLinks').innerHTML = links;
  document.getElementById('mobileMenu').innerHTML = mobileLinks;
};
