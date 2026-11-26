"use client";
import { CatalogueDownloadButton } from "./CatalogueDownloadButton";
import { readApiResponse } from "../lib/http/api-response.mjs";
import { TestDownloadButton } from "./TestDownloadButton";
import { useEffect, useState } from "react";
type Quote = {
  can_download?: boolean;
  image_id?: string;
  confirmation_mail_status?: string | null;
  customer_reference?: string | null;
  can_test_download?: boolean;
  owned: boolean;
  is_test: boolean;
  company_name: string;
  drawing_title: string;
  purpose_name: string;
  amount_cents: number;
  vat_percent: number;
  vat_cents: number;
  total_cents: number;
  currency: string;
  agreement_id: string;
  agreement_text: string;
  order_number?: number;
};
const money = (n: number) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
    n / 100,
  );
export function PurchasePanel({
  drawingKey,
  purposeId,
}: {
  drawingKey: string;
  purposeId: string;
}) {
  const catalogue = /^[0-9a-f-]{36}$/i.test(drawingKey),
    endpoint = catalogue ? "/api/orders/catalogue" : "/api/orders",
    identity: Record<string, string> = catalogue
      ? { image_id: drawingKey }
      : { drawing_key: drawingKey };
  const [quote, setQuote] = useState<Quote | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [accepted, setAccepted] = useState(false),
    [reference, setReference] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      endpoint +
        "?" +
        new URLSearchParams({ ...identity, purpose_id: purposeId }),
      { cache: "no-store", signal: controller.signal },
    )
      .then(async (r) => {
        const data = await readApiResponse(r);
        if (!r.ok) throw Error(data.error);
        if (!controller.signal.aborted) setQuote(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [drawingKey, purposeId]);
  async function confirm() {
    if (!quote || !accepted || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...identity,
          purpose_id: purposeId,
          agreement_id: quote.agreement_id,
          expected_amount_cents: quote.amount_cents,
          expected_agreement_text: quote.agreement_text,
          accepted: true,
          customer_reference: reference,
        }),
      });
      const result = await readApiResponse(response, { mutation: true });
      if (!response.ok) throw Error(result.error);
      setQuote(result);
      setAccepted(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "De bestelling is niet bevestigd. Controleer eerst Mijn account voordat je opnieuw probeert.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="purchase-panel">
      {error && <p role="alert">{error}</p>}
      {!quote && !error && <p role="status">Bestelgegevens laden…</p>}
      {quote &&
        (quote.owned ? (
          <div className="status" role="status">
            <strong>
              {quote.is_test ? "Testbestelling" : "Bestelling"}{" "}
              {quote.order_number} vastgelegd
            </strong>
            <p>
              {quote.drawing_title} · {quote.purpose_name} ·{" "}
              {quote.company_name}
            </p>
            <p>
              {money(quote.amount_cents)} + {money(quote.vat_cents)} btw ={" "}
              {money(quote.total_cents)}
            </p>
            {quote.confirmation_mail_status === "accepted" && (
              <p>
                De bestelbevestiging is aangeboden aan de mailserver. Controleer
                je mailbox en eventueel spam.
              </p>
            )}
            {quote.confirmation_mail_status &&
              [
                "failed",
                "partial",
                "uncertain",
                "needs_check",
                "pending",
                "sending",
              ].includes(quote.confirmation_mail_status) && (
                <p>
                  Je bestelling is vastgelegd. De e-mailbevestiging vereist nog
                  controle door de beheerder.
                </p>
              )}
            <p>
              Je bedrijf heeft al een gebruiksrecht voor dit doel. Opnieuw
              bevestigen maakt geen nieuwe bestelling.
            </p>
            {quote.customer_reference && (
              <p>
                Jouw referentie / PO-nummer:{" "}
                <strong>{quote.customer_reference}</strong>
              </p>
            )}
            {catalogue && quote.can_download ? (
              <CatalogueDownloadButton
                imageId={drawingKey}
                purposeId={purposeId}
              />
            ) : quote.can_test_download ? (
              <TestDownloadButton purposeId={purposeId} />
            ) : (
              <p>Voor deze tekening is momenteel geen download beschikbaar.</p>
            )}
            <details>
              <summary>Bekijk de vastgelegde afspraak</summary>
              <p>{quote.agreement_text}</p>
            </details>
          </div>
        ) : (
          <>
            <h3>Bestelling controleren</h3>
            <p>
              {quote.drawing_title}
              <br />
              {quote.company_name} · {quote.purpose_name}
            </p>
            <dl className="order-totals">
              <div>
                <dt>Exclusief btw</dt>
                <dd>{money(quote.amount_cents)}</dd>
              </div>
              <div>
                <dt>Btw ({quote.vat_percent}%)</dt>
                <dd>{money(quote.vat_cents)}</dd>
              </div>
              <div>
                <dt>Totaal inclusief btw</dt>
                <dd>
                  <strong>{money(quote.total_cents)}</strong>
                </dd>
              </div>
            </dl>
            <div className="notice">
              {catalogue ? (
                "Na bevestiging kun je het origineel downloaden. De facturatie wordt afzonderlijk verzorgd."
              ) : (
                <>
                  Testbestelling met voorbeeldbeelden. Er wordt geen factuur
                  verstuurd. Voor de testtekening is downloaden na bevestiging
                  mogelijk. Onderstaande tekst is de afspraak die we voor de
                  definitieve versie testen.
                </>
              )}
            </div>
            <div className="field">
              <label htmlFor="customer-reference">
                Jouw referentie / PO-nummer · optioneel
              </label>
              <input
                id="customer-reference"
                value={reference}
                maxLength={100}
                disabled={busy}
                onChange={(e) => {
                  setReference(e.target.value);
                  setAccepted(false);
                }}
                placeholder="Bijvoorbeeld PO-2026-001"
              />
              <p className="tiny muted">
                Dit kenmerk wordt bij de bestelling bewaard en op de factuur
                vermeld.
              </p>
            </div>
            <label className="consent">
              <input
                type="checkbox"
                checked={accepted}
                disabled={busy}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>{quote.agreement_text}</span>
            </label>
            <button
              className="primary full"
              disabled={!accepted || busy}
              onClick={confirm}
            >
              {busy
                ? "Vastleggen…"
                : catalogue
                  ? "Bestelling bevestigen"
                  : "Testbestelling bevestigen"}
            </button>
          </>
        ))}
    </div>
  );
}
