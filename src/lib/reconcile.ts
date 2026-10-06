import type { Env } from '../env';
import { confirmBooking, recordPackagePurchase, type BookingRow } from '../routes/stripeWebhook';
import { sendEmail } from './email';

// Safety net that does NOT depend on Stripe's webhook delivery. Asks Stripe directly which checkout
// sessions are actually paid and completes anything our database never heard about — a paid booking
// stuck pending/expired (calendar event + both emails), or a paid session pack with no credit row.
// Runs every 5 minutes from the cron trigger. Safe to run repeatedly: confirmBooking claims the row
// atomically and recordPackagePurchase is idempotent, so it can race the webhook without doubling up.

interface StripeSession {
  id: string;
  payment_status: string;
  client_reference_id?: string | null;
  customer_details?: { email?: string };
  metadata?: Record<string, string>;
}

export interface ReconcileReport {
  dry_run: boolean;
  sessions_checked: number;
  bookings: { id: string; name: string; date: string; time: string; action: string }[];
  packs: { session: string; email: string; action: string }[];
  skipped_past: { id: string; name: string; date: string; time: string }[];
  errors: string[];
}

function londonToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
}

async function listRecentSessions(env: Env, sinceDays: number): Promise<StripeSession[]> {
  const since = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  const out: StripeSession[] = [];
  let startingAfter = '';
  for (let page = 0; page < 5; page++) {
    const qs = `limit=100&created%5Bgte%5D=${since}${startingAfter ? `&starting_after=${startingAfter}` : ''}`;
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions?${qs}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    });
    if (!res.ok) throw new Error(`Stripe list sessions ${res.status}: ${await res.text().catch(() => '')}`);
    const body = (await res.json()) as { data: StripeSession[]; has_more: boolean };
    out.push(...body.data);
    if (!body.has_more || !body.data.length) break;
    startingAfter = body.data[body.data.length - 1].id;
  }
  return out;
}

export async function reconcilePayments(
  env: Env,
  opts: { dryRun?: boolean; includePast?: boolean; sinceDays?: number } = {}
): Promise<ReconcileReport> {
  const dryRun = !!opts.dryRun;
  const report: ReconcileReport = { dry_run: dryRun, sessions_checked: 0, bookings: [], packs: [], skipped_past: [], errors: [] };
  if (!env.STRIPE_SECRET_KEY) {
    report.errors.push('STRIPE_SECRET_KEY not configured');
    return report;
  }

  const sessions = await listRecentSessions(env, opts.sinceDays ?? 7);
  report.sessions_checked = sessions.length;
  const today = londonToday();

  for (const s of sessions) {
    if (s.payment_status !== 'paid') continue;
    const kind = s.metadata?.kind;

    if (kind === 'booking') {
      const bookingId = s.metadata?.booking_id ?? s.client_reference_id;
      if (!bookingId) continue;
      const row = await env.DB.prepare('SELECT * FROM bookings WHERE id = ?').bind(bookingId).first<BookingRow>();
      if (!row || row.status === 'confirmed' || row.status === 'cancelled') continue;

      // Never auto-email someone about an appointment that has already gone by — flag it for a human.
      if (row.date < today && !opts.includePast) {
        report.skipped_past.push({ id: row.id, name: row.name, date: row.date, time: row.time });
        continue;
      }
      const entry = { id: row.id, name: row.name, date: row.date, time: row.time, action: dryRun ? 'would confirm' : 'confirmed' };
      if (!dryRun) {
        try {
          await confirmBooking(env, row);
        } catch (err) {
          report.errors.push(`booking ${row.id} (${row.name}): ${(err as Error).message}`);
          continue;
        }
      }
      report.bookings.push(entry);
    }

    if (kind === 'package') {
      const exists = await env.DB.prepare('SELECT id FROM packages WHERE stripe_session_id = ?').bind(s.id).first();
      if (exists) continue;
      const email = (s.metadata?.email ?? s.customer_details?.email ?? '').toLowerCase();
      if (!dryRun) {
        try {
          await recordPackagePurchase(env, s);
        } catch (err) {
          report.errors.push(`pack ${s.id}: ${(err as Error).message}`);
          continue;
        }
      }
      report.packs.push({ session: s.id, email, action: dryRun ? 'would record' : 'recorded' });
    }
  }

  if (!dryRun) await alertKim(env, report);
  return report;
}

async function alertKim(env: Env, report: ReconcileReport): Promise<void> {
  if (!env.KIM_EMAIL) return;

  if (report.bookings.length || report.packs.length) {
    const lines = [
      ...report.bookings.map((b) => `<li>Booking: <strong>${b.name}</strong> — ${b.date} at ${b.time} (now confirmed, calendar event + emails sent)</li>`),
      ...report.packs.map((p) => `<li>Session pack bought by <strong>${p.email}</strong> — credit now recorded</li>`),
    ].join('');
    await sendEmail(env, {
      to: env.KIM_EMAIL,
      subject: 'Heads up — a payment was recovered automatically',
      html: `<p>Stripe took payment for the following, but the website was not told at the time. The safety net found them and finished the job:</p><ul>${lines}</ul><p>No action needed — this is just so you know.</p>`,
    }).catch(() => undefined);
  }

  // Calendar/Stripe trouble would otherwise repeat silently every 5 minutes — warn once per 6 hours.
  if (report.errors.length) {
    const key = 'reconcile:error_alert';
    if (!(await env.MS_TOKENS.get(key))) {
      await env.MS_TOKENS.put(key, '1', { expirationTtl: 6 * 3600 });
      await sendEmail(env, {
        to: env.KIM_EMAIL,
        subject: 'Action needed — a paid booking could not be completed',
        html: `<p>A client has paid but the website could not finish their booking:</p><ul>${report.errors.map((e) => `<li>${e}</li>`).join('')}</ul><p>It will keep retrying every 5 minutes. If this persists, the calendar connection may need re-authorising.</p>`,
      }).catch(() => undefined);
    }
  }
}
