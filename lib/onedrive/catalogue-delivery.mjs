import { trustedDownloadUrl } from "./download.mjs";
/** Issue one temporary Microsoft delivery URL after the app has checked a purchase right. */
export async function catalogueDelivery(token, driveId, path, fetcher = fetch) {
  if (
    !driveId ||
    typeof path !== "string" ||
    !path.startsWith("Rechtbanktekeningen/Beelden/") ||
    path.split("/").some((p) => !p || p === "." || p === "..") ||
    /[\\\x00-\x1f:#?%]/.test(path)
  )
    throw Error("DOWNLOAD_SOURCE_INVALID");
  const base =
    "https://graph.microsoft.com/v1.0/drives/" + encodeURIComponent(driveId);
  const options = {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  };
  const response = await fetcher(
    base +
      "/root:/" +
      path.split("/").map(encodeURIComponent).join("/") +
      "?$select=id,name,size,file,parentReference",
    options,
  );
  if (!response.ok)
    throw Error(
      response.status === 404
        ? "DOWNLOAD_SOURCE_MISSING"
        : "DOWNLOAD_PROVIDER_UNAVAILABLE",
    );
  const file = await response.json();
  if (
    typeof file.id !== "string" ||
    !file.file ||
    file.parentReference?.driveId !== driveId ||
    file.name !== path.split("/").at(-1) ||
    !Number.isSafeInteger(file.size) ||
    file.size < 1 ||
    file.size > 2147483647
  )
    throw Error("DOWNLOAD_SOURCE_INVALID");
  const delivery = await fetcher(
    base + "/items/" + encodeURIComponent(file.id) + "/content",
    { ...options, signal: AbortSignal.timeout(15000) },
  );
  if (![301, 302, 303, 307, 308].includes(delivery.status)) {
    await delivery.body?.cancel();
    throw Error("DOWNLOAD_PROVIDER_UNAVAILABLE");
  }
  return {
    location: trustedDownloadUrl(delivery.headers.get("location")),
    size: file.size,
    name: file.name,
  };
}
