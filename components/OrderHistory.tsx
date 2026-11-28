"use client";
import { CatalogueDownloadButton } from "./CatalogueDownloadButton";
import { HistoryImageInfo } from "./HistoryImage";
import type { Drawing } from "../lib/catalogue/types";
import { useEffect, useMemo, useState } from "react";
type Item = {
  id: string;
  drawing_id: string;
  purpose_id: string;
  drawing_title_snapshot: string;
  purpose_name_snapshot: string;
  amount_cents: number;
  vat_percent: number;
  vat_cents: number;
  total_cents: number;
  currency: string;
  agreement_text_snapshot: string;
};
type Order = {
  invoice?: { status: string; invoice_number: string | null; delivery_state?:string; sent_at?:string|null } | null;
  customer_reference?: string | null;
  id: string;
  order_number: number;
  accepted_at: string;
  is_test: boolean;
  invoice_trial?: {
    status: string;
    invoice_number: string | null;
    sent_at: string | null;
  } | null;
  ordered_by_you: boolean;
  company_name_snapshot?: string;
  ordered_by_name?: string;
  order_items: Item[];
};
type History = {
  invoice_status_unavailable?: boolean;
  orders: Order[];
  page: number;
  has_more: boolean;
};
const money = (cents: number, currency: string) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency }).format(
    cents / 100,
  );
const date = (value: string) =>
  new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Amsterdam",
  }).format(new Date(value));
export function OrderHistory({ drawings = [], admin = false }: { drawings?: Drawing[]; admin?: boolean } = {}) {
  const images = useMemo(
    () => new Map(drawings.map((d) => [String(d.id), d])),
    [drawings],
  );
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [history, setHistory] = useState<History | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setHistory(null);
    setError("");
    fetch((admin ? "/api/admin/history?kind=orders&" : "/api/orders/history?") + "page=" + page, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        if (!controller.signal.aborted) setHistory(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "De bestellingen konden niet worden geladen.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [page, refresh, admin]);
  return (
    <section className="order-history" aria-labelledby="history-title">
      <div className="toolbar">
        <h3 id="history-title">{admin ? "Alle bestellingen" : "Bestellingen van jouw bedrijf"}</h3>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => setRefresh((r) => r + 1)}
        >
          Overzicht vernieuwen
        </button>
      </div>
      <p className="muted">
        {admin ? "Bestellingen van alle bedrijven. Dit overzicht maakt geen nieuwe bestellingen of facturen aan." : "Hier vind je de bestellingen en gebruiksafspraken van jouw bedrijf, inclusief die van collega’s."}
      </p>
      {busy && <p role="status">Bestellingen laden…</p>}
      {error && <p role="alert">{error}</p>}
      {history?.invoice_status_unavailable && (
        <p className="notice">
          De factuurstatus kon tijdelijk niet worden geladen. Vernieuw het
          overzicht om de actuele status te zien.
        </p>
      )}
      {history && !history.orders.length && (
        <p className="status">Er zijn nog geen bestellingen om te tonen.</p>
      )}
      {history?.orders.map((order) => (
        <article className="history-order panel" key={order.id}>
          <div className="history-order-info" aria-label="Bestelinformatie">
            <div className="history-order-heading">
              <strong>
                {order.is_test ? "Testbestelling" : "Bestelling"}{" "}
                {order.order_number}
              </strong>
              <span>{date(order.accepted_at)}</span>
            </div>
            <p className="tiny muted">
              {admin ? `${order.company_name_snapshot || "Bedrijf"} · ${order.ordered_by_name || "Gebruiker"}` : order.ordered_by_you
                ? "Door jou besteld"
                : "Door een collega besteld"}
            </p>
            {order.customer_reference && (
              <p>
                Jouw referentie / PO-nummer:{" "}
                <strong>{order.customer_reference}</strong>
              </p>
            )}
          </div>
          {order.order_items.map((item) => (
            <div className="history-item" key={item.id}>
              <HistoryImageInfo
                drawing={images.get(item.drawing_id)}
                title={item.drawing_title_snapshot}
              />
              <div className="history-price-info">
                <h4>Prijs en akkoordverklaring</h4>
                <p>
                  {item.purpose_name_snapshot} · Herhaald gebruik door hetzelfde
                  bedrijf
                </p>
                <dl className="order-totals">
                  <div>
                    <dt>Exclusief btw</dt>
                    <dd>{money(item.amount_cents, item.currency)}</dd>
                  </div>
                  <div>
                    <dt>Btw ({item.vat_percent}%)</dt>
                    <dd>{money(item.vat_cents, item.currency)}</dd>
                  </div>
                  <div>
                    <dt>Totaal inclusief btw</dt>
                    <dd>
                      <strong>{money(item.total_cents, item.currency)}</strong>
                    </dd>
                  </div>
                </dl>
                {!admin && !order.is_test && (
                  <CatalogueDownloadButton
                    imageId={item.drawing_id}
                    purposeId={item.purpose_id}
                  />
                )}
                <details>
                  <summary>Bekijk de akkoordverklaring</summary>
                  <p>{item.agreement_text_snapshot}</p>
                </details>
              </div>
            </div>
          ))}
          {!order.is_test && (
            <p className="notice">
              {order.invoice?.invoice_number
                ? "Factuur " + order.invoice.invoice_number + (order.invoice.delivery_state==='sent'?' · Verstuurd':'')
                : order.invoice?.status === "draft"
                  ? "Factuur in voorbereiding"
                  : order.invoice?.status === "issued"
                    ? "Factuur in Moneybird uitgegeven"
                    : "Facturatie wordt afzonderlijk verzorgd."}
            </p>
          )}
          {order.is_test && (
            <p className="notice">
              {order.invoice_trial
                ? `Afzonderlijke factuurproef · ${order.invoice_trial.invoice_number ? "Factuur " + order.invoice_trial.invoice_number + " · " : ""}${order.invoice_trial.sent_at ? "In Moneybird uitgegeven/verzonden; handmatig crediteren na de proef." : order.invoice_trial.status === "draft" ? "Concept in Moneybird; nog niet verstuurd." : "Controleer de actuele status bij de beheerder."}`
                : "Testbestelling · Facturatie alleen via een afzonderlijk bevestigde factuurproef."}
            </p>
          )}
        </article>
      ))}
      {history && (page > 1 || history.has_more) && (
        <div className="history-pagination">
          <button
            className="secondary"
            disabled={page === 1 || busy}
            onClick={() => setPage((p) => p - 1)}
          >
            Vorige
          </button>
          <span>Pagina {page}</span>
          <button
            className="secondary"
            disabled={!history.has_more || busy}
            onClick={() => setPage((p) => p + 1)}
          >
            Volgende
          </button>
        </div>
      )}

    </section>
  );
}
