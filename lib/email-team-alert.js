// lib/email-team-alert.js
// The team alert to Jeff and Katie (KC, 2026-11-24), sent every time someone requests a trip, in the look of the
// guest confirmation emails (lib/email-confirm.js: the landing-page palette, the Courtside wordmark, web-safe fonts,
// tables and inline styles, the same footer) plus a plain-text twin. Reply-To is the guest.
//   joinWeek     Soft Launch request, "Join a week"            (api/soft-launch.js)
//   wholeWeek    Soft Launch request, "Whole week"              (api/soft-launch.js)
//   privateGroup Private groups form, finished                 (lib/private-groups.js, step 3)
//   unfinished   Private groups form, stopped partway           (lib/private-groups.js runReminders, the daily job)
// The existing team@ emails stay as they are; this one is in addition.

import { SITE } from './email-confirm.js';
import { createSheetsClient, missingEnv } from './store.sheets.client.js';

export const TEAM_ALERT_TO = 'jk@nextwave.bet, katie.dellich@gmail.com';

const C = { paper: '#f8f6f0', card: '#ffffff', green: '#344c3b', ink: '#302c24', muted: '#777368', line: '#dedbd1', rust: '#a45b3c', pale: '#e9ede5' };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = (v) => String(v ?? '').trim() !== '';

const TYPES = Object.freeze({
  joinWeek: { subject: (n) => `New trip request: ${n} wants to join a group`, top: 'Another person requested a trip.', label: 'Wants to join a group · The Spanish Offseason', tab: 'Soft Launch' },
  wholeWeek: { subject: (n) => `New trip request: ${n} wants their own private group`, top: 'Another person requested a trip.', label: 'Wants their own private group · The Spanish Offseason', tab: 'Soft Launch' },
  privateGroup: { subject: (n) => `New private group request: ${n}`, top: 'Another person requested a trip.', label: 'Private group form · Build your own tennis camp', tab: 'Private Groups' },
  unfinished: { subject: (n) => `Unfinished request: ${n} started the private group form`, top: 'Someone started a private group request but didn’t finish.', label: 'Unfinished private group request · they got one reminder email today', tab: 'Private Groups' },
});

// The answers, question on the left, answer on the right, empty ones skipped.
export function softLaunchAnswers(row) {
  return [
    ['How they’d like to come', row.kind === 'Whole week' ? 'Reserve the whole week for my group' : 'Join a week'],
    ['Preferred timing', row.timing],
    ['Notes', row.notes],
    ['Came from', row.source],
  ];
}
// Works for a row as the steps write it (camelCase) and as the store lists it (the Sheet's headers).
export function privateGroupAnswers(row) {
  const g = (camel, header) => row[camel] ?? row[header] ?? '';
  const stage = g('stage', 'Stage');
  return [
    ['1. Where would you like to go?', g('where', '1. Where')],
    ['2. When would you like to go?', g('when', '2. When')],
    ['3. How many tennis players?', g('players', '3. Tennis players')],
    ['4. How many days of tennis?', g('days', '4. Days of tennis')],
    ['5. Group’s level', g('level', '5. Group level')],
    ['6. What they’d love to focus on', g('focus', '6. Focus')],
    ['7. Accommodations', g('accommodations', '7. Accommodations')],
    ['8. Anything else', g('notes', '8. Anything else')],
    ['Stopped at', stage && stage !== 'Complete' ? (stage === 'Started' ? 'Step 1 of 3 (contact, where, when)' : 'Step 2 of 3 (tennis details)') : ''],
    ['Came from', g('source', 'Source')],
    ['Request ID', g('requestId', 'Request ID')],
  ];
}

// The Sheet tab's own link (…/edit#gid=N), or the Sheet's SHEET_URL, or '' (then no button).
export async function sheetTabUrl(tab, env = process.env) {
  const base = String(env.SHEET_URL ?? '').trim();
  if (missingEnv(env).length) return base;
  try {
    const client = createSheetsClient({ env });
    const meta = await client.getSpreadsheet('sheets.properties(sheetId,title)');
    const hit = (meta.sheets || []).find((s) => s.properties.title === tab);
    return hit ? `https://docs.google.com/spreadsheets/d/${client.sheetId}/edit#gid=${hit.properties.sheetId}` : base;
  } catch {
    return base;
  }
}

