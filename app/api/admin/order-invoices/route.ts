import { randomUUID } from "node:crypto";
import {
  moneybirdAdmin,
  originCheck,
  uuid,
  headers,
  fail,
  apiError,
} from "../../../../lib/moneybird/server";
import {
  connectedBilling,
  connectionConfig,
} from "../../../../lib/moneybird/connection";
import { serviceClient } from "../../../../lib/supabase/service";
import { invoiceRecipient } from "../../../../lib/moneybird/contacts.mjs";
import {
  buildOrderInvoicePlan,
  runOrderInvoice,
} from "../../../../lib/moneybird/order-invoices.mjs";
import { fingerprint } from "../../../../lib/moneybird/invoices.mjs";
export const runtime = "nodejs";
export const maxDuration = 60;
const messages: Record<string, string> = {
  ORDER_INVOICE_ADMIN_CHANGED:
    "De opgeslagen factuur hoort bij een andere Moneybird-administratie. Herstel de oorspronkelijke verbinding; er wordt niets opnieuw aangemaakt.",
  ORDER_INVOICE_DATABASE:
    "Facturatie is nog niet beschikbaar. Controleer SQL-script 020.",
  ORDER_INVOICE_REAL_ONLY:
    "Alleen echte catalogusbestellingen kunnen hier worden gefactureerd. Testbestellingen zijn uitgesloten.",
  ORDER_INVOICE_NOT_QUEUED:
    "Deze bestelling staat niet in de nieuwe facturatiewachtrij. Er worden geen oude bestellingen automatisch toegevoegd.",
  ORDER_INVOICE_NOT_PREPARED:
    "Controleer eerst de bestelling en maak bewust een concept aan.",
  ORDER_INVOICE_CONTACT:
    "Koppel dit bedrijf eerst aan het juiste contact in de ingestelde Moneybird-administratie.",
  ORDER_INVOICE_RECIPIENT:
    "Controleer het factuur-e-mailadres of de gekozen factuurcontactpersoon in Moneybird.",
  ORDER_INVOICE_BUSY:
    "Er loopt al een factuuractie. Wacht even en controleer daarna de status.",
  ORDER_INVOICE_PLAN_CHANGED:
    "De bestelling, bedrijfskoppeling of factuurinstellingen zijn gewijzigd. Controleer de bestelling opnieuw.",
  ORDER_INVOICE_MISMATCH:
    "De Moneybird-factuur wijkt af van de bestelling. Er wordt geen nieuwe factuur aangemaakt. Controleer het bestaande document.",
  ORDER_INVOICE_ALREADY_STARTED:
    "Er is al een aanmaakpoging of factuur vastgelegd. Controleer de status; er wordt niet opnieuw aangemaakt.",
  INVOICE_WRITE_UNCERTAIN:
    "De uitkomst is onzeker. Controleer de status en Moneybird. Een mogelijk geslaagde aanmaak wordt niet herhaald.",
  INVOICE_FIXED_SETTINGS:
    "Moneybird moet één actief Nederlands verkooptarief van 21% en omzetrekening Download (80300) bevatten.",
  INVOICE_DOMESTIC_ONLY:
    "Het factuurcontact moet een Nederlands factuuradres hebben (landcode NL).",
  INVOICE_CONTACT:
    "Controleer het gekoppelde KvK-nummer en het volledige factuuradres in Moneybird.",
  INVOICE_MISSING:
    "De vastgelegde factuur ontbreekt in Moneybird. Er wordt geen vervangende factuur aangemaakt.",
  INVOICE_REFERENCE_AMBIGUOUS:
    "Er zijn meerdere mogelijke facturen gevonden. Controleer Moneybird handmatig; er wordt geen extra concept gemaakt.",
  INVOICE_SEARCH_INCOMPLETE:
    "De controle op bestaande facturen kon niet volledig worden uitgevoerd. Er is niets aangemaakt.",
  INVOICE_PROVIDER_REJECTED:
    "Moneybird heeft de aanmaak geweigerd. Controleer de instellingen en de bestelling voordat je opnieuw probeert.",
  INVOICE_PLAN:
    "De factuurgegevens zijn ongeldig. Controleer de bestelling opnieuw.",
  CONNECTION_REQUIRED:
    "Verbind Moneybird opnieuw voordat je een concept aanmaakt.",
};
function responseError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  return code in messages
    ? Response.json(
        { error: messages[code], code },
        { status: code === "ORDER_INVOICE_DATABASE" ? 503 : 409, headers },
      )
    : apiError(error);
}
async function action(
  actor: string,
  mode: string,
  order: string | null = null,
  owner: string | null = null,
  data: Record<string, unknown> = {},
) {
  const { data: result, error } = await serviceClient().rpc(
    "server_order_invoices",
    {
      p_actor_id: actor,
      p_action: mode,
      p_order_id: order,
      p_owner: owner,
      p_data: data,
    },
  );
  if (error) {
    if (error.message.includes("ADMIN_REQUIRED"))
      throw Error("MONEYBIRD_ADMIN_CHANGED");
    throw Error(
      Object.keys(messages).find((k) => error.message.includes(k)) ||
        "ORDER_INVOICE_DATABASE",
    );
  }
  return result;
}
async function freshPlan(source: any, actor: string) {
  if (
    !source?.link ||
    source.link.administration_id !== connectionConfig().administrationId
  )
    throw Error("ORDER_INVOICE_CONTACT");
  const billing = await connectedBilling(actor);
  const [contact, options] = await Promise.all([
    billing.contacts.contact(source.link.contact_id),
    billing.invoices.options(),
  ]);
  return {
    plan: buildOrderInvoicePlan(
      source,
      contact,
      invoiceRecipient(contact, source.link.recipient_snapshot?.id || null),
      options,
    ),
    client: billing.invoices,
  };
}
export async function GET(request: Request) {
  try {
    const { user } = await moneybirdAdmin(),
      url = new URL(request.url),
      order = url.searchParams.get("order_id");
    if (order) {
      if (!uuid(order)) return fail("Kies een geldige bestelling.", 400);
      const detail = await action(user.id, "detail", order);
      if (url.searchParams.get("mode") === "quote") {
        if (
          detail.job.invoice_id ||
          !["queued", "prepared", "create_rejected"].includes(detail.job.status)
        )
          return fail("Controleer eerst de bestaande factuurstatus.", 409);
        const { plan } = await freshPlan(detail.source, user.id);
        return Response.json(
          { plan, plan_hash: fingerprint(plan) },
          { headers },
        );
      }
      return Response.json(detail, { headers });
    }
    const page = Number(url.searchParams.get("page") || 1),
      status = url.searchParams.get("status") || "all";
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 10000 ||
      !["all", "queued", "draft", "issued", "attention"].includes(status)
    )
      return fail("Ongeldige pagina of status.", 400);
    return Response.json(
      await action(user.id, "overview", null, null, { page, status }),
      { headers },
    );
  } catch (error) {
    return responseError(error);
  }
}
export async function POST(request: Request) {
  try {
    originCheck(request);
    const { user } = await moneybirdAdmin();
    let body;
    try {
      body = await request.json();
    } catch {
      return fail("Ongeldige aanvraag.", 400);
    }
    if (
      !uuid(body?.order_id) ||
      !["create", "check"].includes(body.action) ||
      body.confirmed !== true
    )
      return fail("Kies een bestelling en bevestig de conceptactie.", 400);
    const detail = await action(user.id, "detail", body.order_id);
    if (
      detail.job.administration_id &&
      detail.job.administration_id !== connectionConfig().administrationId
    )
      throw Error("ORDER_INVOICE_ADMIN_CHANGED");
    let plan = null,
      client;
    if (
      body.action === "create" &&
      !detail.job.invoice_id &&
      ["queued", "prepared", "create_rejected"].includes(detail.job.status)
    ) {
      if (
        typeof body.plan_hash !== "string" ||
        !/^[a-f0-9]{64}$/.test(body.plan_hash)
      )
        return fail("Controleer eerst het factuurvoorstel.", 400);
      const fresh = await freshPlan(detail.source, user.id);
      plan = fresh.plan;
      client = fresh.client;
      if (fingerprint(plan) !== body.plan_hash)
        throw Error("ORDER_INVOICE_PLAN_CHANGED");
    } else client = (await connectedBilling(user.id)).invoices;
    const owner = randomUUID(),
      repository = (mode: string, data: Record<string, unknown> = {}) =>
        action(user.id, mode, body.order_id, owner, data);
    const job = await runOrderInvoice({
      intent: body.action,
      repository,
      client,
      plan,
    });
    return Response.json({ job }, { headers });
  } catch (error) {
    return responseError(error);
  }
}
