import type { Env } from '../env';
import { deleteCalendarEvent, listEvents } from '../lib/graph';
import { sendEmail } from '../lib/email';
import { confirmBooking, type BookingRow as FullBookingRow } from './stripeWebhook';
import { reconcilePayments } from '../lib/reconcile';
import { json, errorResponse } from '../lib/http';

interface BookingRow {
  id: string;
  graph_event_id: string | null;
  status: string;
}

// SETUP_KEY-gated cancel: removes the Graph calendar event (if any) and marks the booking row
// cancelled. Used for admin cleanup — e.g. removing a test booking — and doubles as the mechanism
// for Kim to cancel a real booking on request.
export async function handleAdminCancelBooking(env: Env, url: URL): Promise<Response> {
  const setupKey = (url.searchParams.get('setup_key') ?? '').trim();
  const expectedKey = (env.SETUP_KEY ?? '').trim();
  if (!expectedKey || setupKey !== expectedKey) return errorResponse('forbidden', 403);

  const bookingId = url.searchParams.get('booking_id');
  if (!bookingId) return errorResponse('booking_id query param is required');

  const booking = await env.DB.prepare(`SELECT id, graph_event_id, status FROM bookings WHERE id = ?`)
    .bind(bookingId)
    .first<BookingRow>();
  if (!booking) return errorResponse('booking not found', 404);

  if (booking.graph_event_id) {
    await deleteCalendarEvent(env, booking.graph_event_id);
  }
  await env.DB.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).bind(bookingId).run();

  return json({ cancelled: true, booking_id: bookingId });
}

// Read-only inspection of Kim's real calendar — subjects + attendee data, so we can see what's
// actually recoverable before deciding whether/how to act on any of it.
export async function handleAdminListEvents(env: Env, url: URL): Promise<Response> {
  const setupKey = (url.searchParams.get('setup_key') ?? '').trim();
  const expectedKey = (env.SETUP_KEY ?? '').trim();
  if (!expectedKey || setupKey !== expectedKey) return errorResponse('forbidden', 403);

  const days = Number(url.searchParams.get('days') ?? '60');
  const start = new Date();
  start.setDate(start.getDate() - 1);
  const end = new Date();
  end.setDate(end.getDate() + days); // look forward — upcoming appointments already on the calendar

  const iso = (d: Date) => d.toISOString().slice(0, 19);
  const events = await listEvents(env, iso(start), iso(end));
  return json({ count: events.length, events });
}

interface ReflexRow {
  date: string;
  client: string;
  hasEmail: boolean;
}

const REFLEX_ROWS: ReflexRow[] = [
  { date: 'Thu 3 Sep, 10:30am', client: 'Peter Davis (Follow-up Consultation — booked via the website)', hasEmail: true },
  { date: 'Wed 26 Aug, 9:05am', client: 'Emily', hasEmail: false },
  { date: 'Mon 7 Sep, 2:00pm', client: 'Helen', hasEmail: false },
  { date: 'Wed 9 Sep, 9:00am', client: 'Suz', hasEmail: false },
  { date: 'Thu 24 Sep, 12:55pm', client: 'Sue Eldridge', hasEmail: false },
  { date: 'Thu 24 Sep, 2:00pm', client: 'Barbara', hasEmail: false },
  { date: 'Wed 7 Oct, 9:00am', client: 'Suz', hasEmail: false },
];

