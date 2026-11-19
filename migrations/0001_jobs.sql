-- Proseforge M2: job metadata ONLY. Never store document content in D1.
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  uploaded_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_uploaded_at ON jobs (uploaded_at);
