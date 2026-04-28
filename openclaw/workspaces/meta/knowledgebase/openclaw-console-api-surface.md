# OpenClaw Console API Surface (Canonical)

This file is the canonical machine-readable API reference for OpenClaw Console agent generation.
Use it as the source of truth for OpenClaw Console onboarding.

## Base URLs (ordered)
1. `https://admin.openclaw.vibebrowser.app`
2. `https://console.openclaw.vibebrowser.app`

## Auth Contract

### HTTP Auth Requirement
- Send `Authorization: Bearer <token>` for authenticated `/api/v1/*` requests.
- Tokens must come from platform-provided session context in the integration backend.
- Never request tokens from DevTools, localStorage/sessionStorage, cookies, or network logs.

### Session Auth Context Keys (exact keys, stable order)
| Order | Key | Type | Mapping Rule |
|---|---|---|---|
| 1 | `Authorization` | string | Use as-is when present and non-empty. |
| 2 | `Bearer` | string | Convert to `Authorization: Bearer <Bearer>`. |
| 3 | `apiToken` | string | Convert to `Authorization: Bearer <apiToken>`. |
| 4 | `headers` | object | Merge as additional headers after auth resolution; do not drop required defaults. |

## Endpoint Table (`/api/v1`)
| Method | Path | Description | Request Body | Response Shape |
|---|---|---|---|---|
| POST | `/auth/login` | Login with provider flow | `{provider: "telegram", telegram: {...}}` OR `{provider: "google", idToken: "..."}` OR `{provider: "email_password", email, password}` | Auth payload with access/refresh token fields (provider-dependent) |
| POST | `/auth/register-password` | Register email/password user | `{email, password}` | User/auth payload |
| POST | `/auth/refresh` | Refresh access token | `{refreshToken}` | Refreshed token payload |
| GET | `/auth/me` | Current user + subscription | _none_ | `{user: {id, username, displayName, email, provider}, subscription: {planId, planTitle, expiresAt}}` |
| GET | `/plans` | List plans | _none_ | `[{id, title, description, stars, usdPrice, hostedModels}]` |
| GET | `/tenants` | List tenants/instances | _none_ | `[{id, subdomain, status, tenantType, specialistPresets, planId, planTitle, createdAt, url, browserUrl}]` |
| GET | `/tenants/:id` | Get tenant by id | _none_ | Tenant object |
| POST | `/tenants` | Create tenant | `{planId, tenantType: "personal"|"team", hostType: "container"|"vps", promoCode?, specialistPresets?, vmProvider?}` | `{action: "created"}` OR `{action: "payment_required", checkout: {...}}` |
| DELETE | `/tenants/:id` | Delete tenant | _none_ | Deletion result |
| POST | `/tenants/:id/restart` | Restart tenant deployment | No body required. `POST` with no body is accepted; `{}` is also accepted. | Restart result/acknowledgement |
| GET | `/tenants/:id/logs` | Fetch tenant logs | Query: `tail` (e.g. `?tail=100`) | Log entries payload |
| GET | `/tenants/specialists` | List specialist presets | _none_ | `{specialists: [{id, label, description}]}` |
| POST | `/tenants/:id/specialists/install` | Install specialists | `{specialistPresets: ["specialist-id", ...]}` | Install result |
| GET | `/billing` | Billing overview | _none_ | `{subscription, budget, creditPacks, payments}` |
| POST | `/billing/topup` | Stripe top-up checkout | `{packId}` | `{checkoutUrl}` |
| POST | `/billing/topup/crypto` | Crypto top-up checkout | `{packId}` | `{checkoutUrl}` |

## Restart Flow Examples

### Preferred (no request body)
```http
POST /api/v1/tenants/<tenantId>/restart
Authorization: Bearer <token>
```

### Also accepted (`{}`)
```http
POST /api/v1/tenants/<tenantId>/restart
Authorization: Bearer <token>
Content-Type: application/json

{}
```
