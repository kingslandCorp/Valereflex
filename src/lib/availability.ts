import type { Env } from '../env';
import { getBusyBlocks } from './graph';

export const CLINIC_START = 9.5; // 9:30am
export const CLINIC_END = 15; // 3:00pm

export interface ServiceDef {
  duration: number; // minutes
  pricePence: number;
  creditType: 'initial' | 'followup' | null;
}

// Authoritative service catalogue — server-side source of truth for duration/price/package-eligibility.
// The client-side SERVICE_DURATIONS map in site/script.js is label text only; never trust it for
// money or scheduling decisions. Home Visit is deliberately not package-eligible — the packs cover
// clinic Initial/Follow-up sessions only.
export const SERVICE_DEFS: Record<string, ServiceDef> = {
  'Free Discovery Call (15 min, free)': { duration: 15, pricePence: 0, creditType: null },
  'Initial Consultation (1hr 30, £65)': { duration: 90, pricePence: 6500, creditType: 'initial' },
  'Follow-up Consultation (1hr, £45)': { duration: 60, pricePence: 4500, creditType: 'followup' },
  'Home Visit — Foot Reflexology (1hr, £65)': { duration: 60, pricePence: 6500, creditType: null },
};

function isWeekday(dateStr: string): boolean {
  const day = new Date(`${dateStr}T00:00:00`).getDay();
  return day >= 1 && day <= 5;
}

function toTimeLabel(t: number): string {
  const hh = Math.floor(t);
  const mm = Math.round((t - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function candidateSlots(duration: number): string[] {
  const slots: string[] = [];
  let t = CLINIC_START;
  while (t + duration / 60 <= CLINIC_END + 0.001) {
    slots.push(toTimeLabel(t));
    t += duration / 60;
  }
  return slots;
}

// NOTE on timezones: everything here — candidate slot times, D1-stored booking times, and Graph
// calendarview results (fetched with `Prefer: outlook.timezone="GMT Standard Time"`) — is treated
// as a *naive* clinic-local wall-clock string (no UTC offset), and parsed with `new Date(...)`
// consistently on both sides of every comparison below. The Worker runtime's own "local time" is
// UTC, so these Date objects don't represent true UTC instants during BST — but since every value
// entering this file is naive-parsed the same way, relative overlap comparisons stay correct. Do
// NOT "fix" this by converting one side to a real UTC-aware Date without doing the same to the
// other, or overlap detection will silently break by an hour for roughly half the year.
function toWallClockDate(dateStr: string, timeLabelOrISO: string): Date {
  return new Date(timeLabelOrISO.includes('T') ? timeLabelOrISO : `${dateStr}T${timeLabelOrISO}:00`);
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

interface DbBookingRow {
  time: string;
  duration_minutes: number;
}

export async function computeFreeSlots(
  env: Env,
  service: string,
  dateStr: string
): Promise<{ slots: string[] } | { error: string }> {
  const def = SERVICE_DEFS[service];
  if (!def) return { error: 'unknown service' };
  if (!isWeekday(dateStr)) return { slots: [] };

  const candidates = candidateSlots(def.duration);
  if (!candidates.length) return { slots: [] };

  let busy: { start: string; end: string }[];
  try {
    busy = await getBusyBlocks(env, `${dateStr}T00:00:00`, `${dateStr}T23:59:59`);
  } catch (err) {
    // Fail closed: if the calendar can't be reached, offer no slots rather than risk double-booking.
    return { error: `calendar unavailable: ${(err as Error).message}` };
  }

  const heldRows = await env.DB.prepare(
    `SELECT time, duration_minutes FROM bookings
     WHERE date = ?
       AND (status = 'confirmed' OR (status = 'pending_payment' AND hold_expires_at > datetime('now')))`
  )
    .bind(dateStr)
    .all<DbBookingRow>();
  const held = heldRows.results ?? [];

  const free = candidates.filter((slotLabel) => {
    const slotStart = toWallClockDate(dateStr, slotLabel);
    const slotEnd = new Date(slotStart.getTime() + def.duration * 60000);

    const clashesGraph = busy.some((b) =>
      overlaps(slotStart, slotEnd, toWallClockDate(dateStr, b.start), toWallClockDate(dateStr, b.end))
    );
    if (clashesGraph) return false;

    const clashesHeld = held.some((row) => {
      const rowStart = toWallClockDate(dateStr, row.time);
      const rowEnd = new Date(rowStart.getTime() + row.duration_minutes * 60000);
      return overlaps(slotStart, slotEnd, rowStart, rowEnd);
    });
    return !clashesHeld;
  });

  return { slots: free };
}
