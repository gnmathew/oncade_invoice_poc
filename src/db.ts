// The app's invoice list, stored in a SQLite database file (DATABASE_PATH, on a Docker volume).
// One table, "invoices" (design doc section 7). It's created automatically on first start.
import { DatabaseSync } from "node:sqlite";
import { config } from "./config";

export type InvoiceStatus = "Creating" | "Sent" | "Paid" | "Cancelled" | "Failed";

export type InvoiceRow = {
  id: string;
  customer_name: string;
  customer_email: string;
  description: string;
  amount: number; // US dollars
  status: InvoiceStatus;
  oncade_invoice_id: string | null;
  pay_link: string | null;
  paid_how: string | null; // "verified" (by Oncade) or "manual" (marked paid by the business)
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

const db = new DatabaseSync(config.DATABASE_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id                TEXT PRIMARY KEY,
    customer_name     TEXT NOT NULL,
    customer_email    TEXT NOT NULL,
    description       TEXT NOT NULL,
    amount            REAL NOT NULL,
    status            TEXT NOT NULL,
    oncade_invoice_id TEXT,
    pay_link          TEXT,
    paid_how          TEXT,
    error_message     TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  )
`);

function now(): string {
  return new Date().toISOString();
}

/** Step 1 of creating an invoice: save it BEFORE calling Oncade, with status "Creating". */
export function insertInvoice(invoice: {
  id: string;
  customerName: string;
  customerEmail: string;
  description: string;
  amount: number;
}): void {
  const timestamp = now();
  db.prepare(
    `INSERT INTO invoices (id, customer_name, customer_email, description, amount, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Creating', ?, ?)`,
  ).run(invoice.id, invoice.customerName, invoice.customerEmail, invoice.description, invoice.amount, timestamp, timestamp);
}

/** Oncade accepted the invoice: store its ID and pay link. "Creating" becomes "Sent". */
export function markSent(id: string, oncadeInvoiceId: string | null, payLink: string | null): void {
  db.prepare(
    `UPDATE invoices
     SET oncade_invoice_id = ?, pay_link = ?, updated_at = ?,
         status = CASE WHEN status = 'Creating' THEN 'Sent' ELSE status END
     WHERE id = ?`,
  ).run(oncadeInvoiceId, payLink, now(), id);
}

/** Oncade refused the invoice: keep the reason so it can be shown in the list. */
export function markFailed(id: string, errorMessage: string): void {
  db.prepare(
    `UPDATE invoices SET status = 'Failed', error_message = ?, updated_at = ?
     WHERE id = ? AND status = 'Creating'`,
  ).run(errorMessage, now(), id);
}

/**
 * Set Paid or Cancelled, following the safety rule: a row that is already
 * Paid, Cancelled or Failed never changes. Returns true if the row changed.
 */
export function setFinalStatus(id: string, status: "Paid" | "Cancelled", paidHow: string | null = null): boolean {
  const result = db
    .prepare(
      `UPDATE invoices SET status = ?, paid_how = ?, updated_at = ?
       WHERE id = ? AND status NOT IN ('Paid', 'Cancelled', 'Failed')`,
    )
    .run(status, paidHow, now(), id);
  return Number(result.changes) > 0;
}

export function getInvoice(id: string): InvoiceRow | undefined {
  return db.prepare("SELECT * FROM invoices WHERE id = ?").get(id) as unknown as InvoiceRow | undefined;
}

/** Find an invoice by our ID first, then by Oncade's ID (used by webhooks). */
export function findInvoice(localId?: string, oncadeInvoiceId?: string): InvoiceRow | undefined {
  if (localId) {
    const row = getInvoice(localId);
    if (row) return row;
  }
  if (oncadeInvoiceId) {
    return db
      .prepare("SELECT * FROM invoices WHERE oncade_invoice_id = ?")
      .get(oncadeInvoiceId) as unknown as InvoiceRow | undefined;
  }
  return undefined;
}

/** All invoices, newest first. */
export function listInvoices(): InvoiceRow[] {
  return db.prepare("SELECT * FROM invoices ORDER BY created_at DESC").all() as unknown as InvoiceRow[];
}