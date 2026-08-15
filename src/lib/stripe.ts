import type { Env } from '../env';

function formEncode(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export interface CheckoutLineItem {
  name: string;
  amountPence: number;
}

export interface CreateCheckoutOpts {
  item: CheckoutLineItem;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
  customerEmail?: string;
}

export async function createCheckoutSession(
  secretKey: string,
  opts: CreateCheckoutOpts
): Promise<{ url: string; id: string } | { error: string }> {
  const fields: Record<string, string> = {
    mode: 'payment',
    'line_items[0][price_data][currency]': 'gbp',
    'line_items[0][price_data][unit_amount]': String(opts.item.amountPence),
    'line_items[0][price_data][product_data][name]': opts.item.name,
    'line_items[0][quantity]': '1',
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    client_reference_id: opts.clientReferenceId,
    expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
  };
  for (const [k, v] of Object.entries(opts.metadata)) {
    fields[`metadata[${k}]`] = v;
  }
  if (opts.customerEmail) fields.customer_email = opts.customerEmail;

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(fields),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    return { error: `Stripe ${res.status}: ${errBody}` };
  }
  const session = (await res.json()) as { url: string; id: string };
  return { url: session.url, id: session.id };
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string
): Promise<boolean> {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.split('=') as [string, string])
  );
  const timestamp = parts.t;
  const v1 = parts.v1;
  if (!timestamp || !v1) return false;
  const expected = await hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`);
  return timingSafeEqual(expected, v1);
}

export async function stripeFetch(
  env: Env,
  path: string,
  fields: Record<string, string>
): Promise<Response> {
  return fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(fields),
  });
}
