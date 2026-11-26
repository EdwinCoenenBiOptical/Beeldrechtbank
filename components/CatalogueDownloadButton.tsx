"use client";
import { useState } from "react";
export function CatalogueDownloadButton({
  imageId,
  purposeId,
}: {
  imageId: string;
  purposeId: string;
}) {
  const [requested, setRequested] = useState(false);
  return (
    <div className="catalogue-download">
      <form
        method="post"
        action="/api/downloads/catalogue"
        target="_blank"
        rel="noopener"
        onSubmit={() => setRequested(true)}
      >
        <input type="hidden" name="image_id" value={imageId} />
        <input type="hidden" name="purpose_id" value={purposeId} />
        <button type="submit" className="primary full">
          Origineel downloaden ↗
        </button>
      </form>
      <p className="tiny muted">
        Download op het bestaande gebruiksrecht van je bedrijf. Er ontstaat geen
        nieuwe bestelling of factuur. De download opent in een nieuw tabblad.
      </p>
      {requested && (
        <p role="status">
          De download is aangevraagd. Controleer het nieuwe tabblad en je
          downloads.
        </p>
      )}
    </div>
  );
}
