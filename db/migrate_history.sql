-- Migration: Add new columns and table for history/changelog features
-- Run this against the existing PostgreSQL database

-- Add new columns to sanity_runs (safe: IF NOT EXISTS equivalent via DO block)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sanity_runs' AND column_name='release') THEN
        ALTER TABLE sanity_runs ADD COLUMN release TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sanity_runs' AND column_name='category') THEN
        ALTER TABLE sanity_runs ADD COLUMN category TEXT;
    END IF;
END $$;

-- Add platform index for fast history queries
CREATE INDEX IF NOT EXISTS idx_sanity_runs_platform
  ON sanity_runs (platform, test_case, run_date DESC);

-- Create ingestion_log table for changelog tracking
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
