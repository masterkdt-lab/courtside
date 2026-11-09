// lib/email-confirm.js
// The guest confirmation sent after a trip request (POST /api/inquiry): an HTML email in the
// landing page's palette (paper #f8f6f0, green #344c3b, ink #302c24, rust #a45b3c, line #dedbd1)
// with the clay-court serve photo, plus a plain-text twin. Built for email clients: tables, inline
// styles, web-safe fonts (Georgia for the serif, Helvetica/Arial for text), a hosted JPEG, no
// scripts, no external CSS, 600 px wide, readable with images off and in dark mode.

export const SITE = 'https://courtsidetravel.co';
export const HERO_URL = `${SITE}/assets/email/hero-1200x600.jpg`;
export const TRIP_URL = `${SITE}/trips/spanish-offseason`;

const C = { paper: '#f8f6f0', card: '#ffffff', green: '#344c3b', ink: '#302c24', muted: '#777368', line: '#dedbd1', rust: '#a45b3c', pale: '#e9ede5' };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

// "Jan 17–23" -> "Jan 17–23, 2027"; several weeks joined; Flexible spelled out.
export function datesLine(weeks) {
  const w = String(weeks || '').trim();
  if (!w || /^flexible$/i.test(w)) return 'Flexible: Katie will help you choose a week';
  return w.split(/\s*,\s*/).map((x) => `${x}, 2027`).join(' · ');
}

// Group path: players + partners; match path: the party.
export function groupLine(row) {
  if (row.requestType === 'private') {
    const p = Number(row.players) || 0;
    const q = Number(row.partners) || 0;
    if (!p && !q) return 'Group size to be confirmed together';
    const parts = [];
    if (p) parts.push(`${p} player${p === 1 ? '' : 's'}`);
    if (q) parts.push(`${q} non-playing partner${q === 1 ? '' : 's'}`);
    return parts.join(' + ');
  }
  const party = String(row.partyType || '').trim();
  const label = { Solo: 'Just you', Couple: 'A couple', '2–3 friends': '2–3 friends' }[party] || party || 'Your party';
  return `${label}, joining a group Katie helps shape`;
}

// row: the Requests row (camelCase). groupUrl: the organizer's personal link for a group request.
export function confirmInquiry(row, { groupUrl = '' } = {}) {
  const name = firstName(row.guestName);
  const dates = datesLine(row.weeks);
  const group = groupLine(row);
  const ref = row.requestId;
  const cta = groupUrl
    ? { href: groupUrl, label: 'Open your group page', note: 'Your group page is where you invite your people. Keep this link to yourself: it opens your group without a password.' }
    : { href: TRIP_URL, label: 'Revisit the week', note: '' };
  const subject = 'Your Spanish Offseason request is in';
  const preheader = `${dates} · ${group}. Katie will be in touch personally.`;

  const text = [
    `Hi ${name || 'there'},`,
    '',
    'Thank you for your request for The Spanish Offseason. Katie is so excited to get back to you. She reads every request herself and will be in touch personally to shape your week.',
    '',
    'YOUR REQUEST',
    `Trip: The Spanish Offseason, Costa Blanca, Spain`,
    `Dates: ${dates}`,
    `Group: ${group}`,
    `Reference: ${ref}`,
    '',
    groupUrl ? `${cta.label}: ${groupUrl}\n${cta.note}` : `${cta.label}: ${TRIP_URL}`,
    '',
    'Nothing is reserved or charged yet. Courtside checks availability and prepares a personal proposal before anything is confirmed.',
    '',
    'See you on the court,',
    'Katie + the Courtside team',
    '',
    'Courtside Travel Co. · courtsidetravel.co',
    'Reply to this email to reach us.',
  ].join('\n');

  const row2 = (label, value) => `
            <tr>
              <td style="padding:14px 0;border-top:1px solid ${C.line};font:600 11px/1.4 ${SANS};letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};width:110px;vertical-align:top;">${label}</td>
              <td style="padding:14px 0;border-top:1px solid ${C.line};font:400 16px/1.45 ${SANS};color:${C.ink};vertical-align:top;">${value}</td>
            </tr>`;

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(subject)}</title>
<style>
  @media (max-width:620px){ .wrap{width:100%!important} .pad{padding-left:24px!important;padding-right:24px!important} .h1{font-size:30px!important;line-height:36px!important} .hero{height:auto!important} }
  a{color:${C.green}}
