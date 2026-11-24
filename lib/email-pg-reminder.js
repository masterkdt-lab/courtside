// lib/email-pg-reminder.js
// The one reminder a guest gets when they start "Build your own tennis camp" (/#/build-your-camp) and stop before the
// last step (KC, 2026-11-24). Sent by the daily job in lib/private-groups.js. Same look as lib/email-confirm.js: the
// landing-page palette, the clay-court photo, web-safe fonts, tables and inline styles, plus a plain-text twin. The
// button reopens the form on the step where they stopped, with their answers filled in.

import { SITE, HERO_URL } from './email-confirm.js';

const C = { paper: '#f8f6f0', card: '#ffffff', green: '#344c3b', ink: '#302c24', muted: '#777368', line: '#dedbd1', rust: '#a45b3c' };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

export const resumeUrl = (requestId) => `${SITE}/#/build-your-camp?r=${encodeURIComponent(requestId)}`;

// row: a Private Groups row as listed by the store ({ 'Your name', Email, '1. Where', 'Request ID', ... }).
export function privateGroupReminder(row) {
  const name = firstName(row['Your name']);
  const where = String(row['1. Where'] || '').trim();
  const url = resumeUrl(row['Request ID']);
  const subject = 'Your tennis camp is almost ready to plan';
  const started = `You started planning your tennis camp${where ? ` to ${where}` : ''}.`;
  const lead = 'A few more questions and Katie can start shaping it around your group, your schedule and your style.';
  const text = [
    `Hi ${name || 'there'},`,
    '',
    `${started} ${lead}`,
    '',
    `Finish my trip: ${url}`,
    '',
    'Your answers are saved, so you can pick up where you left off. If plans have changed, just reply and let us know.',
    '',
    'Katie + the Courtside team',
    '',
    'Courtside Travel Co. · courtsidetravel.co',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(subject)}</title>
<style>@media (max-width:620px){ .wrap{width:100%!important} .pad{padding-left:24px!important;padding-right:24px!important} .h1{font-size:30px!important;line-height:36px!important} }</style></head>
<body style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(started)} Pick up where you left off.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};"><tr><td align="center" style="padding:32px 12px 40px;">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td align="center" style="padding:0 0 22px;"><a href="${SITE}" style="text-decoration:none;color:${C.ink};"><div style="font:400 30px/1 ${SERIF};color:${C.ink};letter-spacing:-0.5px;">Courtside</div><div style="font:600 10px/1 ${SANS};letter-spacing:3.5px;color:${C.muted};padding-top:6px;">TRAVEL CO.</div></a></td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:6px;overflow:hidden;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:0;"><img src="${HERO_URL}" width="600" height="300" alt="A player serving on a sunlit clay court" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:6px 6px 0 0;background:${C.rust};"></td></tr>
<tr><td class="pad" style="padding:38px 48px 8px;">
<div style="font:600 11px/1.4 ${SANS};letter-spacing:2px;text-transform:uppercase;color:${C.green};">Build your own tennis camp</div>
<h1 class="h1" style="margin:12px 0 0;font:400 36px/42px ${SERIF};color:${C.ink};letter-spacing:-0.5px;">Your trip is <em style="font-style:italic;color:${C.rust};">almost there.</em></h1>
<p style="margin:22px 0 0;font:400 16px/26px ${SANS};color:${C.ink};">Hi ${esc(name || 'there')},</p>
<p style="margin:12px 0 0;font:400 16px/26px ${SANS};color:${C.ink};">${esc(started)} ${esc(lead)}</p>
</td></tr>
<tr><td class="pad" style="padding:26px 48px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${C.green};border-radius:3px;"><a href="${esc(url)}" style="display:inline-block;padding:15px 26px;font:600 15px/1 ${SANS};color:#ffffff;text-decoration:none;">Finish my trip &#8599;</a></td></tr></table>
<p style="margin:12px 0 0;font:400 13px/20px ${SANS};color:${C.muted};">Your answers are saved, so you can pick up where you left off. If plans have changed, just reply and let us know.</p></td></tr>
<tr><td class="pad" style="padding:30px 48px 40px;"><p style="margin:0;font:400 15px/22px ${SANS};color:${C.muted};">Katie + the Courtside team</p></td></tr>
</table></td></tr>
<tr><td align="center" style="padding:22px 24px 0;font:400 12px/19px ${SANS};color:${C.muted};">Courtside Travel Co. · <a href="${SITE}" style="color:${C.muted};">courtsidetravel.co</a><br>You're receiving this once because you started a trip request on our site.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
