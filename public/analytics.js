// public/analytics.js — Google Analytics 4 with Google Consent Mode v2, off until a measurement ID is set.
//
// GA_MEASUREMENT_ID below is the only setting (GA4_SETUP.md says where it comes from). While it is empty
// this file does nothing at all: no banner, no cookie, no request. Once it holds a "G-…" ID:
//   - consent defaults to denied before anything else runs;
//   - a small banner asks "Allow" / "No thanks" (choice kept in localStorage 'courtside-consent' =
//     'granted' | 'denied'); the footer gets a "Cookie settings" button that reopens it;
//   - gtag.js is requested from Google ONLY after Allow (or on load when Allow was chosen before);
//   - page views are sent by the SPA (app.js calls pageView on every navigation, with the route name only
//     for the private hash routes) or, on a page without the SPA (/privacy), once on load;
//   - lead(type) sends generate_lead with { lead_type } and nothing personal.
(function () {
  'use strict';
  const GA_MEASUREMENT_ID = 'G-E7TV4W9JDN';

  const KEY = 'courtside-consent';
  const api = { pageView() {}, lead() {}, event() {}, openSettings() {}, holdBanner() {} };
  window.courtsideAnalytics = api;
  if (!/^G-[A-Z0-9]{4,}$/.test(GA_MEASUREMENT_ID)) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });

  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* private mode: the choice lasts this visit */ } };
  let choice = read();
  let loaded = false;
  let current = null; // the last page view, sent once gtag is ready
  let returnFocus = null;

  function sendPage() {
    if (!loaded || !current) return;
    const location = window.location.origin + current.path;
    gtag('set', { page_location: location, page_title: current.title });
    gtag('event', 'page_view', { page_location: location, page_title: current.title });
  }

  function load() {
    gtag('consent', 'update', { analytics_storage: 'granted' });
    if (loaded) return;
    loaded = true;
    gtag('js', new Date());
    // Kept until the visitor clears them (KC): 400 days is the browser maximum; GA's default is 2 years,
    // which browsers cap anyway. Refreshed on each visit.
    gtag('config', GA_MEASUREMENT_ID, { send_page_view: false, cookie_expires: 400 * 24 * 60 * 60, cookie_update: true });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    document.head.appendChild(s);
    sendPage();
  }

  // Remove Google Analytics cookies (_ga, _ga_<id>) on this host and the parent domain after "No thanks".
  function clearCookies() {
    const host = window.location.hostname;
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0].trim();
      if (!/^_ga(_|$)/.test(name)) continue;
      for (const domain of ['', `; domain=${host}`, `; domain=.${host.replace(/^www\./, '')}`]) {
        document.cookie = `${name}=; Max-Age=0; path=/${domain}`;
      }
    }
  }

  function decide(value) {
    choice = value;
    write(value);
    if (value === 'granted') load();
    else {
      gtag('consent', 'update', { analytics_storage: 'denied' });
      clearCookies();
    }
    hide();
  }

  let banner = null;
  function build() {
    banner = document.createElement('section');
    banner.className = 'consent';
    banner.id = 'cs-consent';
    banner.setAttribute('aria-label', 'Cookie choice');
    banner.hidden = true;
    banner.innerHTML = '<p id="cs-consent-text">We use analytics cookies to understand how people find Courtside. Allow them? <a href="/privacy">Privacy</a></p>'
      + '<div class="consent-actions"><button type="button" class="btn mini" data-consent="granted">Allow</button>'
      + '<button type="button" class="outline mini" data-consent="denied">No thanks</button></div>';
    banner.setAttribute('aria-describedby', 'cs-consent-text');
    banner.addEventListener('click', (e) => {
      const b = e.target.closest('[data-consent]');
      if (b) decide(b.dataset.consent);
    });
    banner.addEventListener('keydown', (e) => { if (e.key === 'Escape' && choice) hide(); });
    document.body.appendChild(banner);
  }
  function show(focus) {
    if (!banner) build();
    banner.hidden = false;
    if (focus) banner.querySelector('button').focus();
  }
  function hide() {
    if (!banner || banner.hidden) return;
    const hadFocus = banner.contains(document.activeElement);
    banner.hidden = true;
    if (hadFocus && returnFocus && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  api.pageView = (path, title) => {
    current = { path: String(path || '/'), title: String(title || document.title) };
    sendPage();
  };
  api.lead = (type) => { if (loaded) gtag('event', 'generate_lead', { lead_type: String(type || '') }); };
  // Any other event (2026-11-24: the /spain pop-up's buttons, the private groups form's steps). Never personal data.
  api.event = (name, params = {}) => { if (loaded) gtag('event', String(name), params); };
  api.openSettings = () => { returnFocus = document.activeElement; show(true); };
  // While the /spain pop-up is open the banner waits (on a phone the pop-up covered it), then shows once it closes,
  // if the visitor still hasn't chosen (public/app.js showSpainPopup / closeSpainPopup).
  let held = false;
  api.holdBanner = (on) => {
    held = !!on;
    if (choice === 'granted' || choice === 'denied') return;
    if (held) hide(); else show(false);
  };

  if (choice === 'granted') load();

  function start() {
    const links = document.querySelector('.footlinks');
    if (links && !document.getElementById('cs-cookie-settings')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'cs-cookie-settings';
      b.className = 'linkbutton';
      b.textContent = 'Cookie settings';
      b.addEventListener('click', api.openSettings);
      links.appendChild(b);
    }
    if (choice !== 'granted' && choice !== 'denied' && !held && !document.getElementById('cs-popup')) show(false);
    if (!window.courtsideSPA) api.pageView(window.location.pathname, document.title);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}());
