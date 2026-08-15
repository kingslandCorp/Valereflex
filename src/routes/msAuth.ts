import type { Env } from '../env';
import { buildAuthorizeUrl, exchangeCodeForTokens } from '../lib/graph';
import { errorResponse } from '../lib/http';

function html(body: string): Response {
  return new Response(`<!doctype html><html><body style="font-family:sans-serif;padding:40px;">${body}</body></html>`, {
    headers: { 'Content-Type': 'text/html' },
  });
}

export async function handleMicrosoftAuthStart(env: Env, url: URL): Promise<Response> {
  const setupKey = url.searchParams.get('setup_key');
  if (!env.SETUP_KEY || setupKey !== env.SETUP_KEY) return errorResponse('forbidden', 403);
  if (!env.MS_CLIENT_ID) return errorResponse('Microsoft integration is not configured yet', 500);

  const redirectUri = `${env.SITE_ORIGIN}/api/auth/microsoft/callback`;
  const authorizeUrl = buildAuthorizeUrl(env, redirectUri, 'setup');
  return Response.redirect(authorizeUrl, 302);
}

export async function handleMicrosoftAuthCallback(env: Env, url: URL): Promise<Response> {
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error) return html(`<h1>Connection failed</h1><p>${error}</p>`);
  if (!code) return errorResponse('missing code');

  const redirectUri = `${env.SITE_ORIGIN}/api/auth/microsoft/callback`;
  try {
    await exchangeCodeForTokens(env, code, redirectUri);
  } catch (err) {
    return html(`<h1>Connection failed</h1><p>${(err as Error).message}</p>`);
  }
  return html('<h1>Connected</h1><p>Your Outlook calendar is now linked — you can close this tab.</p>');
}
