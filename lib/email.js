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
  return mode === 'resend' || mode === 'send' ? 'resend' : 'log';
}

// `to` may be an array or a comma-separated string (NOTIFY_EMAILS).
export function toRecipients(to) {
  const list = Array.isArray(to) ? to : String(to ?? '').split(',');
  return list.map((item) => String(item ?? '').trim()).filter(Boolean);
}

export async function sendEmail({ to, subject, text }, env = process.env) {
  const recipients = toRecipients(to);
  if (emailMode(env) === 'resend') return sendViaResend({ recipients, subject, text }, env);

  const at = new Date().toISOString();
  console.log(['----- EMAIL -----', `To: ${recipients.join(', ')}`, `Subject: ${subject}`, '', text, '----- END -----'].join('\n'));
  sentLog.push({ to: recipients, subject, text, at });
  return { ok: true, id: `log-${sentLog.length}` };
}

async function sendViaResend({ recipients, subject, text }, env) {
  const apiKey = String(env.EMAIL_API_KEY ?? '').trim();
  const from = String(env.FROM_EMAIL ?? '').trim();
  if (!apiKey || !from) return { ok: false, error: 'EMAIL_API_KEY and FROM_EMAIL must be set when EMAIL_MODE=resend' };
  if (!recipients.length) return { ok: false, error: 'no recipients' };
  try {
    const response = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: recipients, subject, text }),
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
