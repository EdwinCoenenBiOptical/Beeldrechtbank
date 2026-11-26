"use client";
import { useEffect, useState } from "react";
import { usePortalAccess } from "../lib/portal/use-access";
import { browserClient } from "../lib/supabase/browser";
import { AuthPanel } from "../components/AuthPanel";
import { PricingPanel } from "../components/PricingPanel";
import { CatalogueAdmin } from "../components/CatalogueAdmin";
import type { Drawing } from "../lib/catalogue/types";
import { OrderMailAdmin } from "../components/OrderMailAdmin";
import { MoneybirdInvoiceTrial } from "../components/MoneybirdInvoiceTrial";
import { MoneybirdCompanies } from "../components/MoneybirdCompanies";
import { AdminApplications } from "../components/AdminApplications";
import { AccountPanel } from "../components/AccountPanel";

const date = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("nl-NL");
export default function Home() {
  const { access, refresh: refreshAccess } = usePortalAccess();
  const [drawings, setDrawings] = useState<Drawing[]>([]),
    [error, setError] = useState("");
  const [page, setPage] = useState("beeldbank"),
    [selectedId, setSelectedId] = useState("");
  const [q, setQ] = useState(""),
    [court, setCourt] = useState(""),
    [suspect, setSuspect] = useState(""),
    [lawyer, setLawyer] = useState(""),
    [caseName, setCase] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [sort, setSort] = useState("new"),
    [view, setView] = useState("grid");
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    if (access.phase !== "approved") {
      setZoom(false);
      setDrawings([]);
      return;
    }
    const controller = new AbortController();
    setError("");
    fetch("/api/drawings", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        if (r.status === 401 || r.status === 403) {
          void refreshAccess();
          throw Error("Je toegang moet opnieuw worden gecontroleerd.");
        }
        if (!r.ok) throw Error();
        return r.json();
      })
      .then((d) => {
        if (!controller.signal.aborted && Array.isArray(d.drawings))
          setDrawings(d.drawings);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "De tekeningen konden niet worden geladen. Vernieuw de pagina om opnieuw te proberen.",
          );
      });
    return () => controller.abort();
  }, [access.phase, refreshAccess]);
  useEffect(() => {
    function route() {
      const hash = location.hash.slice(1) || "beeldbank";
      setPage(hash.split("/")[0]);
      setSelectedId(hash.startsWith("tekening/") ? hash.split("/")[1] : "");
      setZoom(false);
    }
    route();
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);
  const selected = drawings.find((d) => String(d.id) === selectedId) || null;
  const isSample = drawings.every((d) => d.isSample !== false);
  function reset() {
    setQ("");
    setCourt("");
    setSuspect("");
    setLawyer("");
    setCase("");
    setFrom("");
    setTo("");
  }
  const filtered = drawings
    .filter(
      (d) =>
        (!q ||
          [
            d.title,
            d.court,
            d.caseName,
            d.suspect,
            d.lawyer,
            ...(d.keywords || []),
            d.crimePlace,
            d.crimeType,
            d.crimeDescription,
          ]
            .join(" ")
            .toLowerCase()
            .includes(q.toLowerCase())) &&
        (!court || d.court === court) &&
        d.suspect.toLowerCase().includes(suspect.toLowerCase()) &&
        d.lawyer.toLowerCase().includes(lawyer.toLowerCase()) &&
        d.caseName.toLowerCase().includes(caseName.toLowerCase()) &&
        (!from || d.date >= from) &&
        (!to || d.date <= to),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "old"
          ? a.date.localeCompare(b.date)
          : b.date.localeCompare(a.date),
    );
  const authMode = ["inloggen", "registreren", "herstellen"].includes(page)
    ? (page as "inloggen" | "registreren" | "herstellen")
    : "inloggen";
  async function logout() {
    try {
      await browserClient().auth.signOut();
      location.hash = "inloggen";
      void refreshAccess();
    } catch {
      setError("Uitloggen is niet gelukt. Probeer opnieuw.");
    }
  }
  const loggedIn = access.phase === "approved" || access.phase === "restricted";
  const publicAuth = access.phase === "guest";
  const member = access.phase === "approved";
  return (
    <>
      <header className="portal-header">
        <a href="#beeldbank" className="brand">
          nicole van den hout<small>Rechtbanktekeningen · Beeldrechtbank</small>
        </a>
        <nav aria-label="Hoofdnavigatie">
          {member && (
            <>
              <a href="#beeldbank" className="optional">
                Beeldbank
              </a>
              <a href="#informatie" className="optional">
                Over de beeldbank
              </a>
            </>
          )}
          {loggedIn ? (
            <>
              <a href="#account">Mijn account</a>
              <button className="pill" onClick={logout}>
                Uitloggen
              </button>
            </>
          ) : (
            publicAuth && (
              <a href="#inloggen" className="pill">
                Inloggen
              </a>
            )
          )}
        </nav>
      </header>
      <main className={publicAuth ? "wrap portal-auth-wrap" : "wrap"}>
        {access.phase === "loading" && (
          <section className="pagehead">
            <h2>Beeldrechtbank</h2>
            <p role="status">Toegang controleren…</p>
          </section>
        )}
        {access.phase === "error" && (
          <section className="pagehead">
            <h2>Toegang controleren</h2>
            <p role="alert">{access.message}</p>
            <button className="primary" onClick={() => void refreshAccess()}>
              Opnieuw proberen
            </button>
          </section>
        )}
        {publicAuth && <AuthPanel mode={authMode} />}
        {access.phase === "restricted" && <AccountPanel />}
        {member && (
          <>
            {page === "beeldbank" && (
              <>
                <section className="hero">
                  <div>
                    <div className="eyebrow">Het verhaal achter de zitting</div>
                    <h1>Rechtspraak. In beeld.</h1>
                    <p>
                      Rechtbanktekeningen door Nicole van den Hout.
                      <br />
                      Vind het beeld dat jouw verhaal vertelt.
                    </p>
                  </div>
                  <div className="hero-note">
                    <span>
                      Met de hand getekend.
                      <br />
                      Van dichtbij gezien.
                    </span>
                    Een eigen blik op de Nederlandse rechtszaal.
                  </div>
                </section>
                <form
                  className="searchbar"
                  onSubmit={(e) => e.preventDefault()}
                >
                  <input
                    aria-label="Zoek in de beeldbank"
                    placeholder="Zoek op zaak, naam of trefwoord…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  <button className="primary">Zoeken</button>
                </form>
                <section className="filters" aria-label="Filters">
                  <div className="field">
                    <label>Datum · van / tot</label>
                    <div className="datepair">
                      <input
                        aria-label="Datum vanaf"
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                      />
                      <input
                        aria-label="Datum tot en met"
                        type="date"
                        value={to}
                        onChange={(e) => setTo(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="field">
                    <label htmlFor="court">Rechtbank</label>
                    <select
                      id="court"
                      value={court}
                      onChange={(e) => setCourt(e.target.value)}
                    >
                      <option value="">Alle rechtbanken</option>
                      {[
                        ...new Set(
                          drawings.map((d) => d.court).filter(Boolean),
                        ),
                      ]
                        .sort((a, b) => a.localeCompare(b, "nl"))
                        .map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                    </select>
                  </div>
                  {[
                    ["suspect", "Naam verdachte", suspect, setSuspect],
                    ["lawyer", "Naam advocaat", lawyer, setLawyer],
                    ["case", "Naam zaak", caseName, setCase],
                  ].map(([id, label, value, set]) => (
                    <div className="field" key={String(id)}>
                      <label htmlFor={String(id)}>{String(label)}</label>
                      <input
                        id={String(id)}
                        value={String(value)}
                        onChange={(e) =>
                          (set as (s: string) => void)(e.target.value)
                        }
                        placeholder="Alle"
                      />
                    </div>
                  ))}
                </section>
                <div className="toolbar">
                  <div>
                    <span className="count" aria-live="polite">
                      {filtered.length} tekeningen
                    </span>{" "}
                    <button className="textlink" onClick={reset}>
                      Wis filters
                    </button>
                  </div>
                  <div className="tools">
                    <select
                      aria-label="Sorteren"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="new">Nieuwste eerst</option>
                      <option value="old">Oudste eerst</option>
                      <option value="title">Titel A–Z</option>
                    </select>
                    <div className="switch">
                      {["grid", "list"].map((v) => (
                        <button
                          key={v}
                          className={view === v ? "on" : ""}
                          aria-pressed={view === v}
                          onClick={() => setView(v)}
                        >
                          {v === "grid" ? "Raster" : "Lijst"}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                {error && <p role="alert">{error}</p>}
                <div className={"gallery " + (view === "list" ? "list" : "")}>
                  {filtered.map((d) => (
                    <article className="card" key={d.id}>
                      <a className="picture" href={"#tekening/" + d.id}>
                        <img
                          src={d.preview}
                          alt={
                            "Rechtbanktekening door Nicole van den Hout, archiefbeeld " +
                            d.id
                          }
                          loading="lazy"
                        />
                      </a>
                      <a className="caption" href={"#tekening/" + d.id}>
                        <div>
                          <strong>
                            {[d.suspect, d.caseName]
                              .filter((value) => value?.trim())
                              .join(" · ") || d.title}
                          </strong>
                          <p>
                            {[d.date ? date(d.date) : "", d.court]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <span className="arrow">↗</span>
                      </a>
                    </article>
                  ))}
                  {!filtered.length && !error && (
                    <div className="empty">
                      <h3>
                        {drawings.length
                          ? "Geen tekeningen gevonden"
                          : "Tekeningen laden…"}
                      </h3>
                      {!!drawings.length && (
                        <button className="secondary" onClick={reset}>
                          Alle tekeningen tonen
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {isSample && (
                  <div className="notice">
                    Ontwikkelversie · Titels, data, rechtbanken, namen en zaken
                    zijn fictieve voorbeeldgegevens en beschrijven niet de
                    afgebeelde personen.
                  </div>
                )}
              </>
            )}
            {page === "tekening" && selected && (
              <>
                <div className="pagehead">
                  <a className="back" href="#beeldbank">
                    ← Terug naar de beeldbank
                  </a>
                </div>
                <div className="detail">
                  <div>
                    <button
                      className="artlarge full"
                      onClick={() => setZoom(true)}
                      aria-label="Tekening vergroten"
                    >
                      <img src={selected.preview} alt={selected.title} />
                    </button>
                    <p className="credit">
                      © Nicole van den Hout · Previewbeeld
                    </p>
                    {selected.isSample !== false && (
                      <div className="notice">
                        De zaakgegevens zijn fictieve voorbeeldgegevens.
                      </div>
                    )}
                    <dl className="infogrid">
                      {[
                        ["Datum zitting", date(selected.date)],
                        ["Rechtbank", selected.court],
                        ["Naam verdachte", selected.suspect],
                        ["Naam advocaat", selected.lawyer],
                        ["Naam zaak", selected.caseName],
                        [
                          "Beeldnummer",
                          selected.key ||
                            "NVH-" + String(selected.id).padStart(4, "0"),
                        ],
                        ...(selected.crimeDate
                          ? [["Datum feit", date(selected.crimeDate)]]
                          : []),
                        ...(selected.crimePlace
                          ? [["Plaats feit", selected.crimePlace]]
                          : []),
                        ...(selected.crimeType
                          ? [["Soort feit", selected.crimeType]]
                          : []),
                        ...(selected.crimeDescription
                          ? [["Omschrijving feit", selected.crimeDescription]]
                          : []),
                        ...(selected.keywords?.length
                          ? [["Trefwoorden", selected.keywords.join(" · ")]]
                          : []),
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div>
                    <div className="eyebrow">Rechtbanktekeningen / Archief</div>
                    <h2>{selected.title}</h2>
                    {selected.isSample !== false ? (
                      <>
                        <p className="muted">
                          Selecteer het gebruiksdoel voor jouw redactie.
                        </p>
                        <PricingPanel
                          key={selected.id}
                          drawingKey={
                            "NVH-" + String(selected.id).padStart(4, "0")
                          }
                        />
                      </>
                    ) : (
                      <div>
                        {selected.downloadAllowed ? (
                          <PricingPanel
                            key={selected.id}
                            drawingKey={String(selected.id)}
                          />
                        ) : (
                          <span>
                            Dit beeld is alleen ter inzage en niet beschikbaar
                            om te downloaden.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
            {["inloggen", "registreren", "herstellen"].includes(page) && (
              <AuthPanel
                mode={page as "inloggen" | "registreren" | "herstellen"}
              />
            )}
            {page === "account" && <AccountPanel />}
            {page === "beheer" && <AdminApplications />}
            {page === "bedrijven" && <MoneybirdCompanies />}
            {page === "factuurproef" && <MoneybirdInvoiceTrial />}
            {page === "catalogusbeheer" && <CatalogueAdmin />}
            {page === "bestelmails" && <OrderMailAdmin />}
            {page === "informatie" && (
              <section className="pagehead">
                <div className="eyebrow">Over de beeldbank</div>
                <h2>Een eigen blik op rechtspraak.</h2>
                <p>
                  Met een goedgekeurd account kun je rechtbanktekeningen
                  bekijken. Goedgekeurde redactiemedewerkers kunnen beelden
                  downloaden namens hun bedrijf.
                </p>
                <p>
                  Het tarief wordt bepaald door je bedrijf en het gekozen
                  gebruiksdoel: Online, Print of TV. Binnen dat doel mag
                  hetzelfde bedrijf het beeld herhaaldelijk gebruiken.
                </p>
                <p>
                  Je bevestigt vooraf de downloadafspraak en dat er een factuur
                  wordt gestuurd.
                </p>
                <a href="#beeldbank" className="secondary">
                  Naar de beeldbank →
                </a>
              </section>
            )}
            {page === "tekening" && !selected && (
              <section className="pagehead">
                <h2>Tekening niet gevonden</h2>
                <a href="#beeldbank">Terug naar de beeldbank</a>
              </section>
            )}
          </>
        )}
      </main>
      <footer>
        <span>© Nicole van den Hout · Alle rechten voorbehouden</span>
        {member && isSample && <span>Ontwikkelversie · Voorbeeldgegevens</span>}
      </footer>
      {member && zoom && selected && (
        <dialog
          open
          ref={(el) => {
            if (el && !el.matches(":modal")) {
              el.close();
              el.showModal();
            }
          }}
          onCancel={() => setZoom(false)}
        >
          <button
            className="close"
            onClick={() => setZoom(false)}
            aria-label="Sluiten"
          >
            ×
          </button>
          <img src={selected.preview} alt={selected.title} />
          <p className="credit">© Nicole van den Hout · Previewbeeld</p>
        </dialog>
      )}
    </>
  );
}
