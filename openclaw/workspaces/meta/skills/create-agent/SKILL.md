---
name: create-agent
description: Create and register a new customer agent workspace for WebAgent.
triggers:
  - create agent
  - setup agent
  - onboard customer
author: webagent
---

# create-agent

## Step 1 — Gather website info
Collect website URL, website name, and a short website/product description.

## Step 2 — Understand the API
Collect API base URL, authentication method, and core endpoints (method + path + purpose).

## Step 3 — Generate workspace files from templates
Render AGENTS.md, SOUL.md, IDENTITY.md, and USER.md from `openclaw/templates` with customer-specific values.

## Step 4 — Create agent directory structure
Create `openclaw/workspaces/<agent-id>/` and include docs plus `skills/website-api/SKILL.md`.

## Step 5 — Update openclaw.json
Add the new agent to `openclaw/config/openclaw.json5` under `agents.list`.

## Step 6 — Generate embed code snippet
Produce a copy/paste script tag snippet for the customer's website.

## Step 7 — Save widget code in workspace
Write a widget integration file in the agent workspace with the configured token and server URL.
