import { createHash } from "node:crypto";
export const catalogueRoot = "Rechtbanktekeningen";
export const columns = [
  "beeldsleutel",
  "beeld_map",
  "publiceren",
  "download",
  "datum_zitting",
  "rechtbank",
  "naam_verdachte",
  "naam_advocaat",
  "omschrijving_zaak",
  "trefwoorden",
  "datum_feit",
  "plaats_feit",
  "soort_feit",
  "omschrijving_feit",
];
export class CatalogueError extends Error {}
const fail = (message) => {
  throw new CatalogueError(message);
};
export function csvRecords(text) {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024 ||
    text.includes("\uFFFD") ||
    text.includes("\0")
  )
    fail("Gebruik een CSV-bestand in UTF-8 van maximaal 2 MB.");
  text = text.replace(/^\uFEFF/, "");
  const records = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false;
  const cell = () => {
    row.push(field);
    field = "";
    closed = false;
  };
  const record = () => {
    cell();
    if (row.some((v) => v.trim())) records.push(row);
    row = [];
    if (records.length > 5001)
      fail("Er kunnen maximaal 5.000 beelden per import worden verwerkt.");
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed) fail("Ongeldige aanhalingstekens in de CSV.");
      quoted = true;
    } else if (c === ";") cell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      record();
    } else {
      if (closed) fail("Onverwachte tekst na een geciteerd CSV-veld.");
      field += c;
    }
  }
  if (quoted) fail("Een geciteerd CSV-veld is niet afgesloten.");
  if (field || row.length || closed) record();
  return records;
}
const months = {
  January: 1,
  February: 2,
  March: 3,
  April: 4,
  May: 5,
  June: 6,
  July: 7,
  August: 8,
  September: 9,
  October: 10,
  November: 11,
  December: 12,
};
export function catalogueDate(raw, optional = false) {
  if (!raw && optional) return "";
  let iso = raw.replace(/^(\d{4}-\d{2}-\d{2}) 0{1,2}:00:00$/, "$1");
  const match =
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Za-z]+) (\d{1,2}), (\d{4})$/.exec(
      raw,
    );
  if (match && months[match[1]])
    iso = `${match[3]}-${String(months[match[1]]).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(iso) ||
    !Number.isFinite(Date.parse(iso)) ||
    new Date(iso).toISOString().slice(0, 10) !== iso
  )
    fail("Ongeldige datum; gebruik JJJJ-MM-DD of de bestaande Engelse datum.");
  return iso;
}
export function sourcePath(folder, key) {
  const map = folder.replaceAll("\\", "/");
  if (
    !map.startsWith("Beelden/") ||
    map.split("/").some((p) => !p || p === "." || p === "..") ||
    /[\x00-\x1f:#?%]/.test(map) ||
    !key ||
    /[\\/\x00-\x1f:#?%]/.test(key) ||
    !/^.+\.(jpe?g|tiff?|png)$/i.test(key)
  )
    fail(
      "Ongeldig bestandspad of bestandsformaat. Gebruik Beelden/submap en een losse JPG-, PNG- of TIFF-bestandsnaam.",
    );
  return catalogueRoot + "/" + map + "/" + key;
}
const list = (raw) =>
  raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
export function stableImageId(key) {
  const hex = createHash("sha256")
    .update("beeldrechtbank/catalogue/v1/" + key.normalize("NFC").toLowerCase())
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function parseCatalogue(text) {
  const records = csvRecords(text),
    header = records.shift();
  if (
    !header ||
    header.length !== columns.length ||
    columns.some((c) => !header.includes(c)) ||
    new Set(header).size !== header.length
  )
    fail(
      "De CSV moet precies de afgesproken 14 kolommen bevatten, met puntkomma als scheidingsteken.",
    );
  const rows = [],
    errors = [],
    warnings = [],
    keys = new Set(),
    paths = new Set();
  for (const [i, values] of records.entries()) {
    const number = i + 2;
    try {
      if (values.length !== header.length)
        fail("Het aantal velden wijkt af van de kolomkoppen.");
      const r = Object.fromEntries(header.map((c, j) => [c, values[j].trim()]));
      if (
        Object.values(r).some(
          (v) => v.length > 8000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v),
        )
      )
        fail("Een veld is te lang of bevat ongeldige controletekens.");
      for (const flag of ["publiceren", "download"])
        if (
          !["ja", "nee", ...(flag === "download" ? [""] : [])].includes(
            r[flag].toLowerCase(),
          )
        )
          fail(`Vul Ja of Nee in bij ${flag}.`);
      const key = r.beeldsleutel,
        path = sourcePath(r.beeld_map, key),
        identity = key.normalize("NFC").toLowerCase();
      if (keys.has(identity) || paths.has(path.toLowerCase()))
        fail("Dubbele beeldsleutel of bestandsverwijzing.");
      keys.add(identity);
      paths.add(path.toLowerCase());
      const date = catalogueDate(r.datum_zitting),
        crimeDate = catalogueDate(r.datum_feit, true);
      const row = {
        id: stableImageId(key),
        key,
        source_path: path,
        publish: r.publiceren.toLowerCase() === "ja",
        download: r.download.toLowerCase() === "ja",
        title: r.omschrijving_zaak || key.replace(/\.[^.]+$/, ""),
        date,
        court: r.rechtbank,
        suspects: list(r.naam_verdachte),
        lawyers: list(r.naam_advocaat),
        caseName: r.omschrijving_zaak,
        keywords: list(r.trefwoorden),
        crimeDate,
        crimePlace: r.plaats_feit,
        crimeType: r.soort_feit,
        crimeDescription: r.omschrijving_feit,
      };
      rows.push(row);
      if (!r.download)
        warnings.push({
          row: number,
          key,
          message: "Downloadkeuze leeg: behandeld als Nee.",
        });
      if (!r.rechtbank)
        warnings.push({ row: number, key, message: "Rechtbank ontbreekt." });
      if (!r.omschrijving_zaak)
        warnings.push({
          row: number,
          key,
          message:
            "Zaakomschrijving ontbreekt; bestandsnaam wordt als titel gebruikt.",
        });
    } catch (e) {
      errors.push({ row: number, message: e.message });
    }
  }
  if (!records.length)
    errors.push({ row: 2, message: "De CSV bevat geen beelden." });
  return {
    rows,
    errors,
    warnings,
    summary: {
      total: records.length,
      valid: rows.length,
      publish: rows.filter((r) => r.publish).length,
      download: rows.filter((r) => r.download).length,
      downloadDisabled: rows.filter((r) => !r.download).length,
    },
    hash: createHash("sha256").update(text).digest("hex"),
  };
}
