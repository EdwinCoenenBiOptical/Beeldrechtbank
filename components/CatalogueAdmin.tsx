"use client";
import { useEffect, useRef, useState } from "react";
import { readApiResponse } from "../lib/http/api-response.mjs";
type Issue = { row: number; key?: string; message: string };
type Validation = {
  hash: string;
  errors: Issue[];
  warnings: Issue[];
  summary: {
    total: number;
    valid: number;
    publish: number;
    download: number;
    downloadDisabled: number;
  };
  sample: {
    key: string;
    source_path: string;
    date: string;
    download: boolean;
  }[];
};
type Entry = {
  id: string;
  image_key: string;
  title: string;
  source_path: string;
  publish_requested: boolean;
  download_allowed: boolean;
  preview_status: string;
  last_error: string | null;
};
type Overview = {
  batch: {
    id: string;
    status: string;
    summary: Validation["summary"];
    warnings: Issue[];
  } | null;
  active_batch: string | null;
  entries: Entry[];
  counts: {
    total: number;
    requested: number;
    ready: number;
    failed: number;
    pending: number;
  };
  page: number;
};
async function api(body?: Record<string, unknown>, query = "") {
  const r = await fetch(
    "/api/admin/catalogue" + query,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          cache: "no-store",
        }
      : { cache: "no-store" },
  );
  const data = await readApiResponse(r, { mutation: !!body });
  if (!r.ok)
    throw Error(data.error || "De catalogusactie kon niet worden uitgevoerd.");
  return data;
}
export function CatalogueAdmin() {
  const [csv, setCsv] = useState(""),
    [filename, setFilename] = useState(""),
    [validation, setValidation] = useState<Validation | null>(null),
    [overview, setOverview] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [publishAck, setPublishAck] = useState(false),
    [preview, setPreview] = useState<Entry | null>(null);
  const stop = useRef(false),
    mounted = useRef(true),
    stagingId = useRef<string | null>(null);
  async function load(batch?: string, page = 1) {
    const result = await api(
      undefined,
      `?page=${page}${batch ? "&batch_id=" + batch : ""}`,
    );
    if (mounted.current) setOverview(result);
    return result as Overview;
  }
  useEffect(() => {
    mounted.current = true;
    load().catch((e) => {
      if (mounted.current) setError(e.message);
    });
    return () => {
      mounted.current = false;
      stop.current = true;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "De actie is niet bevestigd. Vernieuw eerst het overzicht.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function choose(file: File | undefined) {
    setError("");
    setValidation(null);
    setConfirmed(false);
    stagingId.current = null;
    setCsv("");
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError("Gebruik een CSV-bestand van maximaal 2 MB.");
      return;
    }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      setCsv(text);
      setFilename(file.name);
    } catch {
      setError(
        "Dit bestand is geen geldige UTF-8. Exporteer opnieuw als CSV UTF-8.",
      );
    }
  }
  async function prepare(id: string) {
    if (!overview?.batch) return;
    await api({ action: "prepare", batch_id: overview.batch.id, id });
    await load(overview.batch.id, overview.page);
  }
  async function prepareAll() {
    if (!overview?.batch) return;
    const batch = overview.batch.id;
    stop.current = false;
    let count = 0;
    while (!stop.current && mounted.current) {
      const { ids } = await api({ action: "next", batch_id: batch });
      if (!ids.length) break;
      for (const id of ids) {
        if (stop.current || !mounted.current) break;
        try {
          await api({ action: "prepare", batch_id: batch, id });
          count++;
        } catch (e) {
          stop.current = true;
          if (mounted.current)
            setError(
              e instanceof Error ? e.message : "Een preview is mislukt.",
            );
        }
        if (mounted.current)
          setMessage(`${count} previews in deze sessie voorbereid.`);
      }
      if (mounted.current) await load(batch, overview.page);
    }
    if (mounted.current) {
      await load(batch, overview.page);
      setMessage(
        stop.current
          ? "Verwerking gepauzeerd. Reeds voorbereide previews blijven bewaard."
          : "De verwerking is afgerond. Controleer eventuele mislukte beelden en bekijk de previews.",
      );
    }
  }
  const batch = overview?.batch?.id ? overview.batch : null,
    counts = overview?.counts;
  return (
    <section className="pagehead">
      <a className="back" href="#account">
        ← Terug naar mijn account
      </a>
      <div className="eyebrow" style={{ marginTop: 25 }}>
        Beheer · Catalogus
      </div>
      <h2>Catalogus importeren</h2>
      <p>
        Controleer de CSV, bereid kleinere previews met watermerk voor en
        publiceer daarna de complete selectie. Originelen blijven in OneDrive.
      </p>
      <p className="status">
        Publicatie maakt de beelden zichtbaar in de beeldbank. Bestellen en
        originele downloads voor deze nieuwe catalogus worden in een volgende
        stap aangesloten.
      </p>
      {error && <p role="alert">{error}</p>}
      {message && (
        <p className="status" role="status">
          {message}
        </p>
      )}
      <div className="panel moneybird-mapping">
        <h3>1. CSV controleren</h3>
        <p>
          Gebruik Catalogus.csv met de bestaande kolommen. De hoofdmap is
          Rechtbanktekeningen; beeld_map begint met Beelden. Lege downloadkeuzes
          worden Nee.
        </p>
        <label className="field">
          CSV-bestand (UTF-8, maximaal 2 MB)
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </label>
        <button
          className="secondary"
          disabled={busy || !csv}
          onClick={() =>
            run(async () => {
              setValidation(await api({ action: "validate", csv }));
              setConfirmed(false);
            })
          }
        >
          CSV controleren
        </button>
        {validation && (
          <>
            <h4>{filename}</h4>
            <p>
              {validation.summary.total} beelden · {validation.summary.publish}{" "}
              publiceren · {validation.summary.download} downloaden toegestaan ·{" "}
              {validation.summary.downloadDisabled} niet downloaden.
            </p>
            <p>
              {validation.errors.length} fouten · {validation.warnings.length}{" "}
              aandachtspunten.
            </p>
            {validation.errors.slice(0, 30).map((e, i) => (
              <p key={"e" + i}>
                Rij {e.row}: {e.message}
              </p>
            ))}
            {!!validation.warnings.length && (
              <details>
                <summary>Aandachtspunten bekijken</summary>
                {validation.warnings.map((e, i) => (
                  <p key={i}>
                    Rij {e.row} · {e.key}: {e.message}
                  </p>
                ))}
              </details>
            )}
            <details>
              <summary>Voorbeeld van de bestandsverwijzingen</summary>
              {validation.sample.map((r) => (
                <p key={r.key}>
                  <strong>{r.key}</strong>
                  <br />
                  {r.source_path}
                  <br />
                  {r.date} · Downloaden: {r.download ? "Ja" : "Nee"}
                </p>
              ))}
            </details>
            {!validation.errors.length && (
              <>
                <label className="consent">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  <span>
                    Ik heb de selectie en bestandsverwijzingen gecontroleerd.
                    Sla deze import als concept op; nog niet publiceren.
                  </span>
                </label>
                <button
                  className="primary"
                  disabled={busy || !confirmed}
                  onClick={() =>
                    run(async () => {
                      const id =
                        stagingId.current ||
                        (stagingId.current = crypto.randomUUID());
                      await api({
                        action: "stage",
                        batch_id: id,
                        csv,
                        hash: validation.hash,
                        confirmed: true,
                      });
                      await load(id);
                      setPublishAck(false);
                      setPreview(null);
                      setMessage(
                        "Concept opgeslagen. Bereid nu eerst een preview voor om het resultaat te controleren.",
                      );
                    })
                  }
                >
                  Als concept opslaan
                </button>
              </>
            )}
          </>
        )}
      </div>
      <div className="panel moneybird-mapping">
        <h3>2. Previews voorbereiden</h3>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await load(batch?.id, overview?.page);
            })
          }
        >
          Overzicht vernieuwen
        </button>
        {!batch && <p>Er is nog geen conceptimport.</p>}
        {batch && counts && (
          <>
            <p>
              Import {batch.id.slice(0, 8)} ·{" "}
              {batch.status === "published" ? "Gepubliceerd" : "Concept"}
              {overview?.active_batch === batch.id
                ? " · Actieve beeldbank"
                : ""}
            </p>
            <p>
              {counts.ready} van {counts.requested} te publiceren beelden gereed
              · {counts.failed} mislukt.
            </p>
            <p>
              Elk origineel wordt tijdelijk opgehaald en omgezet naar een
              JPEG-preview van maximaal 1400 × 1100 pixels, met een herhaald
              watermerk. De originelen worden niet openbaar opgeslagen.
            </p>
            {batch.status === "draft" && (
              <>
                <button
                  className="primary"
                  disabled={busy || !counts.pending}
                  onClick={() => run(prepareAll)}
                >
                  Alle ontbrekende previews voorbereiden
                </button>
                {busy && (
                  <button
                    className="secondary"
                    onClick={() => {
                      stop.current = true;
                    }}
                  >
                    Na dit beeld pauzeren
                  </button>
                )}
                <p className="tiny muted">
                  Laat dit scherm tijdens de verwerking open. Je kunt later
                  hervatten. Mislukte beelden kun je afzonderlijk opnieuw
                  controleren.
                </p>
              </>
            )}
            {preview && (
              <div>
                <h4>{preview.image_key}</h4>
                <img
                  style={{ maxWidth: "100%", maxHeight: 650 }}
                  src={`/api/admin/catalogue?batch_id=${batch.id}&preview=${preview.id}`}
                  alt={"Preview met watermerk: " + preview.title}
                />
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table className="catalogue-table">
                <thead>
                  <tr>
                    <th>Beeld / locatie</th>
                    <th>Downloaden</th>
                    <th>Preview</th>
                    <th>Actie</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.entries.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <strong>{e.image_key}</strong>
                        <br />
                        <small>{e.source_path}</small>
                        {!e.publish_requested && <p>Niet publiceren</p>}
                      </td>
                      <td>{e.download_allowed ? "Ja" : "Nee"}</td>
                      <td>
                        {e.preview_status === "ready"
                          ? "Gereed"
                          : e.preview_status === "failed"
                            ? "Mislukt"
                            : "Nog niet voorbereid"}
                        {e.last_error && <p>{e.last_error}</p>}
                      </td>
                      <td>
                        {e.preview_status === "ready" ? (
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => setPreview(e)}
                          >
                            Bekijken
                          </button>
                        ) : (
                          e.publish_requested &&
                          batch.status === "draft" && (
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() => run(async () => prepare(e.id))}
                            >
                              {e.preview_status === "failed"
                                ? "Opnieuw controleren"
                                : "Preview voorbereiden"}
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Pagina {overview.page} van{" "}
              {Math.max(1, Math.ceil(counts.total / 50))}
            </p>
            <button
              className="secondary"
              disabled={busy || overview.page <= 1}
              onClick={() =>
                run(async () => {
                  await load(batch.id, overview.page - 1);
                })
              }
            >
              Vorige
            </button>{" "}
            <button
              className="secondary"
              disabled={busy || overview.page * 50 >= counts.total}
              onClick={() =>
                run(async () => {
                  await load(batch.id, overview.page + 1);
                })
              }
            >
              Volgende
            </button>
          </>
        )}
      </div>
      {batch?.status === "draft" && counts && (
        <div className="panel moneybird-mapping">
          <h3>3. Publiceren</h3>
          <p>
            Dit vervangt de huidige beeldbank door de beelden die in deze CSV op
            publiceren Ja staan. De selectie wordt in één keer actief; er
            verschijnt geen half verwerkte import.
          </p>
          <label className="consent">
            <input
              type="checkbox"
              disabled={
                busy || !counts.requested || counts.ready !== counts.requested
              }
              checked={publishAck}
              onChange={(e) => setPublishAck(e.target.checked)}
            />
            <span>
              Ik heb de selectie en previews gecontroleerd en wil deze catalogus
              openbaar publiceren.
            </span>
          </label>
          <button
            className="primary"
            disabled={
              busy ||
              !publishAck ||
              !counts.requested ||
              counts.ready !== counts.requested
            }
            onClick={() =>
              run(async () => {
                await api({
                  action: "publish",
                  batch_id: batch.id,
                  confirmed: true,
                });
                await load(batch.id);
                setMessage(
                  "De catalogus is gepubliceerd. Open de beeldbank om het resultaat te bekijken.",
                );
              })
            }
          >
            Catalogus publiceren
          </button>
        </div>
      )}
    </section>
  );
}
