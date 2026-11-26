import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { parseCatalogue, columns } from "../lib/catalogue/csv.mjs";
import { catalogueDelivery } from "../lib/onedrive/catalogue-delivery.mjs";
test("approved private catalogue checkout preserves company rights, prices, PO and mail uniqueness; outsiders and direct legacy bypasses are denied", async () => {
  const db = new PGlite({ extensions: { btree_gist } }),
    admin = "ab74ba00-4f8e-4ee0-8479-bee145211f16",
    buyer = randomUUID(),
    colleague = randomUUID(),
    outsider = randomUUID(),
    pending = randomUUID(),
    batch = randomUUID();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
    );
    const migration = async (name) =>
      db.exec(
        await readFile(
          new URL("../database/migrations/" + name + ".sql", import.meta.url),
          "utf8",
        ),
      );
    await migration("001_accounts");
    for (const id of [admin, buyer, colleague, outsider, pending])
      await db.query("insert into auth.users values($1,$2,now(),$3)", [
        id,
        {
          first_name: "Voorbeeld",
          last_name: "Persoon",
          requested_company_name: "Testbedrijf",
          requested_kvk: "77328949",
        },
        id + "@example.test",
      ]);
    const company = (
        await db.query(
          "insert into public.companies(name,kvk_number) values('Testbedrijf','77328949') returning id",
        )
      ).rows[0].id,
      other = (
        await db.query(
          "insert into public.companies(name,kvk_number) values('Ander','84957476') returning id",
        )
      ).rows[0].id;
    await db.query(
      "update public.profiles set status='approved',company_id=$1,reviewed_at=now() where id<>$2",
      [company, pending],
    );
    await db.query("update public.profiles set company_id=$1 where id=$2", [
      other,
      outsider,
    ]);
    for (const name of [
      "002_prices",
      "003_test_orders",
      "004_onedrive_connection",
      "005_test_downloads",
      "007_application_admin",
      "008_company_assignment",
      "009_company_downloads",
      "010_moneybird_contacts",
      "011_moneybird_oauth",
      "012_moneybird_contact_creation",
      "013_moneybird_invoice_trial",
      "014_order_customer_reference",
      "015_recover_deleted_invoice_draft",
      "016_order_confirmation_mail",
      "017_catalogue_import",
      "018_catalogue_status_filter",
      "019_private_portal_orders",
    ])
      await migration(name);
    await db.query(
      "insert into public.company_prices(company_id,purpose_id,amount_cents,currency,valid_from) select $1,id,10000,'EUR',current_date from public.usage_purposes",
      [company],
    );
    const purpose = (
        await db.query(
          "select id from public.usage_purposes where name='Online'",
        )
      ).rows[0].id,
      print = (
        await db.query(
          "select id from public.usage_purposes where name='Print'",
        )
      ).rows[0].id;
    const data = {
        beeldsleutel: "voorbeeld.jpg",
        beeld_map: "Beelden/2024/1-januari",
        publiceren: "Ja",
        download: "Ja",
        datum_zitting: "2024-01-02",
        rechtbank: "Utrecht",
        omschrijving_zaak: "Zaakvoorbeeld",
      },
      blocked = {
        ...data,
        beeldsleutel: "alleen-bekijken.tiff",
        download: "Nee",
      };
    const csv =
        columns.join(";") +
        "\n" +
        [data, blocked]
          .map((r) => columns.map((k) => r[k] || "").join(";"))
          .join("\n"),
      parsed = parseCatalogue(csv),
      image = parsed.rows[0].id,
      noDownload = parsed.rows[1].id,
      fingerprint = "a".repeat(64);
    const service = () => db.exec("reset role;set role service_role"),
      auth = (id) =>
        db.exec(
          `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`,
        );
    const action = async (a, d = {}) =>
      (
        await db.query("select public.server_catalogue($1,$2,$3) r", [
          admin,
          a,
          d,
        ])
      ).rows[0].r;
    const quote = async (id = image, p = purpose) =>
      (await db.query("select public.catalogue_order_quote($1,$2) q", [id, p]))
        .rows[0].q;
    const order = async (q, po = "PO-001", id = image, p = purpose) =>
      (
        await db.query(
          "select public.place_catalogue_order($1,$2,$3,$4,$5,true,$6) q",
          [id, p, q.agreement_id, q.amount_cents, q.agreement_text, po],
        )
      ).rows[0].q;
    const right = async (actor = buyer, p = purpose, item = null) =>
      (
        await db.query(
          "select public.server_catalogue_download($1,$2,$3,$4,$5) r",
          [actor, image, p, item, item ? 41943040 : null],
        )
      ).rows[0].r;
    await service();
    await action("stage", {
      batch_id: batch,
      hash: parsed.hash,
      rows: parsed.rows,
      summary: parsed.summary,
      warnings: [],
    });
    for (const r of parsed.rows)
      await action("ready", {
        batch_id: batch,
        id: r.id,
        fingerprint,
        key: `${batch}/${r.id}-${fingerprint}.jpg`,
      });
    await action("publish", { batch_id: batch });
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select public.catalogue_public_rows()"),
      /permission denied/,
    );
    await assert.rejects(quote(), /permission denied/);
    await assert.rejects(
      db.query("select private.catalogue_public_rows()"),
      /permission denied/,
    );
    await auth(pending);
    await assert.rejects(
      db.query("select public.catalogue_public_rows()"),
      /APPROVAL_REQUIRED/,
    );
    await assert.rejects(quote(), /APPROVAL_REQUIRED/);
    await auth(buyer);
    const catalogue = (
      await db.query("select public.catalogue_public_rows() r")
    ).rows[0].r;
    assert.equal(catalogue.drawings.length, 2);
    assert.ok(!JSON.stringify(catalogue).includes("source_path"));
    await assert.rejects(quote(noDownload), /DOWNLOAD_NOT_ALLOWED/);
    await service();
    await assert.rejects(right(), /DOWNLOAD_RIGHT_REQUIRED/);
    await db.exec(
      "reset role;update private.order_mail_settings set auto_enabled=true",
    );
    await auth(buyer);
    const q = await quote();
    assert.equal(q.owned, false);
    assert.equal(q.is_test, false);
    assert.equal(q.total_cents, 12100);
    await assert.rejects(order({ ...q, amount_cents: 1 }), /QUOTE_CHANGED/);
    await assert.rejects(
      order(q, "bad\nreference"),
      /CUSTOMER_REFERENCE_INVALID/,
    );
    await assert.rejects(
      db.query("select public.place_catalogue_order($1,$2,$3,$4,$5,false,$6)", [
        image,
        purpose,
        q.agreement_id,
        q.amount_cents,
        q.agreement_text,
        "PO-001",
      ]),
      /CONSENT_REQUIRED/,
    );
    const placed = await order(q);
    assert.equal(placed.owned, true);
    assert.equal(placed.is_test, false);
    assert.equal(placed.customer_reference, "PO-001");
    await assert.rejects(
      db.query("select public.test_order_quote($1,$2)", [
        "CAT-" + image,
        purpose,
      ]),
      /DRAWING_UNAVAILABLE/,
    );
    await assert.rejects(
      db.query("select public.server_catalogue_download($1,$2,$3)", [
        buyer,
        image,
        purpose,
      ]),
      /permission denied/,
    );
    await service();
    let r = await right();
    assert.equal(
      r.source_path,
      "Rechtbanktekeningen/Beelden/2024/1-januari/voorbeeld.jpg",
    );
    await right(buyer, purpose, r.order_item_id);
    await right(colleague, purpose, r.order_item_id);
    await assert.rejects(right(outsider), /DOWNLOAD_RIGHT_REQUIRED/);
    await assert.rejects(right(buyer, print), /DOWNLOAD_RIGHT_REQUIRED/);
    await db.exec("reset role");
    await db.query(
      "insert into private.moneybird_company_links(company_id,administration_id,contact_id,contact_snapshot,recipient_snapshot,revision,updated_by) values($1,'1','2',$2,'{}',1,$3)",
      [company, { id: "2", country: "BE" }, admin],
    );
    await auth(buyer);
    await assert.rejects(quote(), /DOMESTIC_ONLY/);
    await service();
    await assert.rejects(right(), /DOWNLOAD_RIGHT_REQUIRED/);
    await db.exec("reset role");
    await db.query(
      "update private.moneybird_company_links set contact_snapshot=jsonb_set(contact_snapshot,'{country}','\"NL\"') where company_id=$1",
      [company],
    );
    await db.query(
      "update auth.users set email_confirmed_at=null where id=$1",
      [buyer],
    );
    await auth(buyer);
    await assert.rejects(quote(), /APPROVAL_REQUIRED/);
    await service();
    await assert.rejects(right(), /DOWNLOAD_RIGHT_REQUIRED/);
    await db.exec("reset role");
    await db.query(
      "update auth.users set email_confirmed_at=now() where id=$1",
      [buyer],
    );
    await auth(colleague);
    const repeat = await order(await quote(), "OTHER-PO");
    assert.equal(repeat.order_id, placed.order_id);
    assert.equal(repeat.customer_reference, "PO-001");
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*) n from public.orders")).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select count(*) n from private.order_confirmation_mail"))
        .rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*) n from public.download_events where not is_test",
        )
      ).rows[0].n,
      2,
    );
    await db.query(
      "update public.company_prices set amount_cents=17500 where company_id=$1 and purpose_id=$2",
      [company, purpose],
    );
    await auth(colleague);
    assert.equal((await quote()).amount_cents, 10000);
    await db.exec("reset role");
    await db.query("update public.profiles set company_id=$1 where id=$2", [
      other,
      colleague,
    ]);
    await service();
    await assert.rejects(right(colleague), /DOWNLOAD_RIGHT_REQUIRED/);
    await db.exec("reset role");
    await db.query(
      "update public.profiles set status='suspended' where id=$1",
      [buyer],
    );
    await auth(buyer);
    await assert.rejects(
      db.query("select public.catalogue_public_rows()"),
      /APPROVAL_REQUIRED/,
    );
    await assert.rejects(quote(), /APPROVAL_REQUIRED/);
    await service();
    await assert.rejects(right(), /DOWNLOAD_RIGHT_REQUIRED/);
    await db.exec("reset role");
    await db.query("update public.profiles set status='approved' where id=$1", [
      buyer,
    ]);
    await db.query(
      "update private.catalogue_entries set download_allowed=false where batch_id=$1 and id=$2",
      [batch, image],
    );
    await service();
    await assert.rejects(right(), /DOWNLOAD_RIGHT_REQUIRED/);
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*) n from public.orders")).rows[0].n,
      1,
      "repeated downloads and failed access do not create orders",
    );
  } finally {
    await db.close();
  }
});
test("original delivery validates the linked drive and every private path before issuing a trusted URL without proxying a large file", async () => {
  const calls = [],
    metadata = {
      id: "file-id",
      name: "voorbeeld.tiff",
      size: 41943040,
      file: { mimeType: "image/tiff" },
      parentReference: { driveId: "owner-drive" },
    };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return url.includes("?$select")
      ? Response.json(metadata)
      : new Response(null, {
          status: 302,
          headers: {
            location: "https://files.1drv.com/original?signed=temporary",
          },
        });
  };
  const delivery = await catalogueDelivery(
    "private-token",
    "owner-drive",
    "Rechtbanktekeningen/Beelden/2024/voorbeeld.tiff",
    fetcher,
  );
  assert.equal(delivery.size, 41943040);
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every((c) => c.url.startsWith("https://graph.microsoft.com/")),
  );
  assert.ok(calls.every((c) => c.options.redirect === "manual"));
  assert.equal(delivery.name, "voorbeeld.tiff");
  await assert.rejects(
    catalogueDelivery(
      "token",
      "owner-drive",
      "Rechtbanktekeningen/Beelden/../x.jpg",
      fetcher,
    ),
    /SOURCE_INVALID/,
  );
  await assert.rejects(
    catalogueDelivery(
      "token",
      "owner-drive",
      "Rechtbanktekeningen/Beelden/2024/voorbeeld.tiff",
      async () =>
        Response.json({ ...metadata, parentReference: { driveId: "other" } }),
    ),
    /SOURCE_INVALID/,
  );
  await assert.rejects(
    catalogueDelivery(
      "token",
      "owner-drive",
      "Rechtbanktekeningen/Beelden/2024/voorbeeld.tiff",
      async (url) =>
        url.includes("?$select")
          ? Response.json(metadata)
          : new Response(null, {
              status: 302,
              headers: { location: "https://attacker.example/original" },
            }),
    ),
    /HOST_BLOCKED/,
  );
});
