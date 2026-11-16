"use client";
import { useEffect, useState } from "react";
import { readApiResponse } from "../lib/http/api-response.mjs";
type Job = {
  order_id: string;
  order_number: number;
  company_name_snapshot: string;
  recipient: string;
  status: string;
  last_error: string | null;
};
type MailState = {
  settings: { auto_enabled: boolean; last_test_accepted_at: string | null };
  sending_enabled: boolean;
  configured: boolean;
  from: string;
  bcc: string;
  reply_to: string;
  preview: { subject: string; text: string };
  jobs: Job[];
  tests: {
    id: string;
    recipient: string;
    status: string;
    last_error: string | null;
  }[];
};
async function request(options: RequestInit = {}) {
  const r = await fetch("/api/admin/order-mail", {
    ...options,
    cache: "no-store",
  });
  const d = await readApiResponse(r, { mutation: options.method === "POST" });
  if (!r.ok) throw Error(d.error || "Het mailbeheer kon niet worden geladen.");
  return d;
}
const labels: Record<string, string> = {
  pending: "Wacht op verwerking",
  sending: "Uitkomst controleren; niet blind opnieuw versturen",
  accepted: "Door de mailserver geaccepteerd",
  partial: "Niet alle ontvangers geaccepteerd; handmatig controleren",
  failed: "Niet verzonden; oorzaak controleren",
  uncertain: "Uitkomst onzeker; controleer mailbox en Rootnet-logs",
  disabled: "Verzenden uitgeschakeld",
  not_queued: "Geen bevestiging ingepland voor deze bestelling",
};
export function OrderMailAdmin() {
  const [data, setData] = useState<MailState | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0),
    [testAck, setTestAck] = useState(false),
    [received, setReceived] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    request({ signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [reload]);
  async function action(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await request({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, confirmed: true }),
      });
      setMessage(
        result.status
          ? labels[result.status] || "Status bijgewerkt."
          : result.auto_enabled
            ? "Bestelbevestigingen zijn actief voor nieuwe bestellingen."
            : "Automatische bestelbevestigingen zijn gepauzeerd.",
      );
      if (
        body.action === "test" &&
        ["accepted", "partial", "failed"].includes(result.status)
      )
        sessionStorage.removeItem("br_order_mail_test");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "De mailactie kon niet worden bevestigd.",
      );
    } finally {
      setBusy(false);
      setTestAck(false);
      setReload((n) => n + 1);
    }
  }
  function test() {
    let id = sessionStorage.getItem("br_order_mail_test");
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem("br_order_mail_test", id);
    }
    void action({ action: "test", request_id: id });
  }
  return (
    <section className="pagehead">
      <a className="back" href="#account">
        ← Terug naar mijn account
      </a>
      <div className="eyebrow" style={{ marginTop: 25 }}>
        Beheer · E-mail
      </div>
      <h2>Bestelbevestigingen</h2>
      <p>
        Een bevestiging naar de klant en een BCC-kopie naar Nicole. Facturen
        blijven vanuit Moneybird komen. Opnieuw downloaden maakt geen nieuwe
        bestelmail.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && (
        <p role="status" className="status">
          {message}
        </p>
      )}
      <button
        className="secondary"
        disabled={busy}
        onClick={() => {
          setError("");
          setReload((n) => n + 1);
        }}
      >
        Overzicht vernieuwen
      </button>
      {!data && !error && <p>Mailbeheer laden…</p>}
      {data && (
        <>
          <div className="panel moneybird-mapping">
            <h3>Afzender en instellingen</h3>
            <p>
              Van: {data.from}
              <br />
              Antwoorden naar: {data.reply_to}
              <br />
              BCC-kopie: {data.bcc}
            </p>
            <p className="status">
              {!data.sending_enabled
                ? "Verzenden staat uit. De inhoud kan al worden gecontroleerd."
                : !data.configured
                  ? "De SMTP-instellingen zijn nog niet volledig ingevuld."
                  : data.settings.auto_enabled
                    ? "Automatische bestelbevestigingen zijn actief."
                    : "SMTP is ingesteld. Automatische bestelbevestigingen zijn nog niet geactiveerd."}
            </p>
            <details>
              <summary>Voorbeeld van de bestelbevestiging</summary>
              <h4>{data.preview.subject}</h4>
              <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>
                {data.preview.text}
              </pre>
            </details>
          </div>
          <div className="panel moneybird-mapping">
            <h3>Eerst één testmail</h3>
            <p>
              Deze test gaat naar het e-mailadres van jouw beheeraccount, met
              Nicole in BCC. Er ontstaat geen bestelling of factuur.
            </p>
            <label className="consent">
              <input
                type="checkbox"
                checked={testAck}
                disabled={busy || !data.sending_enabled || !data.configured}
                onChange={(e) => setTestAck(e.target.checked)}
              />
              <span>
                Rootnet heeft de mailbox/DNS bevestigd. Verstuur één testmail
                naar mij en een controlekopie naar Nicole.
              </span>
            </label>
            <button
              className="primary"
              disabled={busy || !testAck}
              onClick={test}
            >
              Testmail naar mij en Nicole versturen
            </button>
            <p className="tiny muted">
              Acceptatie door de mailserver is geen bewijs van aflevering.
              Controleer beide mailboxen en eventueel spam.
            </p>
            {data.tests.map((t) => (
              <p key={t.id}>
                {t.recipient} · {labels[t.status] || t.status}
                {t.last_error ? " · " + t.last_error : ""}
              </p>
            ))}
          </div>
          <div className="panel moneybird-mapping">
            <h3>Activeren voor nieuwe bestellingen</h3>
            {data.settings.auto_enabled ? (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => action({ action: "enable", enabled: false })}
              >
                Automatische bestelbevestigingen pauzeren
              </button>
            ) : (
              <>
                <label className="consent">
                  <input
                    type="checkbox"
                    checked={received}
                    disabled={
                      busy ||
                      !data.sending_enabled ||
                      !data.configured ||
                      !data.settings.last_test_accepted_at
                    }
                    onChange={(e) => setReceived(e.target.checked)}
                  />
                  <span>
                    Ik heb de testmail ontvangen en Nicole heeft de BCC-kopie
                    ontvangen. Activeer bevestigingen voor nieuwe bestellingen.
                  </span>
                </label>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !received ||
                    !data.sending_enabled ||
                    !data.configured
                  }
                  onClick={() =>
                    action({
                      action: "enable",
                      enabled: true,
                      confirmed_received: received,
                    })
                  }
                >
                  Bestelbevestigingen activeren
                </button>
              </>
            )}
            <p className="tiny muted">
              Eerdere bestellingen krijgen niet met terugwerkende kracht een
              mail.
            </p>
          </div>
          <div className="panel moneybird-mapping">
            <h3>Recente bestelbevestigingen</h3>
            {!data.jobs.length && (
              <p>Er zijn nog geen bestelmails ingepland.</p>
            )}
            {data.jobs.map((j) => (
              <article className="history-order" key={j.order_id}>
                <strong>
                  Bestelling {j.order_number} · {j.company_name_snapshot}
                </strong>
                <p>
                  {j.recipient}
                  <br />
                  {labels[j.status] || j.status}
                  {j.last_error ? " · " + j.last_error : ""}
                </p>
                {["pending", "failed"].includes(j.status) && (
                  <button
                    className="secondary"
                    disabled={
                      busy ||
                      !data.settings.auto_enabled ||
                      !data.sending_enabled ||
                      !data.configured
                    }
                    onClick={() =>
                      action({ action: "retry", order_id: j.order_id })
                    }
                  >
                    {j.status === "pending"
                      ? "Bevestiging verwerken"
                      : "Na controle opnieuw proberen"}
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
