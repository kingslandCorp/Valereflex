import type { Env } from '../env';

export interface SendEmailOpts {
  to: string;
  subject: string;
  html: string;
}

const FROM_ADDRESS = 'Vale Reflexology <kim@valereflexology.co.uk>';

export async function sendEmail(env: Env, opts: SendEmailOpts): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY not configured' };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return { ok: false, error: `Resend ${res.status}: ${errText}` };
  }
  return { ok: true };
}