</style>
</head>
<body style="margin:0;padding:0;background:${C.paper};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>
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
          <td style="background:${C.card};border:1px solid ${C.line};border-radius:6px;overflow:hidden;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding:0;">
                  <img class="hero" src="${HERO_URL}" width="600" height="300" alt="A player serving on a sunlit clay court" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:6px 6px 0 0;background:${C.rust};">
                </td>
              </tr>
              <tr>
                <td class="pad" style="padding:38px 48px 8px;">
                  <div style="font:600 11px/1.4 ${SANS};letter-spacing:2px;text-transform:uppercase;color:${C.green};">Request received</div>
                  <h1 class="h1" style="margin:12px 0 0;font:400 36px/42px ${SERIF};color:${C.ink};letter-spacing:-0.5px;">Your week in Spain is <em style="font-style:italic;color:${C.rust};">taking shape.</em></h1>
                  <p style="margin:22px 0 0;font:400 16px/26px ${SANS};color:${C.ink};">Hi ${esc(name || 'there')},</p>
                  <p style="margin:12px 0 0;font:400 16px/26px ${SANS};color:${C.ink};">Thank you for your request for The Spanish Offseason. <strong style="font-weight:600;">Katie is so excited to get back to you.</strong> She reads every request herself and will be in touch personally to shape your week.</p>
                </td>
              </tr>
              <tr>
                <td class="pad" style="padding:26px 48px 4px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${row2('Trip', 'The Spanish Offseason<br><span style="color:' + C.muted + ';font-size:14px;">Costa Blanca, Spain · six nights</span>')}${row2('Dates', esc(dates))}${row2('Group', esc(group))}${row2('Reference', `<span style="font-family:${SANS};letter-spacing:0.5px;">${esc(ref)}</span>`)}
                    <tr><td colspan="2" style="border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</td></tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td class="pad" style="padding:22px 48px 0;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background:${C.green};border-radius:3px;">
                        <a href="${esc(cta.href)}" style="display:inline-block;padding:15px 26px;font:600 15px/1 ${SANS};color:#ffffff;text-decoration:none;">${cta.label} &#8599;</a>
                      </td>
                    </tr>
                  </table>
                  ${cta.note ? `<p style="margin:12px 0 0;font:400 13px/20px ${SANS};color:${C.muted};">${esc(cta.note)}</p>` : ''}
                </td>
              </tr>
              <tr>
                <td class="pad" style="padding:26px 48px 0;">
                  <div style="background:${C.pale};border-radius:4px;padding:16px 18px;font:400 14px/22px ${SANS};color:${C.ink};">Nothing is reserved or charged yet. Courtside checks availability and prepares a personal proposal before anything is confirmed.</div>
                </td>
              </tr>
              <tr>
                <td class="pad" style="padding:30px 48px 40px;">
                  <p style="margin:0;font:italic 400 20px/28px ${SERIF};color:${C.ink};">See you on the court,</p>
                  <p style="margin:4px 0 0;font:400 15px/22px ${SANS};color:${C.muted};">Katie + the Courtside team</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:22px 24px 0;font:400 12px/19px ${SANS};color:${C.muted};">
            Courtside Travel Co. · <a href="${SITE}" style="color:${C.muted};">courtsidetravel.co</a><br>
            Reply to this email to reach us. You're receiving this because you requested a trip on our site.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject, text, html };
}
