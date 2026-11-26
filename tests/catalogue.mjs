import {
  classifyPreviewFailure,
  sourceHttpFailure,
  runPreviewAttempt,
  PreviewServiceError,
} from "../lib/catalogue/failures.mjs";
import { normaliseCatalogueStatus } from "../lib/catalogue/status.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { PGlite } from "@electric-sql/pglite";
import {
  columns,
  parseCatalogue,
  sourcePath,
  catalogueDate,
} from "../lib/catalogue/csv.mjs";
import {
  fetchOriginal,
  watermarkedPreview,
  readBounded,
} from "../lib/catalogue/preview.mjs";
const csv = (records) =>
  columns.join(";") +
  "\r\n" +
  records
    .map((r) =>
      columns
        .map((c) => '"' + String(r[c] ?? "").replaceAll('"', '""') + '"')
        .join(";"),
    )
    .join("\r\n");
const record = (key = "voorbeeld.jpg", other = {}) => ({
  beeldsleutel: key,
  beeld_map: "Beelden\\2024\\3-maart\\week-12",
  publiceren: "Ja",
  download: "Ja",
  datum_zitting: "Tuesday, March 19, 2024",
  rechtbank: "Utrecht",
  naam_verdachte: "Voorbeeld A|Voorbeeld B",
  naam_advocaat: "mr. Test",
  omschrijving_zaak: 'Een zaak; met "quotes"\nen een nieuwe regel',
  ...other,
});
test("catalogue import parses Excel CSV, exact paths, lists and dates; fails closed on duplicates and invalid values", () => {
  const r = parseCatalogue(
    "\uFEFF" +
      csv([
        record(),
        record("ander.tiff", {
          download: "",
          datum_feit: "2020-05-04 0:00:00",
          rechtbank: "",
        }),
      ]),
  );
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].date, "2024-03-19");
  assert.equal(r.rows[1].crimeDate, "2020-05-04");
  assert.equal(r.rows[1].download, false);
  assert.equal(r.warnings.length, 2);
  assert.deepEqual(r.rows[0].suspects, ["Voorbeeld A", "Voorbeeld B"]);
  assert.equal(
    r.rows[0].source_path,
    "Rechtbanktekeningen/Beelden/2024/3-maart/week-12/voorbeeld.jpg",
  );
  assert.equal(r.rows[0].title, 'Een zaak; met "quotes"\nen een nieuwe regel');
  assert.equal(
    parseCatalogue(csv([record(), record("VOORBEELD.JPG")])).errors.length,
    1,
  );
  assert.equal(
    parseCatalogue(csv([record("x.jpg", { download: "misschien" })])).errors
      .length,
    1,
  );
  for (const folder of [
    "Beelden/../privé",
    "C:\\Users\\test",
    "Beelden/%2e%2e",
    "Beelden//2024",
    "https://example.test",
    "Beelden/.",
  ])
    assert.throws(() => sourcePath(folder, "x.jpg"));
  for (const key of ["../x.jpg", "x.svg", "x.jpg?download=1", "a/b.jpg"])
    assert.throws(() => sourcePath("Beelden/2024", key));
  assert.throws(() => catalogueDate("2024-02-30"));
  assert.throws(() => parseCatalogue("beeldsleutel,beeld_map\na,b"));
  assert.throws(() => parseCatalogue(csv([record()]) + '"'));
  assert.throws(() => parseCatalogue("\uFFFD"));
  const id = r.rows[0].id;
  assert.equal(parseCatalogue(csv([record("VOORBEELD.JPG")])).rows[0].id, id);
});
test("private OneDrive originals are bounded, pinned to the linked drive, and never send bearer tokens to delivery hosts", async () => {
  const calls = [];
  const metadata = {
    id: "image",
    name: "voorbeeld.jpg",
    size: 3,
    file: { mimeType: "image/jpeg" },
    parentReference: { driveId: "owner-drive" },
  };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("?$select")) return Response.json(metadata);
    if (url.endsWith("/content"))
      return new Response(null, {
        status: 302,
        headers: { location: "https://files.1drv.com/original?signed=secret" },
      });
    return new Response(new Uint8Array([1, 2, 3]));
  };
  const bytes = await fetchOriginal(
    "private-token",
    "owner-drive",
    "Rechtbanktekeningen/Beelden/2024/voorbeeld.jpg",
    fetcher,
  );
  assert.equal(bytes.length, 3);
  assert.ok(calls[0].url.includes("/drives/owner-drive/"));
  assert.equal(calls[0].options.headers.Authorization, "Bearer private-token");
  assert.equal(calls[2].options.headers, undefined);
  await assert.rejects(
    fetchOriginal(
      "token",
      "owner-drive",
      "Rechtbanktekeningen/Beelden/../x.jpg",
      fetcher,
    ),
  );
  await assert.rejects(
    fetchOriginal(
      "token",
      "owner-drive",
      "Rechtbanktekeningen/Beelden/2024/voorbeeld.jpg",
      async () =>
        Response.json({
          ...metadata,
          parentReference: { driveId: "someone-else" },
        }),
    ),
    /MISMATCH/,
  );
  await assert.rejects(
    fetchOriginal(
      "token",
      "owner-drive",
      "Rechtbanktekeningen/Beelden/2024/voorbeeld.jpg",
      async (url) =>
        url.includes("?$select")
          ? Response.json(metadata)
          : new Response(null, {
              status: 302,
              headers: { location: "https://attacker.example/image" },
            }),
    ),
    /HOST_BLOCKED/,
  );
  await assert.rejects(
    readBounded(
      new Response("x", {
        headers: { "content-length": String(65 * 1024 * 1024) },
      }),
    ),
    /TOO_LARGE/,
  );
});
test("previews have bounded dimensions, strip metadata, render repeated visible watermarks and support TIFF", async () => {
  for (const format of ["jpeg", "png", "tiff"]) {
    const original = await sharp({
      create: { width: 1900, height: 1300, channels: 3, background: "#777777" },
    })
      .withMetadata({ exif: { IFD0: { Copyright: "PRIVATE ORIGINAL" } } })
      [format]()
      .toBuffer();
    const result = await watermarkedPreview(original),
      metadata = await sharp(result.bytes).metadata();
    assert.ok(metadata.width <= 1400 && metadata.height <= 1100);
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.exif, undefined);
    assert.ok(result.bytes.length < 1048576);
    assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
    const stats = await sharp(result.bytes).stats();
    assert.ok(
      stats.channels[0].stdev > 4,
      "watermark varies over a previously uniform image",
    );
  }
  await assert.rejects(
    watermarkedPreview(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
      ),
    ),
    /FORMAT/,
  );
});
test("catalogue SQL keeps sources/drafts private, blocks premature publication and atomically switches complete catalogues", async () => {
  const db = new PGlite();
  const admin = "ab74ba00-4f8e-4ee0-8479-bee145211f16",
    buyer = randomUUID(),
    batch = randomUUID();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
    );
    const migration = async (n) =>
      db.exec(
        await readFile(
          new URL(`../database/migrations/${n}.sql`, import.meta.url),
          "utf8",
        ),
      );
    await migration("001_accounts");
    for (const id of [admin, buyer])
      await db.query("insert into auth.users values($1,$2,now())", [
        id,
        {
          first_name: "Test",
          last_name: "Persoon",
          requested_company_name: "Voorbeeld",
          requested_kvk: "77328949",
        },
      ]);
    await db.exec(
      "insert into public.companies(name,kvk_number) values('Voorbeeld','77328949');update public.profiles set status='approved',company_id=(select id from public.companies limit 1),reviewed_at=now()",
    );
    await migration("004_onedrive_connection");
    await migration("017_catalogue_import");
    await migration("018_catalogue_status_filter");
    const parsed = parseCatalogue(
      csv([
        record(),
        record("alleen-zichtbaar.png", { download: "Nee" }),
        record("verborgen.jpg", { publiceren: "Nee" }),
      ]),
    );
    const action = async (a, data = {}, actor = admin) =>
      (
        await db.query("select public.server_catalogue($1,$2,$3) r", [
          actor,
          a,
          data,
        ])
      ).rows[0].r;
    const publicRows = async () =>
      (await db.query("select public.catalogue_public_rows() r")).rows[0].r;
    await db.exec("set role service_role");
    const empty = await action("status");
    assert.equal(
      empty.batch.id,
      null,
      "PostgreSQL returns a typed row of nulls before the first import",
    );
    assert.equal(
      normaliseCatalogueStatus(empty).batch,
      null,
      "the API must expose an absent import as null",
    );
    assert.equal(normaliseCatalogueStatus({ batch: null }).batch, null);
    await assert.rejects(
      action(
        "stage",
        {
          batch_id: batch,
          hash: parsed.hash,
          rows: parsed.rows,
          summary: parsed.summary,
          warnings: parsed.warnings,
        },
        buyer,
      ),
      /ADMIN_REQUIRED/,
    );
    await action("stage", {
      batch_id: batch,
      hash: parsed.hash,
      rows: parsed.rows,
      summary: parsed.summary,
      warnings: parsed.warnings,
    });
    assert.equal((await publicRows()).active, false);
    await assert.rejects(action("publish", { batch_id: batch }), /NOT_READY/);
    let state = await action("status", { batch_id: batch });
    assert.equal(normaliseCatalogueStatus(state).batch.id, batch);
    assert.equal(state.counts.requested, 2);
    assert.equal(state.counts.pending, 2);
    const ids = await action("next", { batch_id: batch });
    assert.equal(ids.length, 2);
    const fingerprint = "a".repeat(64);
    for (const row of parsed.rows.filter((r) => r.publish)) {
      await action("ready", {
        batch_id: batch,
        id: row.id,
        fingerprint,
        key: `${batch}/${row.id}-${fingerprint}.jpg`,
      });
    }
    assert.equal((await action("status", { batch_id: batch })).counts.ready, 2);
    assert.equal((await publicRows()).drawings.length, 0);
    assert.equal(
      (
        await action("draft_preview", { batch_id: batch, id: ids[0] })
      ).key.includes(batch),
      true,
    );
    await action("publish", { batch_id: batch });
    let result = await publicRows();
    assert.equal(result.active, true);
    assert.equal(result.drawings.length, 2);
    assert.equal(
      result.drawings.find((x) => x.key === "alleen-zichtbaar.png")
        .downloadAllowed,
      false,
    );
    assert.ok(!JSON.stringify(result).includes("source_path"));
    assert.ok(!JSON.stringify(result).includes("Rechtbanktekeningen"));
    assert.ok(!JSON.stringify(result).includes("beeld_map"));
    assert.equal(
      (
        await action(
          "public_preview",
          { id: ids[0], version: fingerprint },
          null,
        )
      ).key.startsWith(batch),
      true,
    );
    assert.equal(
      (
        await action(
          "public_preview",
          { id: parsed.rows[2].id, version: fingerprint },
          null,
        )
      ).key,
      null,
    );
    await assert.rejects(
      action("ready", {
        batch_id: batch,
        id: ids[0],
        fingerprint,
        key: `${batch}/${ids[0]}-${fingerprint}.jpg`,
      }),
      /CHANGED/,
    );
    const replacement = randomUUID(),
      other = parseCatalogue(csv([record("nieuwe-catalogus.jpg")]));
    await action("stage", {
      batch_id: replacement,
      hash: other.hash,
      rows: other.rows,
      summary: other.summary,
      warnings: other.warnings,
    });
    await assert.rejects(
      action("publish", { batch_id: replacement }),
      /NOT_READY/,
    );
    assert.equal((await publicRows()).drawings.length, 2);
    const otherId = other.rows[0].id;
    await action("ready", {
      batch_id: replacement,
      id: otherId,
      fingerprint,
      key: `${replacement}/${otherId}-${fingerprint}.jpg`,
    });
    await action("publish", { batch_id: replacement });
    assert.equal((await publicRows()).drawings.length, 1);
    assert.equal(
      (
        await action(
          "public_preview",
          { id: ids[0], version: fingerprint },
          null,
        )
      ).key,
      null,
    );
    // Filtering must include failures beyond the first unfiltered page and clamp after a retry removes the last row.
    const filterBatch = randomUUID(),
      many = parseCatalogue(
        csv(
          Array.from({ length: 63 }, (_, i) =>
            record(`beeld-${String(i).padStart(3, "0")}.jpg`),
          ),
        ),
      );
    await action("stage", {
      batch_id: filterBatch,
      hash: many.hash,
      rows: many.rows,
      summary: many.summary,
      warnings: many.warnings,
    });
    const failedRows = [...many.rows.slice(0, 50), many.rows[62]];
    for (const r of failedRows)
      await action("failed", {
        batch_id: filterBatch,
        id: r.id,
        error_code: "CATALOGUE_SOURCE_MISSING",
      });
    const filtered = async (status = "failed", page = 1, actor = admin) =>
      (
        await db.query("select public.server_catalogue_page($1,$2,$3,$4) r", [
          actor,
          filterBatch,
          status,
          page,
        ])
      ).rows[0].r;
    const lastPage = await filtered("failed", 2);
    assert.equal(lastPage.filtered_total, 51);
    assert.equal(lastPage.entries.length, 1);
    assert.equal(lastPage.entries[0].image_key, "beeld-062.jpg");
    assert.equal((await filtered("pending")).filtered_total, 12);
    assert.deepEqual((await filtered("ready")).entries, []);
    await assert.rejects(filtered("failed", 1, buyer), /ADMIN_REQUIRED/);
    await assert.rejects(filtered("unknown"), /CATALOGUE_INVALID/);
    await assert.rejects(filtered("failed", 0), /CATALOGUE_INVALID/);
    const retried = many.rows[62];
    await action("ready", {
      batch_id: filterBatch,
      id: retried.id,
      fingerprint,
      key: `${filterBatch}/${retried.id}-${fingerprint}.jpg`,
    });
    const afterRetry = await filtered("failed", 2);
    assert.equal(afterRetry.page, 1);
    assert.equal(afterRetry.filtered_total, 50);
    assert.equal(afterRetry.entries.length, 50);
    assert.ok(!afterRetry.entries.some((r) => r.id === retried.id));
    assert.equal(
      (await action("status", { batch_id: filterBatch })).counts.ready,
      1,
    );
    assert.equal(
      (await publicRows()).drawings.length,
      1,
      "status queries cannot change the live catalogue",
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(filtered(), /permission denied/);
    assert.equal((await publicRows()).drawings.length, 1);
    await assert.rejects(action("status"), /permission denied/);
    await assert.rejects(
      db.query("select * from private.catalogue_entries"),
      /permission denied/,
    );
    await db.exec("reset role;set role authenticated");
    await assert.rejects(filtered(), /permission denied/);
    await assert.rejects(
      action("publish", { batch_id: batch }),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("file failures are durably skipped, while service/unknown failures pause and leave pending work untouched", async () => {
  for (const code of [
    "CATALOGUE_SOURCE_MISSING",
    "CATALOGUE_SOURCE_MISMATCH",
    "CATALOGUE_SOURCE_TOO_LARGE",
    "CATALOGUE_SOURCE_DECODE",
    "CATALOGUE_SOURCE_FORMAT",
    "CATALOGUE_SOURCE_EMPTY",
  ]) {
    const saved = [];
    const result = await runPreviewAttempt(
      "voorbeeld.jpg",
      async () => {
        throw Error(code);
      },
      async (value) => saved.push(value),
    );
    assert.deepEqual(saved, [code]);
    assert.equal(result.ready, false);
    assert.equal(result.scope, "file");
    assert.equal(result.failed, true);
  }
  for (const error of [
    sourceHttpFailure(401),
    sourceHttpFailure(403),
    sourceHttpFailure(429),
    sourceHttpFailure(503),
    Error("NOT_CONNECTED"),
    Error("RECONNECT_REQUIRED"),
    Error("CATALOGUE_PREVIEW_STORAGE"),
    Error("network timeout: signed-url-or-private-token"),
  ]) {
    let saved = false;
    await assert.rejects(
      runPreviewAttempt(
        "voorbeeld.jpg",
        async () => {
          throw error;
        },
        async () => {
          saved = true;
        },
      ),
      (e) =>
        e instanceof PreviewServiceError &&
        !e.message.includes("private-token"),
    );
    assert.equal(
      saved,
      false,
      "a service problem must leave the current image pending",
    );
  }
  assert.equal(classifyPreviewFailure(sourceHttpFailure(404)).scope, "file");
  await assert.rejects(
    watermarkedPreview(Buffer.from([255, 216, 255, 0, 0])),
    /CATALOGUE_SOURCE_DECODE/,
  );
  const success = await runPreviewAttempt(
    "voorbeeld.jpg",
    async () => ({ ready: true }),
    async () => assert.fail("a ready preview cannot be failed"),
  );
  assert.equal(success.ready, true);
  await assert.rejects(
    runPreviewAttempt(
      "voorbeeld.jpg",
      async () => {
        throw Error("CATALOGUE_SOURCE_MISSING");
      },
      async () => {
        throw Error("DATABASE_UNAVAILABLE");
      },
    ),
    /DATABASE_UNAVAILABLE/,
  );
});
