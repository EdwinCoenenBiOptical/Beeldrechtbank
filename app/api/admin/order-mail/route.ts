import {
  moneybirdAdmin,
  originCheck,
  apiError,
  headers,
  fail,
  uuid,
} from "../../../../lib/moneybird/server";
import {
  mailAction,
  sendingEnabled,
  orderMailConfig,
  sendOrderMailTest,
  dispatchOrderConfirmation,
} from "../../../../lib/mail/server";
import {
  orderConfirmation,
  demoOrder,
  orderSender,
  orderCopy,
} from "../../../../lib/mail/order-confirmation.mjs";
function mailError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    ORDER_MAIL_DISABLED:
      "Verzenden staat uit. Wacht op de bevestiging van Rootnet en configureer daarna de SMTP-instellingen.",
    ORDER_SMTP_CONFIG:
      "De Rootnet SMTP-instellingen zijn nog niet volledig ingesteld.",
    ORDER_MAIL_TEST_REQUIRED:
      "Verstuur eerst een geslaagde testmail en bevestig de ontvangst bij jou en Nicole.",
    ORDER_MAIL_DATABASE:
      "Het mailbeheer is nog niet beschikbaar. Controleer SQL-script 016.",
  };
  return code in messages ? fail(messages[code], 503) : apiError(error);
}
export async function GET() {
  try {
    const { user } = await moneybirdAdmin();
    const state = await mailAction(user.id, "status");
    let configured = false;
    try {
      orderMailConfig();
      configured = true;
    } catch {}
    const preview = orderConfirmation(demoOrder(user.email), {
      appUrl: process.env.APP_URL,
      test: true,
      to: user.email,
    });
    return Response.json(
      {
        ...state,
        sending_enabled: sendingEnabled(),
        configured,
        from: orderSender.address,
        bcc: orderCopy,
        reply_to: orderCopy,
        preview: { subject: preview.subject, text: preview.text },
      },
      { headers },
    );
  } catch (error) {
    return mailError(error);
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
      body?.confirmed !== true ||
      !["test", "enable", "retry"].includes(body.action)
    )
      return fail("Bevestig de mailactie.", 400);
    if (body.action === "test") {
      if (!uuid(body.request_id)) return fail("Ongeldige testaanvraag.", 400);
      return Response.json(await sendOrderMailTest(user.id, body.request_id), {
        headers,
      });
    }
    if (body.action === "enable") {
      if (typeof body.enabled !== "boolean")
        return fail("Kies activeren of pauzeren.", 400);
      if (body.enabled) {
        if (!sendingEnabled()) throw Error("ORDER_MAIL_DISABLED");
        orderMailConfig();
        if (body.confirmed_received !== true)
          return fail(
            "Bevestig eerst de ontvangst van de testmail bij jou en Nicole.",
            400,
          );
      }
      return Response.json(
        await mailAction(user.id, "enable", {
          enabled: body.enabled,
          confirmed_received: body.confirmed_received === true,
        }),
        { headers },
      );
    }
    if (!uuid(body.order_id)) return fail("Kies een geldige bestelling.", 400);
    return Response.json(
      await dispatchOrderConfirmation(user.id, body.order_id),
      { headers },
    );
  } catch (error) {
    return mailError(error);
  }
}
