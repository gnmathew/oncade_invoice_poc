# CLAUDE.md — Oncade Invoice POC

Instructions for AI coding assistants working in this repo.

## What this project is
A small proof of concept for the Oncade Forward Deployed Engineer take-home (Part 2).
A TypeScript app that integrates with the **Oncade Platform API (test environment)** to:
1. **Create and send** an invoice in one call (`status: "sent"`, no drafts)
2. **List** invoices with live status
3. **Cancel** a sent invoice
4. **Receive webhooks** and update invoice status (Paid / Cancelled)

The design doc is the source of truth for scope and behaviour:
`~/Documents/ObsidianVault/OncadePOC/DesignDoc/Oncade Invoice POC - Design Doc.md`
Oncade API facts: `docs/oncade-api-notes.md`. Prefer it over memory, and flag anything marked unverified.

## Hard rules
- **Nothing is installed on the host Mac.** Never run `npm`, `node`, `npx` or `tsx` on the host.
  Everything runs in Docker: `docker compose exec app <command>`.
- **Test environment only.** The API key must start with `oncade_platform_test_`. Never use a live key.
- **Never commit secrets.** `.env` is git-ignored. `requests.http` reads secrets through `{{$dotenv ...}}`.
  Don't print keys or secrets in logs.
- **Keep scope minimal.** Don't add features, endpoints, tests, health checks or background jobs that the
  design doc doesn't list. Suggest them instead.
- Keep code simple and readable. Each file in `src/` has one job (see Layout).

## Commands (run from the repo root)
| Task | Command |
|---|---|
| Start app + tunnel | `docker compose up -d --build` |
| Rebuild after changing `package.json` | `docker compose up -d --build app` |
| Restart the app only (keeps the tunnel URL) | `docker compose restart app` |
| Reload `.env` after editing it (`restart` does NOT reload it) | `docker compose up -d app` |
| App logs | `docker compose logs -f app` |
| Tunnel public URL | `docker compose logs tunnel \| grep trycloudflare` |
| Type check | `docker compose exec app npm run typecheck` |
| Oncade connection check | `docker compose exec app npm run check-connection` |
| Export the lockfile to the repo | `docker compose cp app:/app/package-lock.json ./package-lock.json` |

`src/` is bind-mounted and `tsx watch` reloads on save. Never restart the `tunnel` container:
its URL changes, and the webhook URL in the Oncade portal would then need updating.

## Stack
Node 24 (`node:24-alpine`), TypeScript (strict, run with `tsx`, `tsc --noEmit` for checks), Express 5, zod,
SQLite through the built-in `node:sqlite` (file at `DATABASE_PATH`, default `/data/app.db` on a Docker volume),
`cloudflared` quick tunnel. No ORM and no extra libraries without asking.

## Layout (target)
```
src/server.ts            web server wiring
src/config.ts            read + validate env with zod; refuse non-test keys
src/db.ts                SQLite invoices table
src/oncade.ts            Oncade API client (create, cancel, me)
src/webhooks.ts          POST /webhooks/oncade: raw body, signature check, status update
src/page.ts              HTML page: form + auto-refreshing list + Cancel button
src/check-connection.ts  GET /v1/platform/me summary
```

## Oncade API rules (details in docs/oncade-api-notes.md)
- Base URL: `https://www.oncade.gg/api`. Paths: `/v1/platform/...`. There's no separate test host.
- Headers: `Authorization: Bearer <key>`, `X-Oncade-API-Version: v1`, `X-Target-Business-Id: <businessId>`,
  and `Idempotency-Key` on every POST/PUT.
- Use **`externalMetadata`**, never `metadata` (the old name is rejected with a 400).
  Send `{ localInvoiceId }` in it so webhooks can be matched to our row.
- Invoice amounts (`rate`, `amount`, `total`) are in **dollars**.
- Errors look like `{ error, code }`. Show `code` + `error` to the user and store it in `error_message`.
- Webhooks: verify `x-oncade-signature` = hex HMAC-SHA256 of the **raw body** with `ONCADE_WEBHOOK_SECRET`,
  using `crypto.timingSafeEqual` after a length check. Use `express.raw()` on this route only.
  Reply 2xx within 5s. Only `Paid` and `Cancelled` change status; log the other events.
  `settlementMethod: "manual"` means the business marked it paid by hand; show it as "Paid (marked manually)".
- Status safety rule: once Paid, Cancelled or Failed, a row never changes again.

## Working style
- Do one task from the design doc's work plan (section 16) at a time, then stop for review.
- When the Oncade docs and real behaviour disagree, or something is confusing, say so explicitly. It becomes
  feedback for Oncade (`docs/feedback-part2.md`, tagged broken / feels broken / confusing).
- When you are unsure about an Oncade detail, say so. Don't guess.
