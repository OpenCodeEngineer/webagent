-- Migration: Add per-user API token for embed auth
-- Created: 2026-05-25

ALTER TABLE users ADD COLUMN IF NOT EXISTS api_token TEXT;
