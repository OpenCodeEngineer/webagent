---
name: website-api
description: Interact with {{WEBSITE_NAME}}'s API to help visitors with their requests.
user-invocable: false
metadata: {"openclaw": {"always": true}}
---

# website-api

This skill enables you to interact with **{{WEBSITE_NAME}}**'s API on behalf of visitors.

## API Details

- **Base URL:** {{API_BASE_URL}}
- **Auth:** {{API_AUTH_METHOD}}
- **Style:** {{API_STYLE}}

## Available Actions

{{API_ENDPOINTS}}

<!-- GENERATION NOTE: When filling this section, use a structured table format:
| Method | Path | Description | Request Body | Response |
|--------|------|-------------|-------------|----------|
| GET | /resource | List all | — | [{id, name}] |
| POST | /resource | Create one (workflow: create-resource-<ts>.py) | {name, type} | {id, name} |
| POST | /resource/:id/restart | Restart (workflow: restart-resource-<ts>.py) | — | {status: "ok"} |
| DELETE | /resource/:id | Delete (workflow: delete-resource-<ts>.py) | — | 204 |

List EVERY endpoint from the API. Do not omit any. For mutating endpoints (POST/PUT/PATCH/DELETE), the Description column should note the workflow filename pattern that will be generated when invoked (e.g. "Create contact (workflow: create-contact-<ts>.py)"). -->

## How to Call the API

**All mutations (POST/PATCH/PUT/DELETE) and any call that requires credentials MUST follow the workflow-as-code pattern.** Read-only Q&A with no auth MAY use web/fetch tooling directly.

### Workflow-based flow (required for mutations)

1. **Compose a Python script** under `workflows/<verb>-<noun>-<YYYYMMDD-HHMMSS>.py`. The script must:
   - Include a top-of-file docstring (action name, arguments, expected result).
   - Read auth from `os.environ` (e.g. `LAMOOM_AUTH_HEADER`, or session-provided env vars).
   - Use the `requests` library to call the API (method-capable: POST/PATCH/PUT/DELETE supported).
   - Print a JSON result to stdout (e.g. `{"status": "ok", "id": 123}`).
   - Exit 0 on success, non-zero on failure.

2. **Run it:** `exec python3 workflows/<filename>.py` (prepend env vars as needed).

3. **Parse** the printed JSON and reply in plain language.

Use a method-capable HTTP tool for API requests. The `group:web` tools are for search and GET/read-only fetches; do not rely on them for POST/PATCH/PUT/DELETE mutations. Use `exec` with `curl` for mutations only when a Python workflow is not appropriate. Example of equivalent curl for reference:

```bash
curl -sS -X POST "{{API_BASE_URL}}/endpoint" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  --data '{"key":"value"}'
```

- For GET requests: use web/fetch tooling when available, or `curl -sS "{{API_BASE_URL}}/resource"` via `exec`.
- For low-risk, unambiguous mutations with complete fields: execute a workflow script directly and report outcome.
- Parse the JSON response and present results in plain language.

## Session Auth Context Contract

- Read auth context from session keys that may provide `Authorization`, `Bearer`, `apiToken`, or `headers`.
- Build request headers in this order: explicit request `Authorization` (if intentionally set) → session `Authorization` → `Bearer`/`apiToken` converted to `Authorization: Bearer <token>`.
- Merge custom session `headers` as additional headers without dropping required defaults.
- Keep backward compatibility: support legacy key shapes and missing fields gracefully.
- Safety: never log tokens/secrets, request only least-privilege scopes, preserve existing explicit user headers unless intentionally overridden, and sanitize/validate header input shape before use.

## Credential Source Policy (Required)

- Credential source is **platform-provided session context** (server-side integration), not browser scraping.
- Never ask visitors to retrieve tokens from DevTools, localStorage, sessionStorage, cookies, or network tabs.
- If auth context is missing, reply with a concrete admin action:
  - "I can run this once an admin configures session auth context (for example `Authorization` or `apiToken`) in the widget/integration backend."
  - Then provide the exact API call you will run after configuration.
- **Intent echo (mandatory):** Even when credentials are missing, always state your planned action:
  - "I will call `POST {{API_BASE_URL}}/resource/:id/restart` once auth context is configured."
  - Never say only "I can't do that" — always specify the exact endpoint, method, and expected outcome.

## Usage Rules

1. **Confirmation policy:**
   - For destructive/high-risk mutations (delete, irreversible state change, financial action), confirm first.
   - For low-risk, unambiguous mutations with complete fields (for example create a contact with full required fields), execute directly.
   - If you asked for confirmation and user says yes, execute the exact proposed API call immediately; do not reset context.
2. **Never expose** API keys, tokens, or internal URLs to visitors.
3. **Handle errors gracefully** — if an API call fails, explain what went wrong in plain language.
4. **Rate limiting** — do not make more than 5 API calls per visitor message.
5. **Privacy** — do not share data between different visitors.

## Example Interaction

Visitor: "What products do you have?"
→ Read-only, no credentials needed — call `GET {{API_BASE_URL}}/products` directly via web/fetch tooling.
→ Format the response as a friendly list.

Visitor: "Add the blue shirt to my cart"
→ Confirm: "I'll add the Blue Shirt ($29.99) to your cart. Proceed?"
→ On yes: write `workflows/add-cart-item-20260523-143200.py`:

```python
"""
Action: Add item to cart
Args: product_id=shirt-blue-001, quantity=1
Expected result: Cart item created, returns {cart_item_id, product_id, quantity}
"""
import os
import sys
import json
import uuid
import requests

IDEMPOTENCY_KEY = str(uuid.uuid4())
AUTH = os.environ["LAMOOM_AUTH_HEADER"]
BASE_URL = "{{API_BASE_URL}}"

resp = requests.post(
    f"{BASE_URL}/cart/items",
    headers={
        "Authorization": AUTH,
        "Content-Type": "application/json",
        "Idempotency-Key": IDEMPOTENCY_KEY,
    },
    json={"product_id": "shirt-blue-001", "quantity": 1},
    timeout=10,
)
resp.raise_for_status()
print(json.dumps({"status": "ok", "cart_item": resp.json()}))
sys.exit(0)
```

→ Run: `exec python3 workflows/add-cart-item-20260523-143200.py`
→ Respond: "Wrote workflow `workflows/add-cart-item-20260523-143200.py` and ran it. Result: Blue Shirt added to your cart."
