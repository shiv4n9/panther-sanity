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
  release       TEXT,
  category      TEXT,
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- Index for fast historical queries by test_case + parameter
CREATE INDEX IF NOT EXISTS idx_sanity_runs_lookup
  ON sanity_runs (test_case, parameter, run_date DESC);

-- Index for CSV deduplication
CREATE INDEX IF NOT EXISTS idx_sanity_runs_csv_date
  ON sanity_runs (csv_filename, run_date);

-- Index for platform-specific queries
CREATE INDEX IF NOT EXISTS idx_sanity_runs_platform
  ON sanity_runs (platform, test_case, run_date DESC);

-- Track page visits for the public report
CREATE TABLE IF NOT EXISTS page_visits (
  id          SERIAL PRIMARY KEY,
  page        TEXT         NOT NULL,
  visited_at  TIMESTAMPTZ  DEFAULT NOW(),
  ip          TEXT
);

CREATE INDEX IF NOT EXISTS idx_page_visits_page
  ON page_visits (page, visited_at DESC);

-- Track each ingestion event with diff info
CREATE TABLE IF NOT EXISTS ingestion_log (
  id            SERIAL PRIMARY KEY,
  ingested_at   TIMESTAMPTZ  DEFAULT NOW(),
  release_400   TEXT,
  release_440   TEXT,
  source_file   TEXT,
  tests_added   INTEGER      DEFAULT 0,
  tests_updated INTEGER      DEFAULT 0,
  diff_json     JSONB        DEFAULT '{}'::jsonb
);