// type: one of TYPES; contact: { name, email, phone? }; answers: [[question, answer]]; submitted: "2026-11-24 3:02 PM".
export function teamAlert({ type, contact, answers, submitted, submittedLabel = 'Submitted', sheetUrl = '' }) {
  const t = TYPES[type];
  if (!t) throw new Error(`teamAlert: unknown type ${type}`);
  const name = String(contact.name || '').trim() || 'Someone';
  const subject = t.subject(name);
  const rows = answers.filter(([, a]) => has(a));
  const when = has(submitted) ? `${submitted} (Pacific)` : '';

  const text = [
    t.top,
    t.label,
    '',
    'CONTACT',
    `Name: ${name}`,
    `Email: ${contact.email}`,
    ...(has(contact.phone) ? [`Phone: ${contact.phone}`] : []),
    '',
    'THEIR ANSWERS',
    ...rows.map(([q, a]) => `${q}: ${a}`),
    '',
    ...(when ? [`${submittedLabel}: ${when}`] : []),
    ...(sheetUrl ? [`Open the Sheet (${t.tab} tab): ${sheetUrl}`] : []),
    '',
    'Reply to this email to reach them directly.',
    '',
    'Courtside Travel Co. · courtsidetravel.co',
  ].join('\n');

  const line = (label, value) => `
              <tr>
                <td style="padding:12px 16px 12px 0;border-top:1px solid ${C.line};font:600 13px/1.45 ${SANS};color:${C.muted};width:42%;vertical-align:top;">${esc(label)}</td>
                <td style="padding:12px 0;border-top:1px solid ${C.line};font:400 15px/1.45 ${SANS};color:${C.ink};vertical-align:top;">${value}</td>
              </tr>`;
  const mail = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent('Your Courtside trip')}`;

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(subject)}</title>
<style>
  @media (max-width:620px){ .wrap{width:100%!important} .pad{padding-left:22px!important;padding-right:22px!important} .h1{font-size:26px!important;line-height:32px!important} .q{width:40%!important} }
  a{color:${C.green}}
</style>
</head>
<body style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(t.label)} · ${esc(name)} · ${esc(contact.email)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};">
  <tr>
    <td align="center" style="padding:32px 12px 40px;">
      <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
        <tr>
          <td align="center" style="padding:0 0 22px;">
            <a href="${SITE}" style="text-decoration:none;color:${C.ink};">
              <div style="font:400 30px/1 ${SERIF};color:${C.ink};letter-spacing:-0.5px;">Courtside</div>
              <div style="font:600 10px/1 ${SANS};letter-spacing:3.5px;color:${C.muted};padding-top:6px;">TRAVEL CO.</div>
            </a>
          </td>
        </tr>
        <tr>
          <td style="background:${C.card};border:1px solid ${C.line};border-radius:6px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="pad" style="padding:34px 40px 6px;">
                  <div style="font:600 11px/1.4 ${SANS};letter-spacing:2px;text-transform:uppercase;color:${type === 'unfinished' ? C.rust : C.green};">${type === 'unfinished' ? 'Unfinished request' : 'New trip request'}</div>
                  <h1 class="h1" style="margin:12px 0 0;font:400 30px/36px ${SERIF};color:${C.ink};letter-spacing:-0.5px;">${esc(t.top)}</h1>
                  <div style="margin:16px 0 0;display:inline-block;background:${C.pale};border-radius:3px;padding:8px 12px;font:600 13px/1.4 ${SANS};color:${C.green};">${esc(t.label)}</div>
                </td>
              </tr>
              <tr>
                <td class="pad" style="padding:24px 40px 0;">
                  <div style="font:600 11px/1.4 ${SANS};letter-spacing:2px;text-transform:uppercase;color:${C.muted};padding-bottom:8px;">Contact</div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${line('Name', esc(name))}${line('Email', `<a href="${esc(mail)}" style="color:${C.green};text-decoration:underline;">${esc(contact.email)}</a>`)}${has(contact.phone) ? line('Phone', `<a href="tel:${esc(String(contact.phone).replace(/[^\d+]/g, ''))}" style="color:${C.green};">${esc(contact.phone)}</a>`) : ''}
                    <tr><td colspan="2" style="border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</td></tr>
                  </table>
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;"><tr><td style="border:1px solid ${C.green};border-radius:3px;"><a href="${esc(mail)}" style="display:inline-block;padding:11px 18px;font:600 14px/1 ${SANS};color:${C.green};text-decoration:none;">Email ${esc(name.split(/\s+/)[0])} &#8599;</a></td></tr></table>
                </td>
              </tr>
              <tr>
                <td class="pad" style="padding:28px 40px 0;">
                  <div style="font:600 11px/1.4 ${SANS};letter-spacing:2px;text-transform:uppercase;color:${C.muted};padding-bottom:8px;">Their answers</div>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.map(([q, a]) => line(q, esc(a))).join('')}
                    <tr><td colspan="2" style="border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</td></tr>
                  </table>
                  ${when ? `<p style="margin:14px 0 0;font:400 13px/20px ${SANS};color:${C.muted};">${esc(submittedLabel)}: ${esc(when)}</p>` : ''}
                </td>
              </tr>
              ${sheetUrl ? `<tr>
                <td class="pad" style="padding:24px 40px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${C.green};border-radius:3px;"><a href="${esc(sheetUrl)}" style="display:inline-block;padding:15px 26px;font:600 15px/1 ${SANS};color:#ffffff;text-decoration:none;">Open the Sheet &#8599;</a></td></tr></table>
                  <p style="margin:10px 0 0;font:400 12px/18px ${SANS};color:${C.muted};">Opens the ${esc(t.tab)} tab.</p>
                </td>
              </tr>` : ''}
              <tr><td class="pad" style="padding:28px 40px 34px;"><p style="margin:0;font:400 14px/22px ${SANS};color:${C.muted};">Hit Reply to reach ${esc(name.split(/\s+/)[0])} directly.</p></td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:22px 24px 0;font:400 12px/19px ${SANS};color:${C.muted};">
            Courtside Travel Co. · <a href="${SITE}" style="color:${C.muted};">courtsidetravel.co</a><br>
            Team alert for Jeff and Katie. Sent automatically when someone requests a trip.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, text, html, replyTo: contact.email };
}
