import type { Env } from '../env';

const TOKEN_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const AUTHORIZE_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const GRAPH_SCOPES = 'offline_access Calendars.ReadWrite';
const TIMEZONE = 'GMT Standard Time';

const KV_REFRESH_TOKEN = 'ms:refresh_token';
const KV_ACCESS_TOKEN = 'ms:access_token';

export function buildAuthorizeUrl(env: Env, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID ?? '',
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: GRAPH_SCOPES,
    state,
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function requestToken(env: Env, body: Record<string, string>): Promise<TokenResponse> {
  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID ?? '',
    client_secret: env.MS_CLIENT_SECRET ?? '',
    ...body,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Microsoft token endpoint ${res.status}: ${errText}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function exchangeCodeForTokens(
  env: Env,
  code: string,
  redirectUri: string
): Promise<void> {
  const tokens = await requestToken(env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  await persistTokens(env, tokens);
}

async function persistTokens(env: Env, tokens: TokenResponse): Promise<void> {
  if (tokens.refresh_token) {
    await env.MS_TOKENS.put(KV_REFRESH_TOKEN, tokens.refresh_token);
  }
  await env.MS_TOKENS.put(KV_ACCESS_TOKEN, tokens.access_token, {
    expirationTtl: Math.max(60, tokens.expires_in - 60),
  });
}

export async function getAccessToken(env: Env): Promise<string> {
  const cached = await env.MS_TOKENS.get(KV_ACCESS_TOKEN);
  if (cached) return cached;

  const refreshToken = await env.MS_TOKENS.get(KV_REFRESH_TOKEN);
  if (!refreshToken) {
    throw new Error(
      'No Microsoft refresh token on file — the one-time calendar consent has not been completed yet.'
    );
  }
  const tokens = await requestToken(env, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  await persistTokens(env, tokens);
  return tokens.access_token;
}

async function graphFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const accessToken = await getAccessToken(env);
  return fetch(`https://graph.microsoft.com/v1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: `outlook.timezone="${TIMEZONE}"`,
      ...(init.headers ?? {}),
    },
  });
}

export interface BusyBlock {
  start: string; // ISO, clinic-local (Europe/London wall-clock, no offset)
  end: string;
}

export async function getBusyBlocks(
  env: Env,
  dayStartLocal: string,
  dayEndLocal: string
): Promise<BusyBlock[]> {
  const params = new URLSearchParams({
    startDateTime: dayStartLocal,
    endDateTime: dayEndLocal,
    $select: 'start,end,subject',
    $top: '50',
  });
  const res = await graphFetch(env, `/me/calendarview?${params.toString()}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Graph calendarview ${res.status}: ${errText}`);
  }
  const data = (await res.json()) as { value: Array<{ start: { dateTime: string }; end: { dateTime: string } }> };
  return data.value.map((ev) => ({ start: ev.start.dateTime, end: ev.end.dateTime }));
}

export interface CreateEventOpts {
  subject: string;
  bodyText: string;
  startLocal: string; // "YYYY-MM-DDTHH:MM:SS"
  endLocal: string;
  attendeeEmail: string;
  attendeeName: string;
}

export async function createCalendarEvent(env: Env, opts: CreateEventOpts): Promise<string> {
  const res = await graphFetch(env, '/me/events', {
    method: 'POST',
    body: JSON.stringify({
      subject: opts.subject,
      body: { contentType: 'Text', content: opts.bodyText },
      start: { dateTime: opts.startLocal, timeZone: TIMEZONE },
      end: { dateTime: opts.endLocal, timeZone: TIMEZONE },
      attendees: [
        {
          emailAddress: { address: opts.attendeeEmail, name: opts.attendeeName },
          type: 'required',
        },
      ],
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Graph create event ${res.status}: ${errText}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}
