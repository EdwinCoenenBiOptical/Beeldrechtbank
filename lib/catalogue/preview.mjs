import { sourceHttpFailure } from "./failures.mjs";
import { watermarkSvg } from "./watermark.mjs";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { trustedDownloadUrl } from "../onedrive/download.mjs";
const maxSourceBytes = 64 * 1024 * 1024;
export async function readBounded(response) {
  if (!response.ok) throw sourceHttpFailure(response.status);
  if (!response.body) throw Error("CATALOGUE_SOURCE_EMPTY");
  if (Number(response.headers.get("content-length")) > maxSourceBytes)
    throw Error("CATALOGUE_SOURCE_TOO_LARGE");
  const reader = response.body.getReader(),
    parts = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxSourceBytes) throw Error("CATALOGUE_SOURCE_TOO_LARGE");
      parts.push(value);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  } finally {
    reader.releaseLock();
  }
  if (!size) throw Error("CATALOGUE_SOURCE_EMPTY");
  return Buffer.concat(parts, size);
}
export async function fetchOriginal(token, driveId, path, fetcher = fetch) {
  if (
    !driveId ||
    typeof path !== "string" ||
    !path.startsWith("Rechtbanktekeningen/Beelden/") ||
    path.split("/").some((p) => !p || p === "." || p === "..") ||
    /[\x00-\x1f\\:#?%]/.test(path)
  )
    throw Error("CATALOGUE_SOURCE_PATH");
  const base =
    "https://graph.microsoft.com/v1.0/drives/" +
    encodeURIComponent(driveId) +
    "/root:/" +
    path.split("/").map(encodeURIComponent).join("/");
  const metadataResponse = await fetcher(
    base + "?$select=id,name,size,file,parentReference",
    {
      headers: { Authorization: "Bearer " + token },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!metadataResponse.ok) throw sourceHttpFailure(metadataResponse.status);
  const file = await metadataResponse.json();
  if (
    !file.file ||
    typeof file.id !== "string" ||
    file.parentReference?.driveId !== driveId ||
    file.name !== path.split("/").at(-1) ||
    !Number.isSafeInteger(file.size) ||
    file.size < 1
  )
    throw Error("CATALOGUE_SOURCE_MISMATCH");
  if (file.size > maxSourceBytes) throw Error("CATALOGUE_SOURCE_TOO_LARGE");
  let response = await fetcher(
    "https://graph.microsoft.com/v1.0/drives/" +
      encodeURIComponent(driveId) +
      "/items/" +
      encodeURIComponent(file.id) +
      "/content",
    {
      headers: { Authorization: "Bearer " + token },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    },
  );
  for (
    let hops = 0;
    [301, 302, 303, 307, 308].includes(response.status);
    hops++
  ) {
    if (hops >= 3) throw Error("CATALOGUE_SOURCE_REDIRECT");
    const url = trustedDownloadUrl(response.headers.get("location"));
    response = await fetcher(url, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  }
  return readBounded(response);
}
export async function watermarkedPreview(original) {
  const { data: small, info } = await (async () => {
    try {
      const input = sharp(original, {
        limitInputPixels: 80000000,
        pages: 1,
        failOn: "error",
      });
      const metadata = await input.metadata();
      if (!["jpeg", "png", "tiff"].includes(metadata.format))
        throw Error("CATALOGUE_SOURCE_FORMAT");
      // Decode just the first page, orient before resizing, strip all original metadata.
      const decoded = await input
        .rotate()
        .resize({
          width: 1400,
          height: 1100,
          fit: "inside",
          withoutEnlargement: true,
        })
        .flatten({ background: "#fff" })
        .toColourspace("srgb")
        .jpeg({ quality: 80 })
        .toBuffer({ resolveWithObject: true });

      return decoded;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (
        code === "CATALOGUE_SOURCE_FORMAT" ||
        ["ENOMEM", "ENOSPC"].includes(error?.code)
      )
        throw error;
      throw Error("CATALOGUE_SOURCE_DECODE");
    }
  })();
  const width = info.width,
    height = info.height;
  const svg = watermarkSvg(width, height);
  const bytes = await sharp(small)
    .composite([{ input: svg }])
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer();
  if (bytes.length > 1048576) throw Error("CATALOGUE_PREVIEW_TOO_LARGE");
  return {
    bytes,
    fingerprint: createHash("sha256").update(bytes).digest("hex"),
    width,
    height,
  };
}
