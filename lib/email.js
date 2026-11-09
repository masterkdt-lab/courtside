// lib/email.js
// Send or log email, by env (plan 4.0, 4.5). EMAIL_MODE=log (the default; tests and local dev)
// prints each email as a delimited block and pushes it onto `sentLog`; EMAIL_MODE=resend posts to
// Resend over fetch (no SDK). "send" is accepted as an alias of "resend" to match .env.example.
// sendEmail never throws: it returns { ok, id } or { ok: false, error }.

export const RESEND_URL = 'https://api.resend.com/emails';
export const TRIP_NAME = 'The Spanish Offseason';

export const sentLog = [];

export function _resetSentLog() {
  sentLog.length = 0;
}

export function emailMode(env = process.env) {
  const mode = String(env.EMAIL_MODE ?? 'log').trim().toLowerCase();
  if (mode === 'gmail') return 'gmail';
  return mode === 'resend' || mode === 'send' ? 'resend' : 'log';
}

// EMAIL_MODE=gmail: send through Google Workspace as FROM_EMAIL (team@courtsidetravel.co) using the
// same service account as the Sheet (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY) with
// domain-wide delegation limited to the gmail.send scope (set up once by a Workspace admin, see
// README "Email"). The message is a plain-text RFC 2822 email posted to the Gmail API; it lands in
// team@'s Sent folder like any email sent by hand.
export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const FROM_NAME = 'Courtside Travel Co.';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const b64url = (s) => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// RFC 2047 encoded-word for any header that is not plain ASCII (names with "–", "’", accents).
const header = (v) => (/^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`);

const wrap76 = (s) => b64(s).replace(/(.{76})/g, '$1\r\n');

// Plain text, or multipart/alternative (text + HTML) when `html` is given.
export function buildMime({ from, fromName = FROM_NAME, to, subject, text, html = '', replyTo = '' }) {
  const head = [
    `From: ${header(fromName)} <${from}>`,
    `To: ${to.join(', ')}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${header(subject)}`,
    'MIME-Version: 1.0',
  ];
  if (!html) return [...head, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(text)].join('\r\n');
  const boundary = `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return [
    ...head,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap76(html),
    `--${boundary}--`, '',
  ].join('\r\n');
}

let gmailJwt = null;
async function gmailToken(env) {
  const { normalizePrivateKey } = await import('./store.sheets.client.js');
  const email = String(env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '').trim();
  const key = normalizePrivateKey(env.GOOGLE_PRIVATE_KEY);
  const subject = String(env.FROM_EMAIL ?? '').trim();
  const { JWT } = await import('google-auth-library');
  if (!gmailJwt || gmailJwt.email !== email || gmailJwt.key !== key || gmailJwt.subject !== subject) {
    gmailJwt = { email, key, subject, client: new JWT({ email, key, subject, scopes: [GMAIL_SCOPE] }) };
  }
  const { token } = await gmailJwt.client.getAccessToken();
  return token;
}

async function sendViaGmail({ recipients, subject, text, html, replyTo }, env, deps = {}) {
  const from = String(env.FROM_EMAIL ?? '').trim();
  if (!from || !String(env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? '').trim() || !String(env.GOOGLE_PRIVATE_KEY ?? '').trim()) {
    return { ok: false, error: 'FROM_EMAIL, GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set when EMAIL_MODE=gmail' };
  }
  if (!recipients.length) return { ok: false, error: 'no recipients' };
  try {
    const token = await (deps.getToken || gmailToken)(env);
    const raw = b64url(buildMime({ from, to: recipients, subject, text, html, replyTo }));
    const response = await (deps.fetch || fetch)(GMAIL_SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (!response.ok) return { ok: false, error: data?.error?.message || `Gmail responded ${response.status}` };
    return { ok: true, id: data?.id ?? '' };
  } catch (err) {
    // unauthorized_client here means domain-wide delegation is missing or lacks the gmail.send scope.
    return { ok: false, error: err?.message || String(err) };
  }
}

// `to` may be an array or a comma-separated string (NOTIFY_EMAILS).
export function toRecipients(to) {
  const list = Array.isArray(to) ? to : String(to ?? '').split(',');
  return list.map((item) => String(item ?? '').trim()).filter(Boolean);
}

export async function sendEmail({ to, subject, text, html = '', replyTo = '' }, env = process.env, deps = {}) {
  const recipients = toRecipients(to);
  if (emailMode(env) === 'gmail') return sendViaGmail({ recipients, subject, text, html, replyTo }, env, deps);
  if (emailMode(env) === 'resend') return sendViaResend({ recipients, subject, text, html }, env);

  const at = new Date().toISOString();
  console.log(['----- EMAIL -----', `To: ${recipients.join(', ')}`, `Subject: ${subject}`, '', text, '----- END -----'].join('\n'));
  sentLog.push({ to: recipients, subject, text, ...(html ? { html } : {}), at });
  return { ok: true, id: `log-${sentLog.length}` };
}

async function sendViaResend({ recipients, subject, text, html }, env) {
  const apiKey = String(env.EMAIL_API_KEY ?? '').trim();
  const from = String(env.FROM_EMAIL ?? '').trim();
  if (!apiKey || !from) return { ok: false, error: 'EMAIL_API_KEY and FROM_EMAIL must be set when EMAIL_MODE=resend' };
  if (!recipients.length) return { ok: false, error: 'no recipients' };
  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, text, ...(html ? { html } : {}) }),
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) {
      return { ok: false, error: data?.message || data?.error || `Resend responded ${response.status}` };
    }
    return { ok: true, id: data?.id ?? '' };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// Templates (plan 4.5; notifyInquiry from CONCEPT02_PLAN.md). `row` is the Requests row as
