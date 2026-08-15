export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MS_TOKENS: KVNamespace;

  SITE_ORIGIN: string;
  SIX_FOLLOWUP_PACK_PENCE: string;
  INITIAL_PLUS_FIVE_PACK_PENCE: string;

  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string;
  SETUP_KEY?: string;
}
