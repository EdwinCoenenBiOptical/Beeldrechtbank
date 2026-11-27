"use client";
import { useEffect, useState } from "react";
import type { Drawing } from "../lib/catalogue/types";
export function hearingDate(value?: string) {
  return value ? new Date(value + "T12:00:00").toLocaleDateString("nl-NL") : "";
}
export function HistoryThumbnail({
  drawing,
  title,
  compact = false,
}: {
  drawing?: Drawing;
  title: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [drawing?.preview]);
  const image =
    drawing?.preview && !failed ? (
      <img
        src={drawing.preview}
        alt={"Voorvertoning van " + title}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    ) : (
      <span className="tiny muted">Geen preview</span>
    );
  const className =
    "history-thumbnail" + (compact ? " history-thumbnail-small" : "");
  return drawing?.preview && !failed ? (
    <a
      className={className}
      href={"#tekening/" + drawing.id}
      aria-label={"Bekijk " + title + " in de beeldbank"}
    >
      {image}
    </a>
  ) : (
    <div className={className}>{image}</div>
  );
}
export function HistoryImageInfo({
  drawing,
  title,
}: {
  drawing?: Drawing;
  title: string;
}) {
  const name = drawing?.title || title;
  return (
    <div className="history-image-block">
      <HistoryThumbnail drawing={drawing} title={name} />
      <div className="history-image-copy">
        <h4>Beeldinformatie</h4>
        <dl className="history-image-details">
          <div>
            <dt>Beeldnummer</dt>
            <dd>{drawing?.key || "Niet beschikbaar"}</dd>
          </div>
          <div>
            <dt>Titel</dt>
            <dd>{name}</dd>
          </div>
          <div>
            <dt>Naam verdachte</dt>
            <dd>
              {drawing ? drawing.suspect || "Niet vermeld" : "Niet beschikbaar"}
            </dd>
          </div>
          <div>
            <dt>Datum zitting</dt>
            <dd>
              {drawing
                ? hearingDate(drawing.date) || "Niet vermeld"
                : "Niet beschikbaar"}
            </dd>
          </div>
          <div>
            <dt>Rechtbank</dt>
            <dd>
              {drawing ? drawing.court || "Niet vermeld" : "Niet beschikbaar"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
