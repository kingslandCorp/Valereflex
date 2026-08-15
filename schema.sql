-- Vale Reflexology — D1 schema
-- Apply: wrangler d1 execute valereflex-db --file=./schema.sql [--remote]

CREATE TABLE IF NOT EXISTS bookings (
  id                 TEXT PRIMARY KEY,
  service            TEXT NOT NULL,
  duration_minutes   INTEGER NOT NULL,
  date               TEXT NOT NULL,        -- YYYY-MM-DD, clinic-local
  time               TEXT NOT NULL,        -- HH:MM, clinic-local
  name               TEXT NOT NULL,
  email              TEXT NOT NULL,
  phone              TEXT,
  notes              TEXT,
  status             TEXT NOT NULL DEFAULT 'pending_payment'
                       CHECK (status IN ('pending_payment','confirmed','expired','cancelled')),
  price_pence        INTEGER NOT NULL DEFAULT 0,
  payment_method     TEXT NOT NULL DEFAULT 'stripe'
                       CHECK (payment_method IN ('stripe','package_credit','free')),
  package_id         TEXT REFERENCES packages(id),
  stripe_session_id  TEXT,
  graph_event_id     TEXT,
  hold_expires_at    TEXT,                 -- set only while status='pending_payment'
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at       TEXT
);

CREATE TABLE IF NOT EXISTS packages (
  id                 TEXT PRIMARY KEY,
  email              TEXT NOT NULL,
  name               TEXT,
  pack_type          TEXT NOT NULL CHECK (pack_type IN ('six_followup','initial_plus_five')),
  initial_total      INTEGER NOT NULL DEFAULT 0,
  initial_used       INTEGER NOT NULL DEFAULT 0,
  followup_total     INTEGER NOT NULL DEFAULT 0,
  followup_used      INTEGER NOT NULL DEFAULT 0,
  purchased_at       TEXT NOT NULL DEFAULT (datetime('now')),
  stripe_session_id  TEXT,
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','exhausted'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_date    ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_status  ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_pkg     ON bookings(package_id);
CREATE INDEX IF NOT EXISTS idx_packages_email   ON packages(email);