function buildTableHtml(): string {
  const rows = REFLEX_ROWS.map(
    (r) => `
      <tr>
        <td style="padding:8px 14px; border-bottom:1px solid #e3e6ef; font-family:Arial, Helvetica, sans-serif; font-size:14px; color:#232A3D;">${r.date}</td>
        <td style="padding:8px 14px; border-bottom:1px solid #e3e6ef; font-family:Arial, Helvetica, sans-serif; font-size:14px; color:#232A3D;">${r.client}</td>
        <td style="padding:8px 14px; border-bottom:1px solid #e3e6ef; font-family:Arial, Helvetica, sans-serif; font-size:14px;">${
          r.hasEmail
            ? '<span style="color:#3B6B22; font-weight:700;">Yes</span>'
            : '<span style="color:#B23B3B; font-weight:700;">No</span>'
        }</td>
      </tr>`
  ).join('');

  return `<!DOCTYPE html>
<html><body style="margin:0; padding:0; background:#F5F7FC; font-family:Arial, Helvetica, sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7FC;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px; width:100%; background:#FFFFFF; border:1px solid rgba(107,114,144,0.22); border-radius:14px; padding:28px 32px;">
<tr><td>
<div style="font-family: Georgia, 'Times New Roman', serif; font-size:19px; font-weight:700; color:#1B3A56; margin-bottom:6px;">Reflexology bookings already on your calendar</div>
<div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:1.6; color:#232A3D; margin-bottom:18px;">
I looked through the next 60 days of your Outlook calendar for reflexology appointments, to see which ones the new booking system could send an automatic confirmation email for. Here's what I found:
</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; margin-bottom:20px;">
<tr>
<td style="padding:8px 14px; border-bottom:2px solid #2E7FB8; font-family:'Courier New', Courier, monospace; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#2E7FB8;">Date</td>
<td style="padding:8px 14px; border-bottom:2px solid #2E7FB8; font-family:'Courier New', Courier, monospace; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#2E7FB8;">Client</td>
<td style="padding:8px 14px; border-bottom:2px solid #2E7FB8; font-family:'Courier New', Courier, monospace; font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:#2E7FB8;">Email on file?</td>
</tr>
${rows}
</table>
<div style="background:#F5F7FC; border-radius:10px; padding:16px 18px; font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:1.6; color:#232A3D;">
<strong>Why most of these don't have an email:</strong> when an appointment is booked through the website, the client's email is captured automatically and a confirmation goes out straight away — that's the one row above marked "Yes". The other six were typed directly into your calendar (name and time only, no one added as an attendee), so there's simply no email address stored anywhere for the system to send to. I won't guess at one.
</div>
<div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; line-height:1.6; color:#232A3D; margin-top:16px;">
If you'd like confirmations sent for any of the six, the easiest fix going forward is adding the client as an attendee (with their email) when you create the calendar entry — or just let me know their email addresses directly and I can send those confirmations manually.
</div>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export async function handleAdminSendCalendarSummary(env: Env, url: URL): Promise<Response> {
  const setupKey = (url.searchParams.get('setup_key') ?? '').trim();
  const expectedKey = (env.SETUP_KEY ?? '').trim();
  if (!expectedKey || setupKey !== expectedKey) return errorResponse('forbidden', 403);
  if (!env.KIM_EMAIL) return errorResponse('KIM_EMAIL is not configured', 500);

  const result = await sendEmail(env, {
    to: env.KIM_EMAIL,
    subject: 'Reflexology bookings on your calendar — client emails needed',
    html: buildTableHtml(),
  });
  return json({ sent: result });
}

// Read-only diagnostic: asks Stripe (with the Worker's own key) what actually happened to every
// unconfirmed booking's checkout session, which account the key belongs to, and the state of the
// registered webhook endpoints / recent completed-session events. Never writes anything to Stripe.
export async function handleAdminStripeCheck(env: Env, url: URL): Promise<Response> {
  const setupKey = (url.searchParams.get('setup_key') ?? '').trim();
  const expectedKey = (env.SETUP_KEY ?? '').trim();
  if (!expectedKey || setupKey !== expectedKey) return errorResponse('forbidden', 403);
  if (!env.STRIPE_SECRET_KEY) return errorResponse('STRIPE_SECRET_KEY not configured', 500);

  const stripeGet = async (path: string) => {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };

  const rows = await env.DB.prepare(
    `SELECT id, name, email, service, date, time, status, price_pence, stripe_session_id, created_at
     FROM bookings WHERE stripe_session_id IS NOT NULL AND status != 'confirmed' ORDER BY created_at DESC LIMIT 25`
  ).all<any>();

  const sessions = [];
  for (const r of rows.results ?? []) {
    const s = await stripeGet(`checkout/sessions/${r.stripe_session_id}`);
    sessions.push({
      booking: { id: r.id, name: r.name, email: r.email, service: r.service, date: r.date, time: r.time, db_status: r.status, created_at: r.created_at },
      stripe_http: s.status,
      stripe_status: s.body?.status,
      payment_status: s.body?.payment_status,
      amount_total: s.body?.amount_total,
      payment_intent: s.body?.payment_intent,
      error: s.body?.error?.message,
    });
  }

  const account = await stripeGet('account');
  const endpoints = await stripeGet('webhook_endpoints?limit=20');
  const events = await stripeGet('events?type=checkout.session.completed&limit=20');

  return json({
    key_account: { http: account.status, id: account.body?.id, name: account.body?.business_profile?.name ?? account.body?.settings?.dashboard?.display_name, error: account.body?.error?.message },
    webhook_endpoints: { http: endpoints.status, error: endpoints.body?.error?.message, list: (endpoints.body?.data ?? []).map((e: any) => ({ id: e.id, url: e.url, status: e.status, events: e.enabled_events })) },
    completed_events: { http: events.status, error: events.body?.error?.message, list: (events.body?.data ?? []).map((e: any) => ({ id: e.id, created: new Date(e.created * 1000).toISOString(), pending_webhooks: e.pending_webhooks, session: e.data?.object?.id, kind: e.data?.object?.metadata?.kind, booking_id: e.data?.object?.metadata?.booking_id, email: e.data?.object?.customer_details?.email })) },
    sessions,
  });
}

// Recovery for a booking whose payment succeeded but whose webhook never confirmed it. Refuses to
// act unless Stripe itself reports the checkout session as paid, so it can never confirm an unpaid one.
export async function handleAdminRecoverBooking(env: Env, url: URL): Promise<Response> {
  const setupKey = (url.searchParams.get('setup_key') ?? '').trim();
  const expectedKey = (env.SETUP_KEY ?? '').trim();
  if (!expectedKey || setupKey !== expectedKey) return errorResponse('forbidden', 403);
  const bookingId = url.searchParams.get('booking_id');
  if (!bookingId) return errorResponse('booking_id query param is required');
  const sendEmails = url.searchParams.get('send_email') !== '0';

  const row = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first<FullBookingRow & { stripe_session_id: string | null }>();
  if (!row) return errorResponse('booking not found', 404);
  if (row.status === 'confirmed') return json({ already_confirmed: true });
  if (!row.stripe_session_id) return errorResponse('booking has no stripe session', 409);

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions/' + row.stripe_session_id, {
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY },
  });
  const session = (await res.json().catch(() => null)) as { payment_status?: string } | null;
  if (session?.payment_status !== 'paid') return errorResponse('Stripe does not show this session as paid — not confirming', 409);

  await confirmBooking(env, row, { sendEmails, skipConflictNote: true });
  return json({ recovered: true, booking_id: bookingId, emails_sent: sendEmails });
}

// Runs the payment reconciler on demand. dry_run=1 only reports what it would do — no calendar
// events, no emails, no database writes. include_past=1 also considers appointments already gone by.
export async function handleAdminReconcile(env: Env, url: URL): Promise<Response> {
  const setupKey = (url.searchParams.get('setup_key') ?? '').trim();
  const expectedKey = (env.SETUP_KEY ?? '').trim();
  if (!expectedKey || setupKey !== expectedKey) return errorResponse('forbidden', 403);
  const report = await reconcilePayments(env, {
    dryRun: url.searchParams.get('dry_run') === '1',
    includePast: url.searchParams.get('include_past') === '1',
    sinceDays: Number(url.searchParams.get('since_days') ?? '7'),
  });
  return json(report);
}

// Webhook endpoint management for the live Stripe account. action=create registers a fresh
// endpoint for the production URL and returns its one-time signing secret (the caller pipes it
// straight into `wrangler secret put` without ever displaying it); action=delete removes one
// endpoint by id. Nothing else in the Stripe account is touched.
export async function handleAdminStripeWebhook(request: Request, env: Env, url: URL): Promise<Response> {
  const setupKey = (url.searchParams.get('setup_key') ?? '').trim();
  const expectedKey = (env.SETUP_KEY ?? '').trim();
  if (!expectedKey || setupKey !== expectedKey) return errorResponse('forbidden', 403);
  if (!env.STRIPE_SECRET_KEY) return errorResponse('STRIPE_SECRET_KEY not configured', 500);
  const auth = { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY };
  const action = url.searchParams.get('action');

  if (action === 'create') {
    const body = new URLSearchParams({
      url: env.SITE_ORIGIN + '/api/stripe/webhook',
      'enabled_events[0]': 'checkout.session.completed',
      description: 'Vale Reflexology bookings and packs',
    });
    const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok) return errorResponse('Stripe: ' + (data?.error?.message ?? res.status), 502);
    return json({ id: data.id, url: data.url, status: data.status, secret: data.secret });
  }

  if (action === 'delete') {
    const id = url.searchParams.get('id') ?? '';
    if (!/^we_[A-Za-z0-9]+$/.test(id)) return errorResponse('valid endpoint id required');
    const res = await fetch('https://api.stripe.com/v1/webhook_endpoints/' + id, { method: 'DELETE', headers: auth });
    const data = (await res.json().catch(() => null)) as any;
    if (!res.ok) return errorResponse('Stripe: ' + (data?.error?.message ?? res.status), 502);
    return json({ deleted: data.deleted === true, id });
  }

  return errorResponse('action must be create or delete');
}
