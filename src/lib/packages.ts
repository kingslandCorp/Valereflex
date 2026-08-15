import type { Env } from '../env';

export interface PackageRow {
  id: string;
  email: string;
  name: string | null;
  pack_type: 'six_followup' | 'initial_plus_five';
  initial_total: number;
  initial_used: number;
  followup_total: number;
  followup_used: number;
  status: string;
}

export const PACK_DEFS: Record<
  'six_followup' | 'initial_plus_five',
  { label: string; pricePenceVar: 'SIX_FOLLOWUP_PACK_PENCE' | 'INITIAL_PLUS_FIVE_PACK_PENCE'; initialTotal: number; followupTotal: number }
> = {
  six_followup: {
    label: 'Six Follow-up Session Pack',
    pricePenceVar: 'SIX_FOLLOWUP_PACK_PENCE',
    initialTotal: 0,
    followupTotal: 6,
  },
  initial_plus_five: {
    label: 'Initial Consult + 5 Follow-ups Pack',
    pricePenceVar: 'INITIAL_PLUS_FIVE_PACK_PENCE',
    initialTotal: 1,
    followupTotal: 5,
  },
};

// Finds the oldest active package for this email with at least one remaining credit of the given type.
// Used both to power the "you have credit" UI banner and — separately and authoritatively — inside
// the booking route itself before it decides whether to charge Stripe.
export async function findAvailablePackage(
  env: Env,
  email: string,
  creditType: 'initial' | 'followup'
): Promise<PackageRow | null> {
  const column = creditType === 'initial' ? 'initial' : 'followup';
  const row = await env.DB.prepare(
    `SELECT * FROM packages
     WHERE email = ? AND status = 'active' AND ${column}_total > ${column}_used
     ORDER BY purchased_at ASC LIMIT 1`
  )
    .bind(email)
    .first<PackageRow>();
  return row ?? null;
}

export async function redeemPackageCredit(
  env: Env,
  pkg: PackageRow,
  creditType: 'initial' | 'followup'
): Promise<void> {
  const usedCol = creditType === 'initial' ? 'initial_used' : 'followup_used';
  const newUsed = (creditType === 'initial' ? pkg.initial_used : pkg.followup_used) + 1;
  const initialTotal = pkg.initial_total;
  const followupTotal = pkg.followup_total;
  const initialUsed = creditType === 'initial' ? newUsed : pkg.initial_used;
  const followupUsed = creditType === 'followup' ? newUsed : pkg.followup_used;
  const exhausted = initialUsed >= initialTotal && followupUsed >= followupTotal;

  await env.DB.prepare(
    `UPDATE packages SET ${usedCol} = ?, status = ? WHERE id = ?`
  )
    .bind(newUsed, exhausted ? 'exhausted' : 'active', pkg.id)
    .run();
}
