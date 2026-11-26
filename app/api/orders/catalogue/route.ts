import {
  requireApproved,
  portalOrigin,
  portalFailure,
  PortalError,
  privateHeaders,
} from "../../../../lib/portal/server";
import { uuid } from "../../../../lib/moneybird/server";
import { normalizeCustomerReference } from "../../../../lib/orders/reference.mjs";
import { dispatchOrderConfirmation } from "../../../../lib/mail/server";
const messages: Record<string, string> = {
  APPROVAL_REQUIRED: "Je account moet eerst worden goedgekeurd.",
  DRAWING_UNAVAILABLE: "Deze tekening is niet beschikbaar.",
  DOWNLOAD_NOT_ALLOWED:
    "Deze tekening is niet beschikbaar om te bestellen of te downloaden.",
  DOMESTIC_ONLY:
    "Downloads zijn uitsluitend beschikbaar voor Nederlandse klanten.",
  PRICE_UNAVAILABLE:
    "Voor dit gebruiksdoel is nog geen bedrijfstarief ingesteld.",
  PURPOSE_UNAVAILABLE: "Dit gebruiksdoel is niet beschikbaar.",
  QUOTE_CHANGED:
    "De prijs of afspraak is gewijzigd. Vernieuw de pagina en controleer opnieuw.",
  CONSENT_REQUIRED: "Bevestig eerst de akkoordverklaring.",
  CUSTOMER_REFERENCE_INVALID:
    "Gebruik maximaal 100 tekens zonder regeleinden voor je referentie.",
};
async function run(data: Record<string, unknown>, confirm: boolean) {
  try {
    const { client, user } = await requireApproved();
    if (!uuid(data.image_id) || !uuid(data.purpose_id))
      throw new PortalError("Kies een geldige tekening en gebruiksdoel.", 400);
    let reference = null;
    try {
      if (confirm)
        reference = normalizeCustomerReference(data.customer_reference);
    } catch {
      throw new PortalError(messages.CUSTOMER_REFERENCE_INVALID, 400);
    }
    if (
      confirm &&
      (data.accepted !== true ||
        !uuid(data.agreement_id) ||
        !Number.isSafeInteger(data.expected_amount_cents) ||
        Number(data.expected_amount_cents) < 0 ||
        Number(data.expected_amount_cents) > 2147483647 ||
        typeof data.expected_agreement_text !== "string" ||
        data.expected_agreement_text.length > 20000)
    )
      throw new PortalError(
        "Controleer de bestelling en bevestig de akkoordverklaring.",
        400,
      );
    const args = { p_image_id: data.image_id, p_purpose_id: data.purpose_id };
    const { data: quote, error } = confirm
      ? await client.rpc("place_catalogue_order", {
          ...args,
          p_agreement_id: data.agreement_id,
          p_expected_amount_cents: data.expected_amount_cents,
          p_expected_agreement_text: data.expected_agreement_text,
          p_accepted: true,
          p_customer_reference: reference,
        })
      : await client.rpc("catalogue_order_quote", args);
    if (error) {
      const code = Object.keys(messages).find((c) => error.message.includes(c));
      throw new PortalError(
        code
          ? messages[code]
          : "Bestellen is tijdelijk niet beschikbaar. Controleer bij een onzekere uitkomst eerst Mijn account.",
        code === "QUOTE_CHANGED"
          ? 409
          : code === "APPROVAL_REQUIRED" ||
              code === "DOWNLOAD_NOT_ALLOWED" ||
              code === "DOMESTIC_ONLY"
            ? 403
            : code
              ? 400
              : 503,
      );
    }
    let mailStatus = null;
    if (confirm && quote?.order_id)
      try {
        mailStatus = (await dispatchOrderConfirmation(user.id, quote.order_id))
          .status;
      } catch {
        mailStatus = "needs_check";
      }
    return Response.json(
      { ...quote, confirmation_mail_status: mailStatus },
      { headers: privateHeaders },
    );
  } catch (error) {
    return portalFailure(error);
  }
}
export async function GET(request: Request) {
  return run(Object.fromEntries(new URL(request.url).searchParams), false);
}
export async function POST(request: Request) {
  try {
    portalOrigin(request);
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new PortalError("Ongeldige aanvraag.", 400);
    return run(body, true);
  } catch (error) {
    return portalFailure(error);
  }
}
