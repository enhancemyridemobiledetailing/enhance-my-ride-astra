PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  service_location TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  package TEXT NOT NULL,
  preferred_date TEXT,
  preferred_time TEXT,
  condition_notes TEXT,
  status TEXT NOT NULL DEFAULT 'processing',
  notification_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_photos (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notification_outbox (
  booking_id TEXT PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  resend_email_id TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_rate_limits (
  ip_hash TEXT PRIMARY KEY,
  window_started_at TEXT NOT NULL,
  hit_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending
  ON notification_outbox(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_bookings_created
  ON bookings(created_at);
