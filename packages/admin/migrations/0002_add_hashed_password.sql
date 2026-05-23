-- Migration: Add auth tables with hashed_password on users
-- Created: 2026-05-23

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL,
  "emailVerified" TIMESTAMP,
  image TEXT,
  hashed_password TEXT
);

-- Accounts table
CREATE TABLE IF NOT EXISTS accounts (
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at INTEGER,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  PRIMARY KEY (provider, "providerAccountId")
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  "sessionToken" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMP NOT NULL
);

-- Verification tokens table
CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL,
  expires TIMESTAMP NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- Add hashed_password column to existing users table if upgrading
ALTER TABLE users ADD COLUMN IF NOT EXISTS hashed_password TEXT;
