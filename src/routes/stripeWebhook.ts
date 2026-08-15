import type { Env } from '../env';
import { verifyStripeSignature } from '../lib/stripe';
import { PACK_DEFS } from '../lib/packages';
import { createCalendarEvent } from '../lib/graph';
import { SERVICE_DEFS, computeFreeSlots } from '../lib/availability';
import { json, errorResponse } from '../lib/http';

interface StripeCheckoutSession {
  id: string;
  client_reference_id?: string;
  customer_details?: { email?: string };
  metadata?: Record<string, string>;
}

interface StripeEvent {
  type: string;
  data: { object: StripeCheckoutSession };
}

interface BookingRow {
  id: string;
  service: string;
  duration_minutes: number;
  date: string;
  time: string;
  name: string;
  email: string;
  notes: string | null;
  status: string;
}

async function confirmBooking(env: Env, booking: BookingRow): Promise<void> {
  const def = SERVICE_DEFS[booking.service];
  let notes = booking.notes ?? '';

  if (booking.status === 'expired') {
    const free = await computeFreeSlots(env, booking.service, booking.date);
    const stillFree = 'slots' in free && free.slots.includes(booking.time);
    if (!stillFree) {
      notes = `[SLOT CONFLICT — CALL CLIENT] ${notes}`.trim();
    }
  }

  const eventId = await createCalendarEvent(env, {
    subject: `${booking.service} — ${booking.name}`,
    bodyText: `Booked via valereflexology.co.uk\n\nClient: ${booking.name} (${booking.email})\nNotes: ${notes || '—'}`,
    startLocal: `${booking.date}T${booking.time}:00`,
    endLocal: addMinutes(booking.date, booking.time, def?.duration ?? booking.duration_minutes),
    attendeeEmail: booking.email,
    attendeeName: booking.name,
  });

  await env.DB.prepare(
    `UPDATE bookings SET status = 'confirmed', confirmed_at = datetime('now'), graph_event_id = ?, notes = ? WHERE id = ?`
  )
    .bind(eventId, notes, booking.id)
    .run();
}

function addMinutes(dateStr: string, timeLabel: string, minutes: number): string {
  const start = new Date(`${dateStr}T${timeLabel}:00`);
  const end = new Date(start.getTime() + minutes * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${end.getUTCFullYear()}-${pad(end.getUTCMonth() + 1)}-${pad(end.getUTCDate())}T${pad(
    end.getUTCHours()
  )}:${pad(end.getUTCMinutes())}:00`;
}

export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) return errorResponse('webhook not configured', 500);

  const rawBody = await request.text();
  const signature = request.headers.get('Stripe-Signature');
  const valid = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return errorResponse('invalid signature', 400);

  const event = JSON.parse(rawBody) as StripeEvent;
  if (event.type !== 'checkout.session.completed') return json({ received: true });

  const session = event.data.object;
  const metadata = session.metadata ?? {};

  if (metadata.kind === 'booking') {
    const bookingId = metadata.booking_id ?? session.client_reference_id;
    if (!bookingId) return json({ received: true });

    const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id = ?`).bind(bookingId).first<BookingRow>();
    if (!booking || booking.status === 'confirmed' || booking.status === 'cancelled') {
      return json({ received: true }); // idempotent — already handled or unknown
    }
    await confirmBooking(env, booking);
    return json({ received: true });
  }

  if (metadata.kind === 'package') {
    const packType = metadata.pack_type as 'six_followup' | 'initial_plus_five' | undefined;
    const def = packType ? PACK_DEFS[packType] : undefined;
    if (!def || !packType) return json({ received: true });

    const email = (metadata.email ?? session.customer_details?.email ?? '').trim().toLowerCase();
    if (!email) return json({ received: true });

    await env.DB.prepare(
      `INSERT INTO packages (id, email, name, pack_type, initial_total, followup_total, stripe_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), email, metadata.name ?? null, packType, def.initialTotal, def.followupTotal, session.id)
      .run();
    return json({ received: true });
  }

  return json({ received: true });
}
