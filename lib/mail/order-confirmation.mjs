export const orderSender = {
  name: "Beeldrechtbank",
  address: "info@beeldrechtbank.nl",
};
export const orderCopy = "rechtbanktekeningen@nicolevandenhout.nl";
const emailPattern = /^[^\s@<>;,\r\n]+@[^\s@<>;,\r\n]+\.[^\s@<>;,\r\n]+$/;
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (value) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
    value / 100,
  );
export function mailConfiguration(env = process.env) {
  if (
    env.SMTP_HOST !== "rootnet.email" ||
    !["587", "465"].includes(env.SMTP_PORT || "") ||
    env.SMTP_USER !== orderSender.address ||
    !env.SMTP_PASSWORD
  )
    throw Error("ORDER_SMTP_CONFIG");
  return {
    host: env.SMTP_HOST,
    port: Number(env.SMTP_PORT),
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
  };
}
export function orderConfirmation(
  payload,
  {
    appUrl = "https://eclectic-bublanina-b08cc8.netlify.app",
    test = false,
    to = payload.recipient,
    messageKey = payload.order_id,
  } = {},
) {
  if (
    !emailPattern.test(to || "") ||
    typeof messageKey !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(messageKey)
  )
    throw Error("ORDER_MAIL_PAYLOAD");
  const origin = new URL(appUrl);
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw Error("ORDER_MAIL_CONFIG");
  if (
    !Number.isSafeInteger(payload.order_number) ||
    payload.order_number < 1 ||
    !Array.isArray(payload.items) ||
    !payload.items.length ||
    payload.items.length > 100
  )
    throw Error("ORDER_MAIL_PAYLOAD");
  let amount = 0,
    vat = 0,
    total = 0;
  for (const item of payload.items) {
    const a = Number(item.amount_cents),
      v = Number(item.vat_cents),
      t = Number(item.total_cents);
    if (
      ![a, v, t].every(Number.isSafeInteger) ||
      a < 0 ||
      item.currency !== "EUR" ||
      item.vat_percent !== 21 ||
      v !== Math.floor((a * 21 + 50) / 100) ||
      t !== a + v
    )
      throw Error("ORDER_MAIL_PAYLOAD");
    amount += a;
    vat += v;
    total += t;
  }
  if (![amount, vat, total].every(Number.isSafeInteger))
    throw Error("ORDER_MAIL_PAYLOAD");
  const heading = test
    ? "Testmail: bestelbevestiging"
    : `${payload.is_test ? "Testbestelling" : "Bestelling"} ${payload.order_number} bevestigd`;
  const intro = test
    ? "Dit is een verbindingsproef. Er is hiervoor geen bestelling of factuur aangemaakt."
    : `Bedankt voor je bestelling namens ${payload.company_name}. Je bestelling is vastgelegd.`;
  const lines = payload.items.map(
    (i) =>
      `${i.drawing_title_snapshot} — ${i.purpose_name_snapshot}\n${money(Number(i.amount_cents))} exclusief btw · ${money(Number(i.vat_cents))} btw · ${money(Number(i.total_cents))} inclusief btw`,
  );
  const notice = payload.is_test
    ? "Dit is een testbestelling. Er wordt niet automatisch een factuur verstuurd. Een eventuele factuurproef wordt afzonderlijk bevestigd."
    : "De factuur wordt afzonderlijk vanuit Moneybird verstuurd.";
  const account = origin.origin + "/#account";
  return {
    keepBcc: false,
    from: orderSender,
    to,
    bcc: orderCopy,
    replyTo: orderCopy,
    envelope: {
      from: orderSender.address,
      to: [...new Set([to.toLowerCase(), orderCopy])],
    },
    messageId: `<${test ? "test" : "order"}-${messageKey}@beeldrechtbank.nl>`,
    subject: `Beeldrechtbank — ${heading}`,
    text: [
      heading,
      "",
      `Beste ${payload.customer_name || "klant"},`,
      "",
      intro,
      `Bestelnummer: ${payload.order_number}`,
      `Bedrijf: ${payload.company_name}`,
      payload.customer_reference
        ? `Jouw referentie / PO-nummer: ${payload.customer_reference}`
        : "",
      "",
      ...lines,
      "",
      `Exclusief btw: ${money(amount)}`,
      `Btw (21%): ${money(vat)}`,
      `Totaal inclusief btw: ${money(total)}`,
      "",
      notice,
      "Je bestaande gebruiksrecht blijft geldig bij opnieuw downloaden. Er ontstaat daardoor geen nieuwe bestelling.",
      `Je bestellingen bekijken: ${account}`,
      "",
      "Met vriendelijke groet,",
      "Beeldrechtbank — Nicole van den Hout",
    ]
      .filter((v) => v !== undefined)
      .join("\n"),
    html: `<!doctype html><html lang="nl"><body style="font-family:Arial,sans-serif;color:#202520;line-height:1.6"><div style="max-width:640px;margin:auto;padding:24px"><h1 style="font-size:24px">${escape(heading)}</h1><p>Beste ${escape(payload.customer_name || "klant")},</p><p>${escape(intro)}</p><p>Bestelnummer: <strong>${payload.order_number}</strong><br>Bedrijf: ${escape(payload.company_name)}${payload.customer_reference ? `<br>Jouw referentie / PO-nummer: <strong>${escape(payload.customer_reference)}</strong>` : ""}</p>${payload.items.map((i) => `<div style="border-top:1px solid #ddd;padding:16px 0"><strong>${escape(i.drawing_title_snapshot)}</strong><br>${escape(i.purpose_name_snapshot)} · Herhaald gebruik door hetzelfde bedrijf<br>${escape(money(Number(i.amount_cents)))} exclusief btw · ${escape(money(Number(i.total_cents)))} inclusief btw</div>`).join("")}<p>Exclusief btw: ${escape(money(amount))}<br>Btw (21%): ${escape(money(vat))}<br><strong>Totaal inclusief btw: ${escape(money(total))}</strong></p><p>${escape(notice)}</p><p>Je bestaande gebruiksrecht blijft geldig bij opnieuw downloaden. Er ontstaat daardoor geen nieuwe bestelling.</p><p><a href="${escape(account)}">Bekijk je bestellingen in Mijn account</a></p><p>Met vriendelijke groet,<br>Beeldrechtbank — Nicole van den Hout</p></div></body></html>`,
  };
}
export function demoOrder(recipient) {
  return {
    order_id: "00000000-0000-4000-8000-000000000001",
    order_number: 1,
    recipient,
    company_name: "Voorbeeldbedrijf",
    customer_name: "Testontvanger",
    customer_reference: "PO-VOORBEELD-001",
    is_test: true,
    items: [
      {
        drawing_title_snapshot: "Voorbeeldtekening",
        purpose_name_snapshot: "Online",
        amount_cents: 10000,
        vat_cents: 2100,
        total_cents: 12100,
        vat_percent: 21,
        currency: "EUR",
      },
    ],
  };
}
export function smtpFailure(error) {
  const code = error?.code,
    command = String(error?.command || "").toUpperCase(),
    status = error?.responseCode;
  const rejected = Number.isInteger(status) && status >= 400 && status < 600;
  const beforeData = [
    "CONN",
    "EHLO",
    "HELO",
    "STARTTLS",
    "AUTH",
    "AUTH PLAIN",
    "AUTH LOGIN",
    "MAIL FROM",
    "RCPT TO",
  ].includes(command);
  const definite =
    rejected ||
    code === "EDNS" ||
    code === "EAUTH" ||
    code === "EENVELOPE" ||
    beforeData;
  return {
    status: definite ? "failed" : "uncertain",
    error_code:
      code === "EAUTH"
        ? "SMTP_AUTH"
        : rejected
          ? "SMTP_REJECTED"
          : definite
            ? "SMTP_UNAVAILABLE"
            : "SMTP_RESULT_UNCERTAIN",
  };
}
export async function deliverOrder(mail, send) {
  try {
    const result = await send(mail),
      accepted = Array.isArray(result?.accepted)
        ? result.accepted.map((a) =>
            (typeof a === "string" ? a : a?.address || "").toLowerCase(),
          )
        : [];
    const wanted = mail.envelope.to;
    return {
      status: wanted.every((a) => accepted.includes(a))
        ? "accepted"
        : "partial",
      error_code: wanted.every((a) => accepted.includes(a))
        ? null
        : "SMTP_PARTIAL",
      accepted: accepted.filter((a) => wanted.includes(a)),
    };
  } catch (error) {
    return { ...smtpFailure(error), accepted: [] };
  }
}
