-- Proseforge M2: columns the D1R2JobStore needs beyond migration 0001.
-- Job metadata ONLY. Never store document content in D1.
ALTER TABLE jobs ADD COLUMN format TEXT NOT NULL DEFAULT 'docx';
ALTER TABLE jobs ADD COLUMN progress_stage TEXT NOT NULL DEFAULT '';
ALTER TABLE jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN refined_r2_key TEXT;
ALTER TABLE jobs ADD COLUMN report_json TEXT;
ALTER TABLE jobs ADD COLUMN download_token_hash TEXT;
ALTER TABLE jobs ADD COLUMN token_expires_at TEXT;
ALTER TABLE jobs ADD COLUMN error TEXT;
