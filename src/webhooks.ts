// Receives Oncade's webhooks (design doc sections 5 and 9).
// 1. Check the signature  2. Reply "got it" quickly  3. Update the invoice list.
import express, { Router } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import * as db from "./db";

export const webhookRouter = Router();

/** The parts of a webhook message we use. */
type WebhookMessage = {
  id?: string;
  event?: string;
  data?: {
    invoiceId?: string;
    status?: string;
    settlementMethod?: string;
    externalMetadata?: { localInvoiceId?: unknown };
  };
};

/** True if x-oncade-signature matches the HMAC-SHA256 of the exact message bytes. */
function signatureIsValid(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", config.ONCADE_WEBHOOK_SECRET).update(rawBody).digest("hex");
  const received = signatureHeader.trim().toLowerCase().replace(/^sha256=/, "");
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

function handleMessage(message: WebhookMessage, logPrefix: string): void {
  const data: NonNullable<WebhookMessage["data"]> = message.data ?? {};
  const metadataId = data.externalMetadata?.localInvoiceId;
  const localId = typeof metadataId === "string" ? metadataId : undefined;
  const prefix = `${logPrefix} (oncade ${data.invoiceId ?? "?"}, ours ${localId ?? "?"})`;

  let newStatus: "Paid" | "Cancelled" | undefined;
  if (message.event === "Platform.Invoice.Paid") newStatus = "Paid";
  if (message.event === "Platform.Invoice.Cancelled") newStatus = "Cancelled";

  if (!newStatus) {
    console.log(`${prefix}: signature ok, logged only`);
    return;
  }

  const invoice = db.findInvoice(localId, data.invoiceId);
  if (!invoice) {
    console.warn(`${prefix}: no matching invoice in our list`);
    return;
  }

  const paidHow = newStatus === "Paid" ? (data.settlementMethod ?? null) : null;
  const changed = db.setFinalStatus(invoice.id, newStatus, paidHow);
  console.log(
    `${prefix}: ${changed ? `status -> ${newStatus}${paidHow ? ` (${paidHow})` : ""}` : `no change (already ${invoice.status})`}`,
  );
}

// express.raw() keeps the exact bytes, which the signature check needs.
webhookRouter.post("/webhooks/oncade", express.raw({ type: "*/*", limit: "1mb" }), (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const event = req.header("x-oncade-event") ?? "unknown-event";
  const eventId = req.header("x-oncade-event-id") ?? "?";
  const attempt = req.header("x-oncade-attempt") ?? "?";
  const logPrefix = `[webhook] ${event} ${eventId} attempt ${attempt}`;

  if (!signatureIsValid(rawBody, req.header("x-oncade-signature"))) {
    console.warn(`${logPrefix}: INVALID SIGNATURE, rejected`);
    res.status(401).json({ error: "invalid signature" });
    return;
  }

  // Reply first (Oncade wants an answer within 5 seconds), then process.
  res.status(200).json({ received: true });

  try {
    handleMessage(JSON.parse(rawBody.toString("utf8")) as WebhookMessage, logPrefix);
  } catch (err) {
    console.error(`${logPrefix}: could not process: ${err instanceof Error ? err.message : String(err)}`);
  }
});
