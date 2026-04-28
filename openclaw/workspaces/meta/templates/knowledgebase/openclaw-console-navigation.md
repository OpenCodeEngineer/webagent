# OpenClaw Console Knowledgebase

## Product Summary
OpenClaw Box is a managed AI assistant hosting platform. Users deploy their own OpenClaw instance
(an AI agent) in under 60 seconds via Telegram — no Docker, no server config.

**Console URL:** https://openclaw.vibebrowser.app/console/

## Canonical Links
| Resource | URL |
|---|---|
| Console | https://openclaw.vibebrowser.app/console/ |
| Billing | https://openclaw.vibebrowser.app/console/billing |
| Plans | https://openclaw.vibebrowser.app/pricing |
| Docs | https://openclaw.vibebrowser.app/docs |
| Telegram Bot | https://t.me/OpenClawBoxBot |
| FAQ | https://openclaw.vibebrowser.app/faq |
| MCP Info | https://openclaw.vibebrowser.app/mcp |

## REST API — /api/v1

**Base URLs (try in order):**
1. `https://admin.openclaw.vibebrowser.app`
2. `https://console.openclaw.vibebrowser.app`

**Auth:** Bearer JWT. Obtain via `POST /api/v1/auth/login`. Pass as `Authorization: Bearer <token>`.
Tokens auto-refresh via `POST /api/v1/auth/refresh` using the refresh token.

### Auth Endpoints
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/login` | Login. Body: `{provider: "telegram", telegram: {...}}` or `{provider: "google", idToken: "..."}` or `{provider: "email_password", email, password}` |
| POST | `/api/v1/auth/register-password` | Register new email/password account. Body: `{email, password}` |
| POST | `/api/v1/auth/refresh` | Refresh access token. Body: `{refreshToken}` |
| GET  | `/api/v1/auth/me` | Current user + subscription. Returns `{user: {id, username, displayName, email, provider}, subscription: {planId, planTitle, expiresAt}}` |

### Plans
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/plans` | List available plans. Returns array of `{id, title, description, stars, usdPrice, hostedModels}` |

### Tenants (Instances)
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/tenants` | List user's tenants. Returns array of `{id, subdomain, status, tenantType, specialistPresets, planId, planTitle, createdAt, url, browserUrl}` |
| GET | `/api/v1/tenants/:id` | Get single tenant details |
| POST | `/api/v1/tenants` | Create tenant. Body: `{planId, tenantType: "personal"|"team", hostType: "container"|"vps", promoCode?, specialistPresets?: [...], vmProvider?: "hetzner"}`. Returns `{action: "created"}` or `{action: "payment_required", checkout: {...}}` |
| DELETE | `/api/v1/tenants/:id` | Permanently delete tenant |
| POST | `/api/v1/tenants/:id/restart` | Restart a running tenant |
| GET | `/api/v1/tenants/:id/logs` | Get tenant logs. Query: `?tail=100` |

### Specialists
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/tenants/specialists` | List available specialist presets. Returns `{specialists: [{id, label, description}]}` |
| POST | `/api/v1/tenants/:id/specialists/install` | Install specialist packs. Body: `{specialistPresets: ["specialist-id", ...]}` |

### Billing
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/billing` | Billing overview: subscription, budget (spent/remaining), credit packs, payment history |
| POST | `/api/v1/billing/topup` | Create top-up checkout (Stripe). Body: `{packId}`. Returns `{checkoutUrl}` |
| POST | `/api/v1/billing/topup/crypto` | Create top-up checkout (crypto). Body: `{packId}`. Returns `{checkoutUrl}` |

## Tenant Status Values
- `provisioning` — being created
- `running` — live and accessible
- `suspended` — paused (billing issue)
- `deleting` — deletion in progress
- `deleted` — gone

## Key User Flows
1. **Sign in** → GET /api/v1/auth/me to load dashboard
2. **Create instance** → GET /api/v1/plans → POST /api/v1/tenants
3. **Manage instance** → GET /api/v1/tenants → restart/delete
4. **Add specialists** → GET /api/v1/tenants/specialists → POST install
5. **Top up credits** → GET /api/v1/billing → POST /api/v1/billing/topup
