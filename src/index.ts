import type { Env } from './env';
import { handleAvailability } from './routes/availability';
import { handleCreateBooking, sweepExpiredHolds } from './routes/bookings';
import { handlePackageCredit, handlePackageCheckout } from './routes/packages';
import { handleMicrosoftAuthStart, handleMicrosoftAuthCallback } from './routes/msAuth';
import { handleStripeWebhook } from './routes/stripeWebhook';
import { errorResponse } from './lib/http';

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/availability' && method === 'GET') return handleAvailability(env, url);
  if (pathname === '/api/bookings' && method === 'POST') return handleCreateBooking(request, env);
  if (pathname === '/api/packages/credit' && method === 'GET') return handlePackageCredit(env, url);
  if (pathname === '/api/packages/checkout' && method === 'POST') return handlePackageCheckout(request, env);
  if (pathname === '/api/auth/microsoft/start' && method === 'GET') return handleMicrosoftAuthStart(env, url);
  if (pathname === '/api/auth/microsoft/callback' && method === 'GET') return handleMicrosoftAuthCallback(env, url);
  if (pathname === '/api/stripe/webhook' && method === 'POST') return handleStripeWebhook(request, env);

  return errorResponse('not found', 404);
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sweepExpiredHolds(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === 'valereflexology.co.uk') {
      url.hostname = 'www.valereflexology.co.uk';
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },
};
