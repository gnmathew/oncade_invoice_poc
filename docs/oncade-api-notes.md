# Oncade Platform API — working notes

A short summary of the Oncade docs, covering only what this POC uses. It was written with AI from the docs
and **must be checked by a human** (work plan task 1.2).

**Status key:** ✅ verified against the docs by a human · 📄 from the docs, not yet human-checked · ⚠️ unclear or contradictory in the docs · ❓ not documented

Sources:
- Getting started: https://pay.oncade.xyz/docs/platform-getting-started
- Invoices guide: https://pay.oncade.xyz/docs/guides/platform-invoices
- Businesses guide: https://pay.oncade.xyz/docs/guides/platform-businesses
- Embedded finance: https://pay.oncade.xyz/docs/embedded-finance
- API reference: https://pay.oncade.xyz/docs/api-reference/platform

---

## Hosts and auth

| Item | Value | Status |
|---|---|---|
| API base URL | `https://www.oncade.gg/api` + `/v1/platform/...` | 📄 |
| Test vs live | No separate host. The key's prefix decides: `oncade_platform_test_…` / `oncade_platform_live_…` | 📄 |
| Developer portal | https://dev.oncade.xyz (create platforms, keys, webhook settings) | 📄 |
| Auth header | `Authorization: Bearer <key>` | 📄 |
| Version header | `X-Oncade-API-Version: v1` (docs say both "must include" and "defaults to v1") | ⚠️ |
| Business header | `X-Target-Business-Id: <businessId>`. Required on business operations, including create invoice. No default | 📄 |
| Idempotency | `Idempotency-Key` on POST/PUT/PATCH. 1–255 chars `[A-Za-z0-9-.:]`. Stored 24h. Replay returns header `Idempotent-Replayed: true`; `409 IDEMPOTENCY_IN_PROGRESS`; `422 IDEMPOTENCY_KEY_REUSED` (same key, different body) | 📄 |
| Errors | Body `{ "error": "...", "code": "..." }`. 400 validation, 401 bad key, 403 scope or grant, 404, 409, 422 invalid state, 5xx retry with the same key | 📄 |
| Rate limits | None today, per the docs | 📄 |

## Finding the business ID

| Source | Detail | Status |
|---|---|---|
| Portal Grants tab | Does **not** show the platform's own business (seen on 2026-11-26) | ✅ observed |
| `GET /v1/platform/me` (`platform:read`) | Response includes `businessId`, plus `platformId`, `status`, `approvedScopes`, `pendingScopes`, `keyInfo { keyId, environment, activeScopes, requestedScopes }` | 📄 |
| Is `/me`'s `businessId` the platform's own business? | Likely, but not stated in the docs | ❓ |
| `GET /v1/platform/grants` (`platform.grant:manage`) | Lists businesses that granted access: `{ grants: [{ grantId, businessId, businessName, grantedScopes }], total }` | 📄 |
| ID format | Examples mix `biz_xyz789` and 24-char hex | ⚠️ |

## Payout wallet

- Platform invoice creation **requires** the business to have a `payoutWallet`, otherwise `400`. 📄
- The same guide also says the owner's wallet is a fallback. ⚠️ contradictory
- Set it through: the Oncade dashboard (business owner), `PATCH /v1/platform/business` (`business:update`), or at business creation. 📄
- Readiness check: `GET /v1/platform/business/readiness` (`business:read`) lists setup steps, including the payout wallet. 📄 from a summary only, path unconfirmed

## Invoices

### Create (and send) — `POST /v1/platform/invoices` · scope `invoice:create`
Returns **201** with a `Location` header. 📄

