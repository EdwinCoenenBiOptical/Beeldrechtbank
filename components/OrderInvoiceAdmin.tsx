"use client";
import { useEffect, useRef, useState } from "react";
import { readApiResponse } from "../lib/http/api-response.mjs";
type Job = {
  order_id: string;
  status: string;
  invoice_id: string | null;
  administration_id: string | null;
  request_snapshot?: any;
  invoice_snapshot?: any;
  last_error: string | null;
  ever_issued: boolean;
};
type Row = Job & {
  order_number: number;
  company_name_snapshot: string;
  customer_reference: string | null;
  accepted_at: string;
  total_cents: number;
};
type Detail = { source: any; job: Job };
const labels: Record<string, string> = {
  queued: "Nog geen concept",
  prepared: "Voorbereid",
  creating: "Aanmaakuitkomst controleren",
  create_uncertain: "Aanmaakuitkomst onzeker",
  create_rejected: "Aanmaak geweigerd",
  draft: "Concept in Moneybird",
  issued: "In Moneybird uitgegeven",
  blocked: "Handmatige controle nodig",
};
const money = (n: number) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(
    n / 100,
  );
async function api(query = "", body?: Record<string, unknown>) {
  const r = await fetch("/api/admin/order-invoices" + query, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const d = await readApiResponse(r, { mutation: !!body });
  if (!r.ok)
    throw Error(d.error || "De factuuractie kon niet worden bevestigd.");
  return d;
}
export function OrderInvoiceAdmin() {
  const [list, setList] = useState<{
      orders: Row[];
      page: number;
      has_more: boolean;
      total: number;
    } | null>(null),
    [page, setPage] = useState(1),
    [filter, setFilter] = useState("all"),
    [refresh, setRefresh] = useState(0),
    [detail, setDetail] = useState<Detail | null>(null),
    [quote, setQuote] = useState<{ plan: any; plan_hash: string } | null>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [ack, setAck] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const alive = useRef(true),
    detailHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    setLoading(true);
    api(`?page=${page}&status=${filter}`)
      .then((d) => {
        if (current) setList(d);
      })
      .catch((e) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [page, filter, refresh]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error
            ? e.message
            : "De actie is niet bevestigd. Controleer eerst de status.",
        );
    } finally {
      if (alive.current) {
        setBusy(false);
        setAck(false);
      }
    }
  }
  async function select(id: string) {
    setDetail(null);
    setQuote(null);
    setAck(false);
    const data = await api("?order_id=" + id);
    if (alive.current) {
      setDetail(data);
      requestAnimationFrame(() =>
        detailHeading.current?.scrollIntoView({
          block: "start",
          behavior: "smooth",
        }),
      );
    }
  }
  async function act(action: "create" | "check") {
    if (!detail) return;
    const orderId = detail.job.order_id;
    let outcome: { job: Job } | null = null;
    try {
      outcome = await api("", {
        action,
        order_id: orderId,
        confirmed: true,
        ...(action === "create" ? { plan_hash: quote?.plan_hash } : {}),
      });
    } finally {
      // The server may have persisted a fence even when the request did not finish normally.
      try {
        await select(orderId);
      } catch {
        setDetail(null);
        setQuote(null);
      }
      setRefresh((n) => n + 1);
    }
    setMessage(
      outcome?.job.ever_issued || outcome?.job.status === "issued"
        ? "De uitgegeven factuur is gecontroleerd en gekoppeld. Er is geen tweede factuur aangemaakt."
        : action === "create"
          ? "Het concept is gekoppeld en gecontroleerd. Het portal heeft geen factuur verstuurd."
          : "De actuele Moneybird-status is gecontroleerd.",
    );
  }
  const job = detail?.job,
    canPrepare =
      job &&
      !job.invoice_id &&
      ["queued", "prepared", "create_rejected"].includes(job.status),
    plan = quote?.plan;
  return (
    <section className="pagehead">
      <a className="back" href="#account">
        ← Terug naar mijn account
      </a>
      <div className="eyebrow" style={{ marginTop: 25 }}>
        Beheer · Facturatie
      </div>
      <h2>Conceptfacturen beheren</h2>
      <p>
        Nieuwe echte bestellingen komen hier klaar te staan. Controleer per
        bestelling het factuurcontact, bedrag en kenmerk voordat je een concept
        aanmaakt.
      </p>
      <p className="status">
        Het portal verstuurt hier geen facturen. Controleer en verstuur een
        concept voorlopig in Moneybird. Oude bestellingen en testbestellingen
        worden niet automatisch toegevoegd.
      </p>
      {busy && (
        <p role="status">
          Factuuractie wordt verwerkt… Wacht op de actuele status.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="toolbar">
        <div className="field">
          <label htmlFor="order-invoice-filter">Factuurstatus</label>
          <select
            id="order-invoice-filter"
            value={filter}
            disabled={busy || loading}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
              setDetail(null);
              setQuote(null);
            }}
          >
            <option value="all">Alle nieuwe bestellingen</option>
            <option value="queued">Nog geen concept</option>
            <option value="draft">Concept</option>
            <option value="attention">Controle nodig</option>
            <option value="issued">Uitgegeven</option>
          </select>
        </div>
        <button
          className="secondary"
          disabled={busy || loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Overzicht vernieuwen
        </button>
      </div>
      {loading && <p role="status">Bestellingen laden…</p>}
      {!loading && list && !list.orders.length && (
        <p>
          Er staan geen bestellingen in deze selectie. Alleen nieuwe echte
          bestellingen vanaf het activeren van deze facturatiewachtrij worden
          opgenomen.
        </p>
      )}
      {list && (
        <>
          <div style={{ overflowX: "auto" }}>
            <table className="catalogue-table">
              <thead>
                <tr>
                  <th>Bestelling</th>
                  <th>Bedrag incl. btw</th>
                  <th>Status</th>
                  <th>Actie</th>
                </tr>
              </thead>
              <tbody>
                {list.orders.map((r) => (
                  <tr key={r.order_id}>
                    <td>
                      <strong>
                        Bestelling {r.order_number} · {r.company_name_snapshot}
                      </strong>
                      <br />
                      {r.customer_reference
                        ? "PO / referentie: " + r.customer_reference
                        : "Geen klantreferentie"}
                      <br />
                      <small>
                        {new Date(r.accepted_at).toLocaleString("nl-NL", {
                          timeZone: "Europe/Amsterdam",
                        })}
                      </small>
                    </td>
                    <td>{money(Number(r.total_cents))}</td>
                    <td>
                      {labels[r.status] || r.status}
                      {r.last_error && <p className="tiny">{r.last_error}</p>}
                    </td>
                    <td>
                      <button
                        className="secondary"
                        disabled={busy || loading}
                        onClick={() => run(() => select(r.order_id))}
                      >
                        Bestelling bekijken
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Pagina {page} · {list.total} bestellingen
          </p>
          <button
            className="secondary"
            disabled={busy || loading || page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Vorige
          </button>{" "}
          <button
            className="secondary"
            disabled={busy || loading || !list.has_more}
            onClick={() => setPage((p) => p + 1)}
          >
            Volgende
          </button>
        </>
      )}
      {detail && job && (
        <div className="panel moneybird-mapping">
          <h3 ref={detailHeading} className="purchase-confirmation-title">
            Bestelling {detail.source.order.order_number} ·{" "}
            {detail.source.order.company_name_snapshot}
          </h3>
          <p>{labels[job.status] || job.status}</p>
          {detail.source.order.customer_reference && (
            <p>
              PO / referentie:{" "}
              <strong>{detail.source.order.customer_reference}</strong>
            </p>
          )}
          {detail.source.items.map((i: any) => (
            <p key={i.id}>
              {i.drawing_title_snapshot} · {i.purpose_name_snapshot}
              {i.image_key ? " · " + i.image_key : ""}
              <br />
              {money(Number(i.amount_cents))} + {money(Number(i.vat_cents))} btw
              = {money(Number(i.total_cents))}
            </p>
          ))}
          {!detail.source.link && (
            <p className="notice">
              Koppel dit bedrijf eerst via{" "}
              <a className="textlink" href="#bedrijven">
                Bedrijven en Moneybird
              </a>
              .
            </p>
          )}
          {canPrepare && detail.source.link && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setQuote(
                    await api("?order_id=" + job.order_id + "&mode=quote"),
                  );
                  setAck(false);
                })
              }
            >
              Factuurvoorstel controleren
            </button>
          )}
          {plan && canPrepare && (
            <div className="status">
              <h4>Te maken concept</h4>
              <p>
                <strong>{plan.contact_name}</strong>
                <br />
                {plan.contact_address}
                <br />
                Factuurcontact:{" "}
                {plan.recipient_name || "Standaard van het bedrijf"}
                <br />
                Factuur-e-mailadres: <strong>{plan.recipient_email}</strong>
              </p>
              <p>
                Kenmerk: <strong>{plan.reference}</strong>
              </p>
              <p>
                Exclusief btw: {money(plan.amount_cents)}
                <br />
                Btw 21%: {money(plan.vat_cents)}
                <br />
                <strong>Totaal: {money(plan.total_cents)}</strong>
              </p>
              <p className="tiny">
                Btw: {plan.tax_rate_name} · Omzet: {plan.ledger_account_name} (
                {plan.ledger_account_code})
              </p>
              <label className="consent">
                <input
                  type="checkbox"
                  checked={ack}
                  disabled={busy}
                  onChange={(e) => setAck(e.target.checked)}
                />
                <span>
                  Ik heb klant, factuuradres, bedrag en kenmerk gecontroleerd.
                  Maak één conceptfactuur voor deze bestelling; nog niet
                  versturen.
                </span>
              </label>
              <button
                className="primary"
                disabled={busy || !ack}
                onClick={() => run(() => act("create"))}
              >
                Conceptfactuur aanmaken
              </button>
            </div>
          )}
          {job.request_snapshot && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => run(() => act("check"))}
            >
              Factuurstatus controleren / herstellen
            </button>
          )}
          {job.invoice_id && job.administration_id && (
            <p>
              <a
                className="primary"
                href={`https://moneybird.com/${job.administration_id}/sales_invoices/${job.invoice_id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open de factuur in Moneybird ↗
              </a>
            </p>
          )}
          {["creating", "create_uncertain"].includes(job.status) && (
            <p className="notice">
              De aanmaakuitkomst is onzeker. Status controleren zoekt naar de
              bestaande factuur. Als niets wordt gevonden, maakt het portal niet
              opnieuw een factuur aan; controleer Moneybird dan handmatig.
            </p>
          )}
          {job.last_error && <p role="alert">Controlecode: {job.last_error}</p>}
          {job.status === "draft" && (
            <p>
              Het concept is gekoppeld. Controleer het document in Moneybird
              voordat je het daar verstuurt. Nogmaals op aanmaken klikken maakt
              geen tweede factuur.
            </p>
          )}
          {job.status === "issued" && (
            <p>
              Moneybird heeft deze factuur uitgegeven. Het portal maakt geen
              tweede factuur voor deze bestelling.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
