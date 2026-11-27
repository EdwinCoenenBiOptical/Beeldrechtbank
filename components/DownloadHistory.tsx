"use client";
import { useEffect, useMemo, useState } from "react";
import { HistoryThumbnail, hearingDate } from "./HistoryImage";
import type { Drawing } from "../lib/catalogue/types";
import { readApiResponse } from "../lib/http/api-response.mjs";
type Entry = {
  id: string;
  offered_at: string;
  file_name: string;
  byte_count: number;
  is_test: boolean;
  downloaded_by_you: boolean;
  order_items: {
    drawing_id: string;
    drawing_title_snapshot: string;
    purpose_name_snapshot: string;
  };
};
export function DownloadHistory({
  drawings = [],
}: { drawings?: Drawing[] } = {}) {
  const images = useMemo(
    () => new Map(drawings.map((d) => [String(d.id), d])),
    [drawings],
  );
  const [data, setData] = useState<{
      downloads: Entry[];
      has_more: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [refresh, setRefresh] = useState(0),
    [page, setPage] = useState(1);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setData(null);
    fetch("/api/downloads/history?page=" + page, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        const value = await readApiResponse(r);
        if (!r.ok) throw Error(value.error);
        if (!controller.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [refresh, page]);
  return (
    <section aria-labelledby="download-history-title">
      <div className="toolbar">
        <h3 id="download-history-title">Downloadgeschiedenis</h3>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => setRefresh((r) => r + 1)}
        >
          Downloads vernieuwen
        </button>
      </div>
      {busy && <p role="status">Downloads laden…</p>}
      {error && <p role="alert">{error}</p>}
      {data && !data.downloads.length && (
        <p className="status">Er zijn nog geen downloads geregistreerd.</p>
      )}
      {data?.downloads.map((d) => {
        const drawing = images.get(d.order_items.drawing_id),
          title = drawing?.title || d.order_items.drawing_title_snapshot;
        const info = [
          drawing?.key || d.file_name,
          title,
          drawing?.suspect,
          hearingDate(drawing?.date),
          drawing?.court,
          d.order_items.purpose_name_snapshot,
          (d.byte_count / 1000000).toLocaleString("nl-NL", {
            maximumFractionDigits: 2,
          }) + " MB",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <article className="panel history-download-row" key={d.id}>
            <HistoryThumbnail drawing={drawing} title={title} compact />
            <div className="history-download-copy">
              <p className="history-download-description">{info}</p>
              <p className="tiny muted">
                {new Intl.DateTimeFormat("nl-NL", {
                  dateStyle: "long",
                  timeStyle: "short",
                  timeZone: "Europe/Amsterdam",
                }).format(new Date(d.offered_at))}{" "}
                · {d.is_test ? "Testdownload · " : ""}
                {d.downloaded_by_you
                  ? "Door jou aangevraagd"
                  : "Door een collega aangevraagd"}{" "}
                · Bestand aangeboden aan de browser
              </p>
            </div>
          </article>
        );
      })}
      {data && (page > 1 || data.has_more) && (
        <div className="history-pagination">
          <button
            className="secondary"
            disabled={busy || page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Vorige downloads
          </button>
          <span>Pagina {page}</span>
          <button
            className="secondary"
            disabled={busy || !data.has_more}
            onClick={() => setPage((p) => p + 1)}
          >
            Volgende downloads
          </button>
        </div>
      )}
    </section>
  );
}
