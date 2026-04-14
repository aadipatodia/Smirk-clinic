/* ═══════════════════════════════════════════
   SMIRK DENTAL — Shared JS (nav, footer, utils)
═══════════════════════════════════════════ */

window.closeLogin = function () {
  document.getElementById('loginModal').style.display = 'flex';
};

window.loginUser = async function () {
  const name = document.getElementById('loginName').value;
  const phone = document.getElementById('loginPhone').value;

  console.log("LOGIN CLICKED", name, phone);

  try {
    const res = await fetch('http://localhost:5001/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone })
    });

    console.log("RAW RESPONSE:", res);

    const data = await res.json();

    console.log("LOGIN RESPONSE:", data);

    if (data.success) {
      localStorage.setItem('user', JSON.stringify(data.user));

      document.getElementById('loginModal').style.display = 'none';

      showToast("Logged in successfully ✅");

      location.reload();
    } else {
      alert("Login failed");
    }

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    alert("Login error — check console");
  }
};

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
    { href: homeBase + 'index.html', label: 'Home' },
    { href: base + 'services.html', label: 'Services' },
    { href: base + 'gallery.html', label: 'Gallery' },
    { href: base + 'doctor.html', label: 'Doctor' },
    { href: base + 'appointment.html', label: 'Appointment' },
    { href: base + 'contact.html', label: 'Contact' }
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

// ── FLOATING APPOINTMENT BANNER ──
// ── FLOATING APPOINTMENT BANNER ──
(function () {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const appt = JSON.parse(localStorage.getItem('userAppointment') || '{}');

  if (!appt.date || !appt.time) return;

  // 🔐 Only show for logged-in user
  if (!user.phone || appt.phone !== user.phone) return;

  const apptDateTime = new Date(`${appt.date} ${appt.time}`);
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
  );

  // Remove if past
  if (now > apptDateTime) {
    localStorage.removeItem('userAppointment');
    return;
  }

  const banner = document.createElement('div');
  banner.className = 'appt-banner';

  banner.innerHTML = `
  <span>
    🦷 Appointment with <strong>Dr. Mehak Gupta</strong> at 
    <strong>${appt.time}</strong> on 
    <strong>${new Date(appt.date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long'
  })}</strong>
  </span>

  <div style="display:flex;gap:6px;">
    <button onclick="rescheduleAppointment('${appt._id}')">↻</button>
    <button onclick="cancelAppointment('${appt._id}')">✖</button>
  </div>
`;

  document.body.appendChild(banner);
})();

window.closeLogin = function () {
  document.getElementById('loginModal').style.display = 'none';
};

async function loadUserAppointment() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  if (!user._id) return;

  const res = await fetch(`http://localhost:5001/appointments/user/${user._id}`);
  const data = await res.json();

  if (!data.success || !data.appointments.length) return;

  const appt = data.appointments[0];

  localStorage.setItem('userAppointment', JSON.stringify(appt));
}

window.cancelAppointment = async function (id) {
  if (!confirm("Cancel appointment?")) return;

  await fetch(`http://localhost:5001/appointments/${id}`, {
    method: 'DELETE'
  });

  // 🔥 CLEAR LOCAL DATA
  localStorage.removeItem('userAppointment');
  localStorage.removeItem('rescheduleId');

  // 🔥 FORCE REFRESH
  location.reload();
};

function updateAuthButton() {
  const btn = document.getElementById('loginBtn');
  if (!btn) return;

  const user = JSON.parse(localStorage.getItem('user'));

  if (user && user.phone) {
    // 🔥 LOGGED IN
    btn.textContent = "Logout";

    btn.onclick = () => {
      localStorage.removeItem('user');
      localStorage.removeItem('userAppointment');
      location.reload();
    };

  } else {
    // 🔥 NOT LOGGED IN
    btn.textContent = "Login";

    btn.onclick = () => {
      openLoginModal(); // your existing function
    };
  }
}

function updateAuthButton() {
  const user = JSON.parse(localStorage.getItem('user'));

  // 🔥 wait until button exists
  const interval = setInterval(() => {
    const btn = document.querySelector('button[onclick="loginUser()"]');

    if (!btn) return;

    clearInterval(interval);

    if (user && user.phone) {
      btn.textContent = "Logout";

      btn.onclick = () => {
        localStorage.removeItem('user');
        localStorage.removeItem('userAppointment');
        location.reload();
      };

    } else {
      btn.textContent = "Login";
      btn.onclick = loginUser;
    }

  }, 100);
}

window.rescheduleAppointment = function (id) {
  // Save appointment ID
  localStorage.setItem('rescheduleId', id);

  // 🔥 SMART REDIRECT (THIS IS YOUR CODE)
  const isInPages = window.location.pathname.includes('/pages/');
  window.location.href = isInPages
    ? "appointment.html?reschedule=true"
    : "pages/appointment.html?reschedule=true";
};

loadUserAppointment();