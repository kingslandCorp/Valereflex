import type { Env } from '../env';
import { sendEmail } from '../lib/email';
import { CLIENT_BOOKING_CONFIRMATION_TEMPLATE, KIM_NEW_BOOKING_TEMPLATE, renderTemplate } from '../lib/emailTemplates';
import { json, errorResponse } from '../lib/http';

const SAMPLE_DATA = {
  client_name: 'Sarah Bevan',
  client_email: 'sarah.bevan@example.com',
  client_phone: '07700 900123',
  client_notes: 'First visit — mentioned lower back pain, otherwise no health concerns.',
  service_name: 'Follow-up Consultation',
  formatted_date: 'Tuesday 15 September 2026',
  formatted_time: '10:30am',
  duration_minutes: '60',
  price_line: '£45.00 paid',
  booking_id: 'TEST-SEND',
};

// Gated by SETUP_KEY, same as the Microsoft consent route — this fires real emails via Resend,
// so it must not be triggerable by a stray visitor.
export async function handleTestSendEmails(env: Env, url: URL): Promise<Response> {
  const setupKey = (url.searchParams.get('setup_key') ?? '').trim();
  const expectedKey = (env.SETUP_KEY ?? '').trim();
  if (!expectedKey || setupKey !== expectedKey) return errorResponse('forbidden', 403);

  const patientEmail = url.searchParams.get('patient_email');
  const kimEmail = url.searchParams.get('kim_email') ?? env.KIM_EMAIL;
  if (!patientEmail) return errorResponse('patient_email query param is required');
  if (!kimEmail) return errorResponse('KIM_EMAIL is not configured', 500);

  const clientHtml = renderTemplate(CLIENT_BOOKING_CONFIRMATION_TEMPLATE, SAMPLE_DATA);
  const kimHtml = renderTemplate(KIM_NEW_BOOKING_TEMPLATE, SAMPLE_DATA);

  const [patientResult, kimResult] = await Promise.all([
    sendEmail(env, { to: patientEmail, subject: '[TEST] Your Vale Reflexology booking is confirmed', html: clientHtml }),
    sendEmail(env, { to: kimEmail, subject: '[TEST] New booking — Sarah Bevan', html: kimHtml }),
  ]);

  return json({ patient: patientResult, kim: kimResult });
}
