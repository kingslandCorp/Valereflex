import type { Env } from './env';
import { handleAvailability } from './routes/availability';
import { handleCreateBooking, sweepExpiredHolds } from './routes/bookings';
import { handlePackageCredit, handlePackageCheckout } from './routes/packages';
import { handleMicrosoftAuthStart, handleMicrosoftAuthCallback } from './routes/msAuth';
import { handleStripeWebhook } from './routes/stripeWebhook';
import { handleTestSendEmails } from './routes/testEmail';
import { handleAdminCancelBooking, handleAdminListEvents, handleAdminSendCalendarSummary } from './routes/admin';
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
  if (pathname === '/api/test-send-emails' && method === 'GET') return handleTestSendEmails(env, url);
  if (pathname === '/api/admin/cancel-booking' && method === 'GET') return handleAdminCancelBooking(env, url);
  if (pathname === '/api/admin/list-events' && method === 'GET') return handleAdminListEvents(env, url);
  if (pathname === '/api/admin/send-calendar-summary' && method === 'GET') return handleAdminSendCalendarSummary(env, url);

  return errorResponse('not found', 404);
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sweepExpiredHolds(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Canonical host is www.valereflexology.com — everything else we're bound to
    // (the bare .com apex, and the .co.uk domain once it's reachable at all) redirects there.
    const CANONICAL_HOST = 'www.valereflexology.com';
    const REDIRECT_HOSTS = new Set(['valereflexology.com', 'valereflexology.co.uk', 'www.valereflexology.co.uk']);
    if (REDIRECT_HOSTS.has(url.hostname)) {
      url.hostname = CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    // html_handling is "none" (see wrangler.jsonc) so every other page serves its exact .html file
    // with no redirect — but that also disables the implicit "/" -> "/index.html" mapping, so do it
    // explicitly here for the one directory-style path the site actually uses.
    if (url.pathname === '/') {
      return env.ASSETS.fetch(new Request(new URL('/index.html', url), request));
    }

    return env.ASSETS.fetch(request);
  },
};
