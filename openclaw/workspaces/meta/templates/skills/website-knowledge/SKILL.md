<!-- TEMPLATE: All {{PLACEHOLDER}} values below MUST be replaced before use. -->
---
name: website-knowledge
description: Answer visitor questions about {{WEBSITE_NAME}} using verified website facts and canonical links.
user-invocable: false
metadata: {"openclaw": {"always": true}}
---

# website-knowledge

Use this skill for product, onboarding, pricing, and support questions about **{{WEBSITE_NAME}}**.

## Source of truth
- `knowledgebase/overview.md`
- `knowledgebase/key-links.md`
- `knowledgebase/use-cases.md`

## Response rules
1. Prioritize factual answers grounded in the knowledgebase files.
2. For install/onboarding questions, provide direct links (install + docs) in the same response.
3. For pricing questions, include the canonical pricing URL.
4. For support/contact questions, include the canonical support/contact URL.
5. If a requested link is unknown, say so clearly and provide the closest verified link.

## Link-first policy
When the user asks "how do I install", "where do I download", or similar:
- Give a concise answer.
- Include the direct install/onboarding URL(s) explicitly.
- Optionally include one short next step.
