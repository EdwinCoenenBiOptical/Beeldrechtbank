import { normalizeCustomerReference } from "../orders/reference.mjs";
import { MoneybirdError, moneybirdId } from "./contacts.mjs";
import {
  fixedInvoiceSettings,
  fingerprint,
  validateInvoice,
  issuedInvoice,
  InvoiceWriteError,
} from "./invoices.mjs";
export function buildOrderInvoicePlan(source, contact, recipient, options) {
  if (
    !source?.order ||
    source.order.is_test !== false ||
    !source.link ||
    !source.company
  )
    throw new MoneybirdError("ORDER_INVOICE_REAL_ONLY");
  const { tax, ledger } = fixedInvoiceSettings(options);
  if (contact.country !== "NL")
    throw new MoneybirdError("INVOICE_DOMESTIC_ONLY");
  if (
    contact.id !== source.link.contact_id ||
    contact.kvk.replace(/\D/g, "") !== source.company.kvk_number ||
    !contact.address1 ||
    !contact.zipcode ||
    !contact.city
  )
    throw new MoneybirdError("INVOICE_CONTACT");
  const email = (recipient.email || "").trim().toLowerCase();
  if (
    !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email) ||
    (recipient.id !== null && !moneybirdId(recipient.id))
  )
    throw new MoneybirdError("ORDER_INVOICE_RECIPIENT");
  if (
    !Array.isArray(source.items) ||
    !source.items.length ||
    source.items.length > 25 ||
    !Number.isSafeInteger(source.order.order_number)
  )
    throw new MoneybirdError("INVOICE_PLAN");
  let amount = 0,
    vat = 0,
    total = 0;
  const marker = `Beeldrechtbank bestelling ${source.order.order_number} - `;
  const items = source.items.map((i) => {
    const a = Number(i.amount_cents),
      v = Number(i.vat_cents),
      t = Number(i.total_cents);
    if (
      ![a, v, t].every(Number.isSafeInteger) ||
      a < 0 ||
      i.vat_percent !== 21 ||
      i.currency !== "EUR" ||
      v !== Math.floor((a * 21 + 50) / 100) ||
      t !== a + v
    )
      throw new MoneybirdError("INVOICE_PLAN");
    amount += a;
    vat += v;
    total += t;
    return {
      description: `${marker}${i.drawing_title_snapshot} (${i.purpose_name_snapshot})${i.image_key ? " · " + i.image_key : ""}`,
      amount_cents: a,
    };
  });
  if (![amount, vat, total].every(Number.isSafeInteger) || total <= 0)
    throw new MoneybirdError("INVOICE_PLAN");
  const reference = normalizeCustomerReference(source.order.customer_reference);
  return {
    order_id: source.order.id,
    order_number: source.order.order_number,
    company_id: source.company.id,
    company_name: source.order.company_name_snapshot,
    company_kvk: source.company.kvk_number,
    administration_id: source.link.administration_id,
    contact_id: contact.id,
    contact_person_id: recipient.id,
    recipient_email: email,
    recipient_name: recipient.name,
    contact_name: contact.name,
    contact_address: contact.address,
    link_revision: source.link.revision,
    reference:
      reference || `Beeldrechtbank bestelling ${source.order.order_number}`,
    customer_reference: reference,
    internal_reference: "BRB-BESTELLING-" + source.order.id,
    order_marker: marker,
    tax_rate_id: tax.id,
    tax_rate_name: tax.name,
    ledger_account_id: ledger.id,
    ledger_account_name: ledger.name,
    ledger_account_code: "80300",
    items,
    amount_cents: amount,
    vat_cents: vat,
    total_cents: total,
    currency: "EUR",
  };
}
async function inspect(repository, client, job) {
  let invoice;
  try {
    invoice = await client.get(job.invoice_id);
  } catch (error) {
    if (error instanceof Error && error.message === "INVOICE_MISSING")
      await repository("missing");
    throw error;
  }
  let valid = true;
  try {
    validateInvoice(invoice, job.request_snapshot);
    if (invoice.state !== "draft" && !issuedInvoice(invoice)) valid = false;
  } catch {
    valid = false;
  }
  const checked = await repository("verified", {
    invoice,
    valid,
    issued: issuedInvoice(invoice),
    review_hash: fingerprint(invoice),
  });
  if (!valid) throw new MoneybirdError("ORDER_INVOICE_MISMATCH");
  return checked;
}
/** One draft per queued real order. This orchestrator has no send operation. */
/** @param {{intent:string,repository:Function,client:any,plan?:any}} options */
export async function runOrderInvoice({
  intent,
  repository,
  client,
  plan = null,
}) {
  if (!["create", "check"].includes(intent))
    throw new MoneybirdError("ORDER_INVOICE_INVALID");
  const lease = await repository("reserve", { intent, plan });
  if (!lease.acquired) throw new MoneybirdError("ORDER_INVOICE_BUSY");
  let job = lease.job;
  try {
    if (!job.invoice_id) {
      const existing = await client.findForPlan(job.request_snapshot);
      if (existing) job = await repository("record", { invoice_id: existing });
      else if (
        intent === "create" &&
        ["prepared", "create_rejected"].includes(job.status)
      ) {
        await repository("creating");
        let id;
        try {
          id = await client.create(job.request_snapshot);
        } catch (error) {
          await repository(
            error instanceof InvoiceWriteError && !error.uncertain
              ? "rejected"
              : "uncertain",
            {
              error:
                error instanceof Error && /^[A-Z_]+$/.test(error.message)
                  ? error.message
                  : "INVOICE_WRITE_UNCERTAIN",
            },
          );
          throw error;
        }
        job = await repository("record", { invoice_id: id });
      } else {
        await repository("unresolved");
        throw new MoneybirdError("INVOICE_WRITE_UNCERTAIN");
      }
    }
    return await inspect(repository, client, job);
  } finally {
    await repository("release").catch(() => {});
  }
}