// written: camelCase keys, display values.

export function notifyKatie(row, { sheetUrl = '' } = {}) {
  const email = row.guestEmail ? row.guestEmail : 'no guest email on this invite';
  const text = [
    `New request for ${TRIP_NAME}`,
    '',
    `Request ID: ${row.requestId}`,
    `Type: ${row.requestType}`,
    `Weeks: ${row.weeks}`,
    `Guest: ${row.guestName || '—'}`,
    `Email: ${email}`,
    `Mobile: ${row.guestMobile || '—'}`,
    `Invite code: ${row.inviteCode} (invited by ${row.invitedBy || '—'})`,
    '',
    'Trip brief:',
    '',
    row.brief,
    '',
    sheetUrl ? `Sheet: ${sheetUrl}` : 'Sheet: (SHEET_URL is not set)',
  ].join('\n');
  return { subject: `New request ${row.requestId} · ${row.requestType} · ${row.weeks}`, text };
}

// The Katie notification for a Concept 02 inquiry (POST /api/inquiry, CONCEPT02_PLAN.md). The row
// is the Requests row as written: requestType private = "Private group", vetted = "Group match";
// the brief already carries every answer, so the header lines stay short. No guest email is sent.
export function notifyInquiry(row, { sheetUrl = '' } = {}) {
  const kind = row.requestType === 'private' ? 'Private group' : 'Group match';
  const invite = row.inviteCode ? `${row.inviteCode} (invited by ${row.invitedBy || '—'})` : 'none (public trip page)';
  const text = [
    `New Concept 02 request for ${TRIP_NAME}`,
    '',
    `Request ID: ${row.requestId}`,
    `Type: ${kind}`,
    `Weeks: ${row.weeks}`,
    `Name: ${row.guestName || '—'}`,
    `Email: ${row.guestEmail || '—'}`,
    `Invite code: ${invite}`,
    '',
    'Brief:',
    '',
    row.brief,
    '',
    sheetUrl ? `Sheet: ${sheetUrl}` : 'Sheet: (SHEET_URL is not set)',
  ].join('\n');
  return { subject: `New request ${row.requestId} · ${kind} · ${row.weeks}`, text };
}

export function confirmGuest(row) {
  const text = [
    "You're on our list.",
    '',
    `${row.guestName ? `Hi ${row.guestName}, your` : 'Your'} request ${row.requestId} for ${TRIP_NAME} has reached Katie. Katie reviews each request personally and will be in touch.`,
    '',
    'Your trip brief:',
    '',
    row.brief,
    '',
    'Courtside Travel Co.',
  ].join('\n');
  return { subject: `You're on our list — ${TRIP_NAME} (${row.requestId})`, text };
}

// Team notifications for the two public forms that had none (sent to NOTIFY_EMAILS).
export function notifyWaitlist(row, { sheetUrl = '' } = {}) {
  const text = [
    'New waitlist sign-up',
    '',
    `Email: ${row.email}`,
    `Name: ${row.name || '—'}`,
    `Interested in: ${row.trip || '—'}`,
    `From: ${row.source || '—'}`,
    '',
    sheetUrl ? `Sheet: ${sheetUrl}` : '',
  ].join('\n').trim();
  return { subject: `Waitlist · ${row.trip || 'General'} · ${row.email}`, text, replyTo: row.email };
}

export function notifyApplication(row, { sheetUrl = '' } = {}) {
  const text = [
    'New host application',
    '',
    `Name: ${row.name}`,
    `Email: ${row.email}`,
    `Club: ${row.club}`,
    `Introduced by: ${row.referral || '—'}`,
    `Would love to take them to: ${row.destination}`,
    '',
    'Background:',
    row.background,
    '',
    'Community:',
    row.community,
    '',
    sheetUrl ? `Sheet: ${sheetUrl}` : '',
  ].join('\n').trim();
  return { subject: `Host application · ${row.name} · ${row.club}`, text, replyTo: row.email };
}
