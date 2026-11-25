import "server-only";
import { serviceClient } from "../supabase/service";
import { AdminError } from "../moneybird/server";
import { currentConnection } from "../onedrive/server";
import { fetchOriginal, watermarkedPreview } from "./preview.mjs";
export const previewBucket = "catalogue-previews";
export async function catalogueAction(
  actor: string | null,
  action: string,
  data: Record<string, unknown> = {},
) {
  const { data: result, error } = await serviceClient().rpc(
    "server_catalogue",
    { p_actor_id: actor, p_action: action, p_data: data },
  );
  if (error) {
    if (error.message.includes("ADMIN_REQUIRED"))
      throw new AdminError(
        "Alleen de beheerder mag de catalogus beheren.",
        403,
      );
    if (error.message.includes("CATALOGUE_NOT_READY"))
      throw new AdminError(
        "Niet alle te publiceren beelden hebben een gecontroleerde preview. Verwerk eerst de ontbrekende beelden.",
        409,
      );
    if (error.message.includes("CATALOGUE_CHANGED"))
      throw new AdminError(
        "Deze import is gewijzigd of al gepubliceerd. Vernieuw het overzicht.",
        409,
      );
    throw Error("CATALOGUE_DATABASE");
  }
  return result;
}
export async function preparePreview(actor: string, batch: string, id: string) {
  const entry = await catalogueAction(actor, "entry", { batch_id: batch, id });
  if (entry.preview_status === "ready") return { ready: true };
  if (entry.batch_status !== "draft") throw Error("CATALOGUE_CHANGED");
  try {
    const client = serviceClient(),
      { tokens, metadata } = await currentConnection(client, true);
    const original = await fetchOriginal(
        tokens.accessToken,
        metadata.driveId,
        entry.source_path,
      ),
      preview = await watermarkedPreview(original),
      key = `${batch}/${id}-${preview.fingerprint}.jpg`;
    const { error } = await client.storage
      .from(previewBucket)
      .upload(key, preview.bytes, {
        contentType: "image/jpeg",
        upsert: false,
        cacheControl: "3600",
      });
    if (error && error.statusCode !== "409" && Number(error.statusCode) !== 409)
      throw Error("CATALOGUE_PREVIEW_STORAGE");
    await catalogueAction(actor, "ready", {
      batch_id: batch,
      id,
      key,
      fingerprint: preview.fingerprint,
    });
    return { ready: true };
  } catch (e) {
    const code = e instanceof Error ? e.message : "";
    const safe =
      /^(CATALOGUE_SOURCE_(MISSING|UNAVAILABLE|MISMATCH|TOO_LARGE|FORMAT|PATH|REDIRECT)|CATALOGUE_PREVIEW_(TOO_LARGE|STORAGE)|NOT_CONNECTED|RECONNECT_REQUIRED|MICROSOFT_AUTH_FAILED|SAVE_FAILED)$/.test(
        code,
      )
        ? code
        : "CATALOGUE_PREVIEW_FAILED";
    await catalogueAction(actor, "failed", {
      batch_id: batch,
      id,
      error_code: safe,
    });
    throw new AdminError(
      "De preview kon niet worden voorbereid. Controleer de bestandslocatie, het formaat of de OneDrive-koppeling. Controlecode: " +
        safe,
      503,
    );
  }
}
export async function storedPreview(key: string) {
  const { data, error } = await serviceClient()
    .storage.from(previewBucket)
    .download(key);
  if (error || !data) throw Error("CATALOGUE_PREVIEW_STORAGE");
  return new Uint8Array(await data.arrayBuffer());
}
