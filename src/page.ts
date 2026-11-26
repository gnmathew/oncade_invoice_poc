// The app's single web page (design doc section 8): a form to create & send an invoice,
// and a list of invoices that refreshes itself every 3 seconds. Plain HTML + a small script.
export function renderPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Oncade Invoice POC</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; margin: 0; background: #f6f7f9; color: #1d2433; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; background: #fff; border-bottom: 1px solid #e3e6eb; }
  h1 { font-size: 20px; margin: 0; }
  .mode { font-size: 13px; padding: 4px 10px; border-radius: 999px; background: #e8f5ec; color: #1f7a3d; font-weight: 600; }
  main { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
  section { background: #fff; border: 1px solid #e3e6eb; border-radius: 10px; padding: 20px; margin-bottom: 24px; }
  h2 { font-size: 14px; margin: 0 0 14px; text-transform: uppercase; letter-spacing: .04em; color: #5b6475; }
  h2 small { text-transform: none; letter-spacing: 0; font-weight: 400; }
  form { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; align-items: end; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #5b6475; }
  input { font: inherit; padding: 8px 10px; border: 1px solid #c9ced8; border-radius: 6px; }
  button { font: inherit; padding: 9px 14px; border: 0; border-radius: 6px; background: #2952cc; color: #fff; cursor: pointer; }
  button:disabled { opacity: .5; cursor: wait; }
  button.cancel { background: #fff; color: #b42318; border: 1px solid #f0b4ae; padding: 5px 10px; }
  #message { margin-top: 12px; font-size: 14px; min-height: 1.2em; }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  th { font-size: 12px; color: #5b6475; text-transform: uppercase; }
  .status { font-weight: 600; white-space: nowrap; }
  .Creating, .Cancelled { color: #6b7280; }
  .Cancelled { text-decoration: line-through; }
  .Sent { color: #2952cc; }
  .Paid { color: #1f7a3d; }
  .Failed { color: #b42318; }
  .error { color: #b42318; font-size: 12px; font-weight: 400; margin-top: 4px; max-width: 320px; white-space: normal; }
  .empty { color: #8a93a5; text-align: center; padding: 24px; }
</style>
</head>
<body>
<header><h1>Oncade Invoice POC</h1><span class="mode">Mode: TEST ✓</span></header>
<main>
  <section>
    <h2>New invoice</h2>
    <form id="new-invoice">
      <label>Customer name <input name="customerName" required></label>
      <label>Customer email <input name="customerEmail" type="email" required></label>
      <label>Description <input name="description" required></label>
      <label>Amount ($) <input name="amount" type="number" min="0.01" step="0.01" required></label>
      <button type="submit" id="create-button">Create &amp; Send</button>
    </form>
    <div id="message"></div>
  </section>
  <section>
    <h2>Invoices <small>(refreshes every 3 seconds)</small></h2>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Created</th><th>Customer</th><th>Description</th><th>Amount</th><th>Status</th><th>Pay link</th><th>Action</th></tr>
        </thead>
        <tbody id="rows"><tr><td colspan="7" class="empty">Loading…</td></tr></tbody>
      </table>
    </div>
  </section>
</main>
<script>
  const form = document.getElementById("new-invoice");
  const button = document.getElementById("create-button");
  const message = document.getElementById("message");
  const rows = document.getElementById("rows");

  // Make text safe to put inside the page.
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function statusLabel(invoice) {
    if (invoice.status === "Paid") return invoice.paid_how === "manual" ? "Paid (marked manually) ⚠️" : "Paid ✅";
    if (invoice.status === "Creating") return "Creating…";
    return invoice.status;
  }

  function renderRows(invoices) {
    if (invoices.length === 0) {
      rows.innerHTML = '<tr><td colspan="7" class="empty">No invoices yet. Create one above.</td></tr>';
      return;
    }
    rows.innerHTML = invoices.map(function (invoice) {
      const link = invoice.pay_link
        ? '<a href="' + escapeHtml(invoice.pay_link) + '" target="_blank" rel="noopener">open ↗</a>'
        : "";
      const action = invoice.status === "Sent"
        ? '<button class="cancel" data-id="' + escapeHtml(invoice.id) + '">Cancel</button>'
        : "";
      const error = invoice.status === "Failed" && invoice.error_message
        ? '<div class="error">' + escapeHtml(invoice.error_message) + "</div>"
        : "";
      return "<tr>" +
        "<td>" + escapeHtml(new Date(invoice.created_at).toLocaleString()) + "</td>" +
        "<td>" + escapeHtml(invoice.customer_name) + "<br><small>" + escapeHtml(invoice.customer_email) + "</small></td>" +
        "<td>" + escapeHtml(invoice.description) + "</td>" +
        "<td>$" + Number(invoice.amount).toFixed(2) + "</td>" +
        '<td class="status ' + escapeHtml(invoice.status) + '">' + escapeHtml(statusLabel(invoice)) + error + "</td>" +
        "<td>" + link + "</td>" +
        "<td>" + action + "</td>" +
        "</tr>";
    }).join("");
  }

  async function refresh() {
    try {
      const response = await fetch("/invoices");
      if (response.ok) renderRows(await response.json());
    } catch (err) {
      // The app may be restarting; the next refresh will try again.
    }
  }

  // Create & Send
  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    button.disabled = true;
    message.textContent = "Creating and sending…";
    try {
      const response = await fetch("/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const result = await response.json();
      if (!response.ok) {
        message.textContent = "⚠️ " + (result.error || "Something went wrong");
      } else if (result.status === "Failed") {
        message.textContent = "❌ Oncade refused the invoice. The reason is shown in the list.";
      } else {
        message.textContent = "✅ Invoice sent. Oncade will email the customer.";
        form.reset();
      }
    } catch (err) {
      message.textContent = "⚠️ Could not reach the app.";
    } finally {
      button.disabled = false;
      refresh();
    }
  });

  // Cancel buttons
  rows.addEventListener("click", async function (event) {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.id) return;
    if (!confirm("Cancel this invoice? The customer will no longer be able to pay it.")) return;
    target.disabled = true;
    try {
      const response = await fetch("/invoices/" + encodeURIComponent(target.dataset.id) + "/cancel", { method: "POST" });
      const result = await response.json();
      message.textContent = response.ok ? "Invoice cancelled." : "⚠️ " + (result.error || "Could not cancel");
    } catch (err) {
      message.textContent = "⚠️ Could not reach the app.";
    }
    refresh();
  });

  refresh();
  setInterval(refresh, 3000);
</script>
</body>
</html>`;
}