| Field | Rule | Status |
|---|---|---|
| `receiverName` | Required unless `recipientBusinessId` | 📄 |
| `receiverEmail` | Exactly one of `receiverEmail` / `recipientBusinessId` | 📄 |
| `date` | ISO 8601 | 📄 |
| `dueDate` | Optional, ≥ `date` | 📄 |
| `payToTarget` | `"BUSINESS"` (`MY_ACCOUNT` is not supported for platforms) | 📄 |
| `items[]` | `{ description, quantity, rate, amount }`. **Dollars** | 📄 |
| `status` | `"draft"` (default) or **`"sent"`** = create and email in one call | 📄 |
| `externalMetadata` | Free-form object, echoed back in responses and webhooks. **`metadata` is the old name and returns a 400** (the guide says this; the API reference still lists `metadata`) | ⚠️ |
| `total`, `tax`, `note`, `invoiceNumber` | Optional. `total` is rejected if it's off by more than $0.01 | 📄 |
| `environment` | Don't send it (taken from the key) | 📄 |

Response fields: `_id`, `invoiceNumber`, `receiverName`, `receiverEmail`, `total`, `status`, `paymentSummary { invoiceAmount, payerFee, totalCharged }`, `publicInvoiceId`, `environment`, `links.invoice` (the hosted pay page; use as returned, don't construct it). 📄

### Other invoice endpoints
| Endpoint | Scope | Notes | Status |
|---|---|---|---|
| `GET /v1/platform/invoices` | `invoice:read` | `page`, `limit` (max 100), `status` filter | 📄 |
| `GET /v1/platform/invoices/{id}` | `invoice:read` | | 📄 |
| `PUT /v1/platform/invoices/{id}` | `invoice:update` | **Full replacement**. Paid or cancelled → `422 INVOICE_INVALID_STATUS` | 📄 |
| `POST /v1/platform/invoices/{id}/send` | `invoice:send` | Only from draft (unused: we create with `status: "sent"`) | 📄 |
| `POST /v1/platform/invoices/{id}/cancel` | `invoice:cancel` | From draft or sent. Terminal | 📄 |

### Lifecycle
`draft` → `sent` → (`processing`, ACH only) → `paid`; `draft`/`sent` → `cancelled`. `paid` and `cancelled` are terminal. 📄
No webhook fires for `processing`. ⚠️

### Payment
The recipient pays on Oncade's hosted page (`links.invoice`). Methods: bank (ACH) and USDC are mentioned. Whether card payments are available, and what test mode offers, isn't documented. ❓

## Webhooks

| Item | Detail | Status |
|---|---|---|
| Setup | Portal → platform → Settings: webhook URL + generate secret (shown once) | 📄 |
| Envelope | `{ id: "evt_…", event, data, timestamp }`. `id` is stable across retries | 📄 |
| Headers | `x-oncade-signature`, `x-oncade-event`, `x-oncade-event-id`, `x-oncade-delivery-id`, `x-oncade-attempt`, `x-oncade-platform-id` | 📄 |
| Signature | Hex HMAC-SHA256 of the **raw body** with the platform webhook secret. Compare with `timingSafeEqual`. No signed timestamp | 📄 |
| Ack | Any 2xx within 5s. 3 attempts: 0s, +60s, +120s. Manual resend in the portal's Webhooks tab | 📄 |
| Test or ping event | None | ❓ |
| Ordering | Not guaranteed or documented | ❓ |

### Invoice events
`Platform.Invoice.Created`, `.Updated`, `.Sent`, `.Paid`, `.Cancelled`. 📄

`Paid` data example (abridged): 📄
```json
{
  "invoiceId": "inv_abc123",
  "invoiceNumber": "INV-0042",
  "businessId": "...",
  "receiverEmail": "billing@acme.com",
  "total": 1000,
  "currency": "USD",
  "status": "paid",
  "environment": "live",
  "publicInvoiceId": "pinv_xyz789",
  "externalMetadata": { "poNumber": "PO-1042" },
  "settlementMethod": "verified"
}
```
- `settlementMethod`: `"verified"` (settled through payment rails) or `"manual"` (marked paid by the business). 📄
