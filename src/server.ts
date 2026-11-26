// The web server: serves the page, the app's addresses and the webhook receiver (design doc section 8).
import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config";
import * as db from "./db";
import { cancelInvoice, createInvoice, oncadeIdOf } from "./oncade";
import { renderPage } from "./page";
import { webhookRouter } from "./webhooks";

const app = express();

// Webhooks from Oncade. Must come BEFORE express.json(), which would change the raw bytes.
app.use(webhookRouter);

// Read the JSON that the page sends.
app.use(express.json());

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// The page
app.get("/", (_req, res) => {
  res.type("html").send(renderPage());
});

// What the "New invoice" form must contain
const newInvoiceSchema = z.object({
  customerName: z.string().trim().min(1, "Customer name is required"),
  customerEmail: z.email("Customer email is not a valid email address"),
  description: z.string().trim().min(1, "Description is required"),
  amount: z.coerce.number().positive("Amount must be more than 0"),
});

// Create & send an invoice
app.post("/invoices", async (req, res) => {
  const parsed = newInvoiceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join(". ") });
    return;
  }

  const id = `inv-${randomUUID()}`;
  const invoice = { ...parsed.data, amount: Math.round(parsed.data.amount * 100) / 100 };

  // 1. Save it first, so there's a record even if the next step fails.
  db.insertInvoice({ id, ...invoice });

  // 2. Ask Oncade to create it and email it to the customer.
  try {
    const reply = await createInvoice({ localInvoiceId: id, ...invoice });
    const oncadeId = oncadeIdOf(reply);
    db.markSent(id, oncadeId, reply.links?.invoice ?? null);
    console.log(`[create] ${id} -> Oncade invoice ${oncadeId ?? "(no id in reply)"}`);
  } catch (err) {
    db.markFailed(id, errorMessage(err));
    console.error(`[create] ${id} failed: ${errorMessage(err)}`);
  }

  // 3. Send the saved invoice back to the page.
  res.status(201).json(db.getInvoice(id));
});

// The invoice list
app.get("/invoices", (_req, res) => {
  res.json(db.listInvoices());
});

// Cancel an invoice
app.post("/invoices/:id/cancel", async (req, res) => {
  const invoice = db.getInvoice(req.params.id);
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (invoice.status !== "Sent" || !invoice.oncade_invoice_id) {
    res.status(409).json({ error: `Only Sent invoices can be cancelled (this one is ${invoice.status})` });
    return;
  }

  try {
    await cancelInvoice(invoice.oncade_invoice_id, invoice.id);
    db.setFinalStatus(invoice.id, "Cancelled");
    console.log(`[cancel] ${invoice.id} cancelled at Oncade`);
    res.json(db.getInvoice(invoice.id));
  } catch (err) {
    console.error(`[cancel] ${invoice.id} failed: ${errorMessage(err)}`);
    res.status(502).json({ error: errorMessage(err) });
  }
});

app.listen(config.PORT, () => {
  console.log(`App listening on http://localhost:${config.PORT}`);
});
