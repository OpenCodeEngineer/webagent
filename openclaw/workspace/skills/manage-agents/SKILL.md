---
name: manage-agents
description: List, view, pause, resume, delete, and get embed code for customer agents. Use when the customer asks about their existing agents.
user-invocable: true
metadata: {"openclaw": {"always": true}}
---

# manage-agents

This skill lets you manage a customer's existing agents through the Lamoom proxy API.

## When to use
- Customer asks "show my agents", "list agents", "what agents do I have"
- Customer asks to "delete", "pause", "resume", "stop" an agent
- Customer asks for "embed code", "widget code", "installation code"
- Customer asks about agent "status", "sessions", "visitors"
- Customer asks to "regenerate token" or "get new token"

## API Details

- **Base URL:** `http://127.0.0.1:3001`
- **Auth:** Bearer token from environment variable `OPENCLAW_GATEWAY_TOKEN`
  - Read token: `read` the file at `~/openclaw/config/openclaw.json5`, extract the gateway auth token value
  - Or use the value directly if you already have it from a previous call
- **Customer ID:** The proxy passes the customer ID as part of the admin WebSocket session context. Extract it from the session or ask the customer.

## Available Actions

### List all agents
```
GET /api/agents?customerId=<CUSTOMER_ID>
Authorization: Bearer <TOKEN>
```
Returns array of agents with: id, name, websiteUrl, status, sessionCount, embedToken, createdAt

### Get agent details
```
GET /api/agents/<AGENT_ID>?customerId=<CUSTOMER_ID>
Authorization: Bearer <TOKEN>
```
Returns full agent object including embed code and recent sessions

### Pause an agent
```
PATCH /api/agents/<AGENT_ID>?customerId=<CUSTOMER_ID>
Authorization: Bearer <TOKEN>
Content-Type: application/json
Body: {"status": "paused"}
```

### Resume an agent
```
PATCH /api/agents/<AGENT_ID>?customerId=<CUSTOMER_ID>
Authorization: Bearer <TOKEN>
Content-Type: application/json
Body: {"status": "active"}
```

### Delete an agent
```
DELETE /api/agents/<AGENT_ID>?customerId=<CUSTOMER_ID>
Authorization: Bearer <TOKEN>
```
⚠️ ALWAYS confirm with the customer before deleting. This cannot be undone.

### Regenerate embed token
```
POST /api/agents/<AGENT_ID>/embed-token?customerId=<CUSTOMER_ID>
Authorization: Bearer <TOKEN>
```
Returns new embed token. The old token stops working immediately.

## Usage Rules

1. **Always list agents first** when the customer asks about a specific agent by name — match by name, don't guess IDs.
2. **Confirm destructive actions** — always confirm before delete or token regeneration.
3. **Format responses nicely** — show agent info as readable summaries, not raw JSON.
4. **Show embed code** when asked — format as: `<script src="https://dev.lamoom.com/widget.js" data-agent-token="<TOKEN>" async></script>`
5. **Explain status** — "active" means the agent is live and responding, "paused" means it's disabled, "deleted" means permanently removed.
6. **Session count** tells the customer how many visitors have chatted with their agent.

## Example Interactions

Customer: "Show me my agents"
→ Call GET /api/agents?customerId=...
→ Format as a list:
  "You have 2 agents:
   1. **PetPal Assistant** (active) — petpal.example.com — 4 sessions
   2. **BookNest** (active) — booknest.example.com — 2 sessions"

Customer: "Pause PetPal"
→ Find PetPal's ID from the list
→ Confirm: "I'll pause PetPal Assistant. It will stop responding to widget visitors. Continue?"
→ On yes: PATCH with {"status": "paused"}
→ "Done! PetPal Assistant is now paused. Visitors will see a generic offline message."

Customer: "Give me the embed code for BookNest"
→ Get agent details
→ Format embed code:
  "Here's your BookNest embed code — paste this before `</body>` on your site:
   ```html
   <script src="https://dev.lamoom.com/widget.js" data-agent-token="abc123" async></script>
   ```"

## Getting the Auth Token

The gateway token is needed for API calls. To get it:
1. Read `~/openclaw/config/openclaw.json5`
2. Look for `gateway.auth.token` value
3. If it starts with `$`, it's an env var reference — the actual value may need to be read from the environment or `.env` file

For the customer ID: the proxy session context should include it. If you don't have it, the customer's email can be used to look them up.
