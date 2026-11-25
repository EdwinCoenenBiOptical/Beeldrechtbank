const fileCodes = new Set([
  "CATALOGUE_SOURCE_MISSING",
  "CATALOGUE_SOURCE_MISMATCH",
  "CATALOGUE_SOURCE_TOO_LARGE",
  "CATALOGUE_SOURCE_FORMAT",
  "CATALOGUE_SOURCE_PATH",
  "CATALOGUE_SOURCE_EMPTY",
  "CATALOGUE_SOURCE_DECODE",
  "CATALOGUE_PREVIEW_TOO_LARGE",
]);
const serviceCodes = new Set([
  "CATALOGUE_SOURCE_UNAVAILABLE",
  "CATALOGUE_SOURCE_AUTH",
  "CATALOGUE_SOURCE_ACCESS",
  "CATALOGUE_SOURCE_RATE_LIMIT",
  "CATALOGUE_SOURCE_REDIRECT",
  "CATALOGUE_PREVIEW_STORAGE",
  "NOT_CONNECTED",
  "RECONNECT_REQUIRED",
  "MICROSOFT_AUTH_FAILED",
  "SAVE_FAILED",
  "CATALOGUE_DATABASE",
]);
export function sourceHttpFailure(status) {
  return new Error(
    status === 404 || status === 410
      ? "CATALOGUE_SOURCE_MISSING"
      : status === 401
        ? "CATALOGUE_SOURCE_AUTH"
        : status === 403
          ? "CATALOGUE_SOURCE_ACCESS"
          : status === 429
            ? "CATALOGUE_SOURCE_RATE_LIMIT"
            : "CATALOGUE_SOURCE_UNAVAILABLE",
  );
}
export function classifyPreviewFailure(error) {
  const raw = error instanceof Error ? error.message : "";
  const scope = fileCodes.has(raw) ? "file" : "service";
  const code =
    fileCodes.has(raw) || serviceCodes.has(raw)
      ? raw
      : "CATALOGUE_PREVIEW_FAILED";
  return { scope, code };
}
export class PreviewServiceError extends Error {
  constructor(code) {
    super(
      "De verwerking is gepauzeerd door een verbindings- of opslagprobleem. Controleer de OneDrive-koppeling of probeer later opnieuw. Controlecode: " +
        code,
    );
    this.name = "PreviewServiceError";
    this.code = code;
  }
}

export async function runPreviewAttempt(imageKey, work, recordFailure) {
  try {
    return await work();
  } catch (error) {
    const { scope, code } = classifyPreviewFailure(error);
    if (scope === "file") {
      await recordFailure(code);
      return {
        ready: false,
        failed: true,
        scope,
        code,
        image_key: imageKey,
        error:
          "Dit bestand kon niet als preview worden verwerkt. Controlecode: " +
          code,
      };
    }
    // Unknown outcomes, credentials, rate limits and storage failures are not file failures.
    throw new PreviewServiceError(code);
  }
}
