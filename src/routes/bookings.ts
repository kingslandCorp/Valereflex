import type { Env } from '../env';
import { SERVICE_DEFS, computeFreeSlots } from '../lib/availability';
import { findAvailablePackage, redeemPackageCredit } from '../lib/packages';
import { createCalendarEvent } from '../lib/graph';
import { createCheckoutSession } from '../lib/stripe';
import { json, errorResponse } from '../lib/http';

interface BookingBody {
  service?: string;
  date?: string;
  time?: string;
  name?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

function addMinutes(dateStr: string, timeLabel: string, minutes: number): string {
  const start = new Date(`${dateStr}T${timeLabel}:00`);
  const end = new Date(start.getTime() + minutes * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}T${pad(
    end.getUTCHours()
  )}:${pad(end.getUTCMinutes())}:00`;
}

async function createEventForBooking(
  env: Env,
  opts: { service: string; date: string; time: string; duration: number; name: string; email: string; notes: string }
): Promise<string> {
  const startLocal = `${opts.date}T${opts.time}:00`;
  const endLocal = addMinutes(opts.date, opts.time, opts.duration);
  return createCalendarEvent(env, {
    subject: `${opts.service} — ${opts.name}`,
    bodyText: `Booked via valereflexology.co.uk\n\nClient: ${opts.name} (${opts.email})\nNotes: ${opts.notes || '—'}`,
    startLocal,
    endLocal,
    attendeeEmail: opts.email,
    attendeeName: opts.name,
  });
}

export async function handleCreateBooking(request: Request, env: Env): Promise<Response> {
  const body = await request.json<BookingBody>().catch(() => null);
  const service = body?.service ?? '';
  const date = body?.date ?? '';
  const time = body?.time ?? '';
  const name = (body?.name ?? '').trim();
  const email = (body?.email ?? '').trim().toLowerCase();
  const phone = (body?.phone ?? '').trim();
  const notes = (body?.notes ?? '').trim();

  const def = SERVICE_DEFS[service];
  if (!def) return errorResponse('unknown service');
  if (!date || !time) return errorResponse('date and time are required');
  if (!name || !email) return errorResponse('name and email are required');

  // Re-validate against the real calendar + D1 holds — never trust the client's idea of what's free.
  const freeResult = await computeFreeSlots(env, service, date);
  if ('error' in freeResult) return errorResponse(freeResult.error, 502);
  if (!freeResult.slots.includes(time)) {
    return errorResponse('that slot is no longer available — please choose another', 409);
  }

  const id = crypto.randomUUID();

  // Free Discovery Call — confirm directly, no payment.
  if (def.pricePence === 0) {
    const eventId = await createEventForBooking(env, { service, date, time, duration: def.duration, name, email, notes });
    await env.DB.prepare(
      `INSERT INTO bookings (id, service, duration_minutes, date, time, name, email, phone, notes, status, price_pence, payment_method, graph_event_id, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 0, 'free', ?, datetime('now'))`
    )
      .bind(id, service, def.duration, date, time, name, email, phone, notes, eventId)
      .run();
    return json({ status: 'confirmed', booking_id: id });
  }

  // Package credit — confirm directly, no Stripe charge.
  if (def.creditType) {
    const pkg = await findAvailablePackage(env, email, def.creditType);
    if (pkg) {
      const eventId = await createEventForBooking(env, { service, date, time, duration: def.duration, name, email, notes });
      await env.DB.prepare(
        `INSERT INTO bookings (id, service, duration_minutes, date, time, name, email, phone, notes, status, price_pence, payment_method, package_id, graph_event_id, confirmed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, 'package_credit', ?, ?, datetime('now'))`
      )
        .bind(id, service, def.duration, date, time, name, email, phone, notes, def.pricePence, pkg.id, eventId)
        .run();
      await redeemPackageCredit(env, pkg, def.creditType);
      return json({ status: 'confirmed', booking_id: id });
    }
  }

  // Otherwise — pay to confirm. This row IS the hold; computeFreeSlots checks pending_payment rows.
  if (!env.STRIPE_SECRET_KEY) return errorResponse('payments are not configured yet', 500);

  await env.DB.prepare(
    `INSERT INTO bookings (id, service, duration_minutes, date, time, name, email, phone, notes, status, price_pence, payment_method, hold_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, 'stripe', datetime('now', '+30 minutes'))`
  )
    .bind(id, service, def.duration, date, time, name, email, phone, notes, def.pricePence)
    .run();

  const result = await createCheckoutSession(env.STRIPE_SECRET_KEY, {
    item: { name: service, amountPence: def.pricePence },
    successUrl: `${env.SITE_ORIGIN}/booking.html?paid=1&booking_id=${id}`,
    cancelUrl: `${env.SITE_ORIGIN}/booking.html?cancelled=1&booking_id=${id}`,
    clientReferenceId: id,
    customerEmail: email,
    metadata: { kind: 'booking', booking_id: id },
  });
  if ('error' in result) return errorResponse(result.error, 502);

  await env.DB.prepare(`UPDATE bookings SET stripe_session_id = ? WHERE id = ?`).bind(result.id, id).run();

  return json({ status: 'pending_payment', checkout_url: result.url });
}

export async function sweepExpiredHolds(env: Env): Promise<void> {
  await env.DB.prepare(
    `UPDATE bookings SET status = 'expired' WHERE status = 'pending_payment' AND hold_expires_at < datetime('now')`
  ).run();
}
