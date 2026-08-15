import type { Env } from '../env';
import { SERVICE_DEFS } from '../lib/availability';
import { PACK_DEFS, findAvailablePackage } from '../lib/packages';
import { createCheckoutSession } from '../lib/stripe';
import { json, errorResponse } from '../lib/http';

export async function handlePackageCredit(env: Env, url: URL): Promise<Response> {
  const email = (url.searchParams.get('email') ?? '').trim().toLowerCase();
  const service = url.searchParams.get('service') ?? '';
  if (!email || !service) return errorResponse('email and service are required');

  const def = SERVICE_DEFS[service];
  if (!def || !def.creditType) return json({ available: false });

  const pkg = await findAvailablePackage(env, email, def.creditType);
  if (!pkg) return json({ available: false });

  const remaining =
    def.creditType === 'initial' ? pkg.initial_total - pkg.initial_used : pkg.followup_total - pkg.followup_used;
  return json({ available: true, remaining });
}

interface PackageCheckoutBody {
  pack_type?: string;
  name?: string;
  email?: string;
  phone?: string;
}

export async function handlePackageCheckout(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) return errorResponse('payments are not configured yet', 500);

  const body = await request.json<PackageCheckoutBody>().catch(() => null);
  const packType = body?.pack_type as 'six_followup' | 'initial_plus_five' | undefined;
  const name = (body?.name ?? '').trim();
  const email = (body?.email ?? '').trim().toLowerCase();
  const phone = (body?.phone ?? '').trim();

  if (!packType || !PACK_DEFS[packType]) return errorResponse('pack_type must be a known pack');
  if (!name || !email) return errorResponse('name and email are required');

  const def = PACK_DEFS[packType];
  const pricePence = parseInt(env[def.pricePenceVar] ?? '0', 10);
  if (!pricePence) return errorResponse('this pack has no price configured yet', 500);

  const result = await createCheckoutSession(env.STRIPE_SECRET_KEY, {
    item: { name: def.label, amountPence: pricePence },
    successUrl: `${env.SITE_ORIGIN}/booking.html?pack_paid=1`,
    cancelUrl: `${env.SITE_ORIGIN}/booking.html?pack_cancelled=1`,
    clientReferenceId: `pack_${packType}_${email}`,
    customerEmail: email,
    metadata: { kind: 'package', pack_type: packType, name, email, phone },
  });
  if ('error' in result) return errorResponse(result.error, 502);
  return json({ checkout_url: result.url });
}
