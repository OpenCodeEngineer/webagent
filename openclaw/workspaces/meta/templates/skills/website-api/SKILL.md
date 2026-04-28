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
| POST | /resource | Create one | {name, type} | {id, name} |
| POST | /resource/:id/restart | Restart | — | {status: "ok"} |
| DELETE | /resource/:id | Delete | — | 204 |

List EVERY endpoint from the API. Do not omit any. -->

## How to Call the API

Use the **`fetch`** tool to make HTTP requests. Example:

```
fetch("{{API_BASE_URL}}/endpoint", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer <token>" },
  body: JSON.stringify({ key: "value" })
})
```

- For GET requests: `fetch("{{API_BASE_URL}}/resource")`
- For POST/PUT/DELETE: include `method`, `headers`, and `body` as needed.
- Parse the JSON response and present results in plain language.

## Usage Rules

1. **Always confirm** before performing actions that modify data (e.g., placing orders, updating profiles).
2. **Never expose** API keys, tokens, or internal URLs to visitors.
3. **Handle errors gracefully** — if an API call fails, explain what went wrong in plain language.
4. **Rate limiting** — do not make more than 5 API calls per visitor message.
5. **Privacy** — do not share data between different visitors.

## Example Interaction

Visitor: "What products do you have?"
→ Use `fetch` to call `GET {{API_BASE_URL}}/products`
→ Format the response as a friendly list

Visitor: "Add the blue shirt to my cart"
→ Confirm: "I'll add the Blue Shirt ($29.99) to your cart. Proceed?"
→ On yes: Use `fetch` to call `POST {{API_BASE_URL}}/cart/items` with product ID
→ Respond: "Done! Blue Shirt added to your cart."
