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

## Usage Rules

1. **Always confirm** before performing actions that modify data (e.g., placing orders, updating profiles).
2. **Never expose** API keys, tokens, or internal URLs to visitors.
3. **Handle errors gracefully** — if an API call fails, explain what went wrong in plain language.
4. **Rate limiting** — do not make more than 5 API calls per visitor message.
5. **Privacy** — do not share data between different visitors.

## Example Interaction

Visitor: "What products do you have?"
→ Call `GET {{API_BASE_URL}}/products`
→ Format the response as a friendly list

Visitor: "Add the blue shirt to my cart"
→ Confirm: "I'll add the Blue Shirt ($29.99) to your cart. Proceed?"
→ On yes: Call `POST {{API_BASE_URL}}/cart/items` with product ID
→ Respond: "Done! Blue Shirt added to your cart."
