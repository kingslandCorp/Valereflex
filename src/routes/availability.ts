import type { Env } from '../env';
import { computeFreeSlots } from '../lib/availability';
import { json, errorResponse } from '../lib/http';

export async function handleAvailability(env: Env, url: URL): Promise<Response> {
  const service = url.searchParams.get('service') ?? '';
  const date = url.searchParams.get('date') ?? '';
  if (!service || !date) return errorResponse('service and date are required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return errorResponse('date must be YYYY-MM-DD');

  const result = await computeFreeSlots(env, service, date);
  if ('error' in result) return errorResponse(result.error, 502);
  return json({ slots: result.slots });
}
