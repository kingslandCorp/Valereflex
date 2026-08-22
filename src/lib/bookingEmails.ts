import type { Env } from '../env';
import { sendEmail } from './email';
import { CLIENT_BOOKING_CONFIRMATION_TEMPLATE, KIM_NEW_BOOKING_TEMPLATE, renderTemplate } from './emailTemplates';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTime(timeLabel: string): string {
  const [h, m] = timeLabel.split(':').map(Number);
  const period = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`;
}

function priceLine(pricePence: number, paymentMethod: string): string {
  if (paymentMethod === 'free') return 'Free';
  if (paymentMethod === 'package_credit') return 'Covered by your session pack — no payment needed';
  return `£${(pricePence / 100).toFixed(2)} paid`;
}

// Service keys carry duration/price in parens for the booking <select> — strip that for a clean display name.
function cleanServiceName(service: string): string {
  return service.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export interface BookingEmailInput {
  service: string;
  date: string;
  time: string;
  duration_minutes: number;
  name: string;
  email: string;
  phone: string;
  notes: string;
  price_pence: number;
  payment_method: string;
  booking_id: string;
}

// Fires both booking emails (client confirmation + Kim's notification). Never throws — a booking
// that's already confirmed in D1 and on the calendar should not fail the request just because an
// email provider hiccuped.
export async function sendBookingConfirmationEmails(env: Env, b: BookingEmailInput): Promise<void> {
  if (!env.RESEND_API_KEY || !env.KIM_EMAIL) return;

  const data = {
    client_name: b.name,
    client_email: b.email,
    client_phone: b.phone || '—',
    client_notes: b.notes || '—',
    service_name: cleanServiceName(b.service),
    formatted_date: formatDate(b.date),
    formatted_time: formatTime(b.time),
    duration_minutes: String(b.duration_minutes),
    price_line: priceLine(b.price_pence, b.payment_method),
    booking_id: b.booking_id,
  };

  const clientHtml = renderTemplate(CLIENT_BOOKING_CONFIRMATION_TEMPLATE, data);
  const kimHtml = renderTemplate(KIM_NEW_BOOKING_TEMPLATE, data);

  try {
    await Promise.all([
      sendEmail(env, { to: b.email, subject: 'Your Vale Reflexology booking is confirmed', html: clientHtml }),
      sendEmail(env, { to: env.KIM_EMAIL, subject: `New booking — ${b.name}`, html: kimHtml }),
    ]);
  } catch {
    // Swallow — booking success does not depend on email delivery.
  }
}
