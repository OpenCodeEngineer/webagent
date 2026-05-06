-- Migration: Add invite_codes table
-- Created: 2026-05-03

CREATE TABLE IF NOT EXISTS invite_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  "createdBy" TEXT REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  "usedBy" TEXT REFERENCES users(id) ON DELETE SET NULL,
  "usedAt" TIMESTAMP,
  "expiresAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS invite_codes_code_unique ON invite_codes (code);
