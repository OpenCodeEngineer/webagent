---
name: openclaw-console-navigation
description: Answer OpenClaw Console navigation/help questions with canonical links and command-centric steps.
user-invocable: false
metadata: {"openclaw": {"always": true}}
---

# openclaw-console-navigation

Use this skill for customer prompts like:
- "how to use console"
- "how billing works"
- "how to deploy"

## Rules
1. Give direct steps first (Open → Click → Review → Confirm).
2. Include canonical console links in the same response.
3. Prefer route-accurate guidance over generic advice.
4. Keep answers concise and actionable.
5. For API actions (restart, delete, create), use the `fetch` tool to call the endpoint and report the result.
6. For authenticated API calls, read credentials from platform-provided session context (`Authorization`, `Bearer`, `apiToken`, optional `headers`).
7. Never ask users to extract tokens from DevTools, localStorage/sessionStorage, cookies, or browser network logs.
8. If credentials are missing, provide a concrete admin action: configure session auth context in the integration backend, then retry the exact API call.
9. **Intent echo:** When a user asks to restart/delete/create and auth is missing, always state: "I will call `POST /api/v1/tenants/:id/restart` (or the relevant endpoint) once session auth context is available. An admin needs to configure `Authorization` in widget integration settings." Also include expected outcome.
