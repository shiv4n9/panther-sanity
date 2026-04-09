-- Panther Sanity — Historical Execution Database Schema
-- Runs automatically on first postgres container boot

CREATE TABLE IF NOT EXISTS sanity_runs (
  id            SERIAL PRIMARY KEY,
  run_date      DATE         NOT NULL,
  test_case     TEXT         NOT NULL,
  parameter     TEXT         NOT NULL,
  throughput    TEXT         NOT NULL,
  cpu           TEXT,
  memory        TEXT,
  shm           TEXT,
  platform      TEXT,
  image_name    TEXT,
  csv_filename  TEXT,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- Index for fast historical queries by test_case + parameter
CREATE INDEX IF NOT EXISTS idx_sanity_runs_lookup
  ON sanity_runs (test_case, parameter, run_date DESC);

-- Index for CSV deduplication
CREATE INDEX IF NOT EXISTS idx_sanity_runs_csv_date
  ON sanity_runs (csv_filename, run_date);
