// public/js/home.js — the homepage's three enhancements (polish brief, section B). The page reads without it.
//   1. The sticky "Enter code" bar on phones, shown once the hero has scrolled out of view.
//   2. The waitlist capture under each lineup card and at the bottom close: opener button, inline form,
//      POST /api/waitlist, success and error states.
//   3. First-party events to POST /api/event (no_code_click, trip_card_open), fire and forget.
// No dependencies, no loader, nothing on scroll beyond the one IntersectionObserver.

const NETWORK = 'Couldn’t reach Courtside. Try again.';
const RATE_LIMITED = 'Too many tries from this connection. Wait a few minutes and try again.';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Events: sendBeacon when it takes the request, otherwise a keepalive fetch. Never awaited, never thrown.
function sendEvent(name, detail = '') {
  const json = JSON.stringify({ name, detail });
  try {
    if (navigator.sendBeacon && navigator.sendBeacon('/api/event', new Blob([json], { type: 'application/json' }))) return;
  } catch { /* fall through to fetch */ }
  try {
    fetch('/api/event', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json, keepalive: true }).catch(() => {});
  } catch { /* nothing to do */ }
}

// 1. Sticky bar: on while the hero is above the viewport. CSS hides the bar from 700px up and
// handles the slide (none under reduced motion); aria-hidden keeps it out of the accessibility
// tree while the hero is on screen, visibility:hidden keeps it out of the tab order.
const hero = document.querySelector('.home-hero');
const bar = document.querySelector('.sticky-cta');
if (hero && bar && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver(([entry]) => {
    const on = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
    bar.classList.toggle('is-on', on);
    bar.setAttribute('aria-hidden', String(!on));
  }, { threshold: 0 });
  observer.observe(hero);
}

// 3a. "Don't have an invite code?" is a plain anchor; the event rides along.
const noCode = document.querySelector('a.no-code');
if (noCode) noCode.addEventListener('click', () => sendEvent('no_code_click', ''));

// 2. Capture forms.
function setStatus(form, text, isError = false) {
  const status = form.querySelector('.form-status');
  status.textContent = text;
  status.classList.toggle('is-error', isError);
}

function successLine(form) {
  const trip = form.dataset.tripName;
  return trip
    ? `You’re on the list for ${trip}. Katie will be in touch when it opens.`
    : 'You’re on the list. Katie will be in touch when the lineup firms up.';
}

async function submit(form) {
  const email = form.querySelector('[name="email"]');
  const name = form.querySelector('[name="name"]');
  const consent = form.querySelector('[name="consent"]');
  const website = form.querySelector('[name="website"]');
  const button = form.querySelector('button[type="submit"]');

  const problems = [];
  if (!EMAIL.test(email.value.trim())) problems.push('Enter a working email address.');
  if (!consent.checked) problems.push('Tick the box so Courtside can keep your email.');
  if (problems.length) {
    setStatus(form, problems.join(' '), true);
    (problems[0].startsWith('Enter') ? email : consent).focus();
    return;
  }

  button.disabled = true;
  setStatus(form, 'Joining…');
  const body = JSON.stringify({
    email: email.value.trim(),
    name: name.value.trim(),
    tripId: form.dataset.trip,
    source: form.dataset.source,
    consent: true,
    website: website ? website.value : '',
  });
  let res;
  let data = {};
  try {
    res = await fetch('/api/waitlist', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    data = await res.json().catch(() => ({}));
  } catch {
    button.disabled = false;
    setStatus(form, NETWORK, true);
    return;
  }
  if (res.ok && data.ok) {
    form.classList.add('is-done');
    setStatus(form, successLine(form));
    return;
  }
  button.disabled = false;
  if (res.status === 429) setStatus(form, RATE_LIMITED, true);
  else if (res.status === 400 && data.errors && typeof data.errors === 'object') setStatus(form, Object.values(data.errors).join(' ') || NETWORK, true);
  else setStatus(form, NETWORK, true);
  email.focus();
}

for (const opener of document.querySelectorAll('button.waitlist-open[aria-controls]')) {
  const panel = document.getElementById(opener.getAttribute('aria-controls'));
  const form = panel && panel.querySelector('form.waitlist-form');
  if (!form) continue;

  const setOpen = (open) => {
    panel.classList.toggle('is-open', open);
    opener.setAttribute('aria-expanded', String(open));
    if (open) {
      form.querySelector('[name="email"]').focus();
      sendEvent('trip_card_open', form.dataset.trip);
    } else {
      opener.focus();
    }
  };

  opener.addEventListener('click', () => setOpen(opener.getAttribute('aria-expanded') !== 'true'));
  panel.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    setOpen(false);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(form);
  });
}
