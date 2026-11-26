import {
  requireApproved,
  portalOrigin,
  PortalError,
  privateHeaders,
} from "../../../../lib/portal/server";
import { uuid } from "../../../../lib/moneybird/server";
import { serviceClient } from "../../../../lib/supabase/service";
import { currentConnection } from "../../../../lib/onedrive/server";
import { catalogueDelivery } from "../../../../lib/onedrive/catalogue-delivery.mjs";
export const runtime = "nodejs";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function POST(request: Request) {
  try {
    portalOrigin(request);
    const { user } = await requireApproved();
    if (Number(request.headers.get("content-length")) > 2048)
      throw new PortalError("Ongeldige aanvraag.", 400);
    const body = await request.formData(),
      image = body.get("image_id"),
      purpose = body.get("purpose_id");
    if (!uuid(image) || !uuid(purpose))
      throw new PortalError("Kies een geldige tekening en gebruiksdoel.", 400);
    const service = serviceClient(),
      args = { p_user_id: user.id, p_image_id: image, p_purpose_id: purpose };
    const { data: right, error } = await service.rpc(
      "server_catalogue_download",
      args,
    );
    if (error && !error.message.includes("DOWNLOAD_RIGHT_REQUIRED"))
      throw new PortalError(
        "De downloadservice is tijdelijk niet beschikbaar. Probeer later opnieuw.",
        503,
      );
    if (error || !right)
      throw new PortalError(
        "Voor deze tekening en dit gebruiksdoel is geen beschikbaar gebruiksrecht gevonden. Controleer Mijn account.",
        403,
      );
    const { tokens, metadata } = await currentConnection(service, true);
    const delivery = await catalogueDelivery(
      tokens.accessToken,
      metadata.driveId,
      right.source_path,
    );
    const { error: recordError } = await service.rpc(
      "server_catalogue_download",
      {
        ...args,
        p_order_item_id: right.order_item_id,
        p_byte_count: delivery.size,
      },
    );
    if (recordError)
      throw new PortalError(
        "Je downloadrecht kon niet opnieuw worden bevestigd. Probeer vanuit Mijn account opnieuw.",
        403,
      );
    // Browser streams the original from Microsoft's temporary delivery endpoint, avoiding Netlify payload limits.
    // Never store or log the URL. OAuth credentials and source paths stay server-side.
    return new Response(null, {
      status: 303,
      headers: {
        ...privateHeaders,
        Location: delivery.location,
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    const message =
      error instanceof PortalError
        ? error.message
        : error instanceof Error && error.message === "DOWNLOAD_SOURCE_MISSING"
          ? "Het originele bestand is niet gevonden. Neem contact op met de beheerder."
          : "Het originele bestand kon tijdelijk niet worden aangeboden. Probeer later opnieuw of neem contact op met de beheerder.";
    return new Response(
      `<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Download · Beeldrechtbank</title><body style="font-family:system-ui;max-width:600px;margin:10vh auto;padding:24px"><h1>Download niet gestart</h1><p>${escape(message)}</p><p><a href="/#account">Terug naar Mijn account</a></p></body></html>`,
      {
        status: error instanceof PortalError ? error.status : 503,
        headers: {
          ...privateHeaders,
          "Content-Type": "text/html; charset=utf-8",
        },
      },
    );
  }
}
