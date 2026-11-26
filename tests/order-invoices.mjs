import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import {
  contactSummary,
  invoiceRecipient,
} from "../lib/moneybird/contacts.mjs";
import {
  createMoneybirdInvoices,
  invoiceSummary,
  InvoiceWriteError,
  buildInvoicePlan,
} from "../lib/moneybird/invoices.mjs";
import {
  buildOrderInvoicePlan,
  runOrderInvoice,
} from "../lib/moneybird/order-invoices.mjs";
const admin = "ab74ba00-4f8e-4ee0-8479-bee145211f16",
  buyer = randomUUID(),
  otherBuyer = randomUUID(),
  administration = "98765432109876543210",
  contactId = "12345678901234567890",
  taxId = "11111111111111111",
  ledgerId = "22222222222222222";
const contact = contactSummary({
    id: contactId,
    company_name: "Voorbeeldbedrijf",
    chamber_of_commerce: "77328949",
    email: "koper@example.test",
    send_invoices_to_email: "facturen@example.test",
    address1: "Voorbeeldstraat 1",
    zipcode: "1234 AB",
    city: "Utrecht",
    country: "NL",
  }),
  options = {
    tax_rates: [{ id: taxId, name: "21% verkoop" }],
    ledger_accounts: [
      { id: ledgerId, name: "Download", account_code: "80300" },
    ],
  };
const planFor = (source) =>
  buildOrderInvoicePlan(
    source,
    contact,
    invoiceRecipient(contact, null),
    options,
  );
function rawInvoice(plan, id = "33333333333333333") {
  return {
    id,
    contact_id: plan.contact_id,
    contact_person_id: plan.contact_person_id,
    reference: plan.reference,
    state: "draft",
    version: 1,
    invoice_id: null,
    invoice_date: "2026-01-01",
    sent_at: null,
    currency: "EUR",
    prices_are_incl_tax: false,
    total_price_excl_tax: (plan.amount_cents / 100).toFixed(2),
    total_price_incl_tax: (plan.total_cents / 100).toFixed(2),
    details: plan.items.map((i) => ({
      description: i.description,
      amount: "1",
      price: (i.amount_cents / 100).toFixed(2),
      tax_rate_id: plan.tax_rate_id,
      ledger_account_id: plan.ledger_account_id,
    })),
    contact: { company_name: plan.contact_name, country: "NL" },
  };
}
function sourceFixture() {
  return {
    order: {
      id: randomUUID(),
      order_number: 8,
      company_name_snapshot: "Voorbeeldbedrijf",
      is_test: false,
      customer_reference: "PO-001",
    },
    company: { id: randomUUID(), kvk_number: "77328949" },
    buyer_email: "koper@example.test",
    link: {
      administration_id: administration,
      contact_id: contactId,
      revision: 1,
    },
    items: [
      {
        drawing_title_snapshot: "Zaakvoorbeeld",
        purpose_name_snapshot: "Online",
        image_key: "voorbeeld.jpg",
        amount_cents: 10000,
        vat_cents: 2100,
        total_cents: 12100,
        vat_percent: 21,
        currency: "EUR",
      },
    ],
  };
}
test("real invoice plan uses company billing recipient, exact PO and amounts, fixed tax/80300 and order marker; test invoices stay self-only", async () => {
  const source = sourceFixture(),
    plan = planFor(source);
  assert.equal(plan.recipient_email, "facturen@example.test");
  assert.equal(plan.reference, "PO-001");
  assert.equal(plan.total_cents, 12100);
  assert.equal(plan.ledger_account_code, "80300");
  assert.ok(plan.items[0].description.includes("bestelling 8 -"));
  assert.ok(!plan.items[0].description.includes("Proeffactuur"));
  assert.ok(plan.items[0].description.includes("voorbeeld.jpg"));
  assert.throws(
    () => planFor({ ...source, order: { ...source.order, is_test: true } }),
    /REAL_ONLY/,
  );
  assert.throws(
    () =>
      buildInvoicePlan(
        source,
        contact,
        invoiceRecipient(contact, null),
        options,
      ),
    /SELF_ONLY/,
  );
  assert.throws(
    () =>
      buildOrderInvoicePlan(
        source,
        { ...contact, country: "BE" },
        invoiceRecipient(contact, null),
        options,
      ),
    /DOMESTIC_ONLY/,
  );
  assert.throws(
    () =>
      buildOrderInvoicePlan(
        source,
        contact,
        { id: null, email: "bad@example.test\r\nBcc: other@example.test" },
        options,
      ),
    /RECIPIENT/,
  );
  assert.throws(
    () =>
      buildOrderInvoicePlan(source, contact, invoiceRecipient(contact, null), {
        ...options,
        ledger_accounts: [],
      }),
    /FIXED_SETTINGS/,
  );
  assert.throws(
    () =>
      planFor({ ...source, items: [{ ...source.items[0], vat_cents: 2000 }] }),
    /INVOICE_PLAN/,
  );
  const requests = [];
  const client = createMoneybirdInvoices(
    { token: "fictional-token", administrationId: administration },
    async (url, request) => {
      requests.push({ url: String(url), ...request });
      if (request.method === "POST")
        return Response.json({ id: "33333333333333333" });
      if (String(url).includes("/sales_invoices/"))
        return Response.json(rawInvoice(plan));
      return Response.json([rawInvoice(plan)]);
    },
  );
  assert.equal(await client.findForPlan(plan), "33333333333333333");
  await client.create(plan);
  assert.equal(requests.filter((r) => r.method === "POST").length, 1);
  assert.ok(!requests.some((r) => r.method === "PATCH"));
  const payload = JSON.parse(requests.find((r) => r.method === "POST").body);
  assert.equal(payload.sales_invoice.reference, "PO-001");
  assert.equal(payload.sales_invoice.details_attributes[0].price, "100.00");
});
test("real invoice ledger queues only future real orders, enforces tenant/admin access, recovers a timed-out create without a second POST and never sends", async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb,email_confirmed_at timestamptz,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
    );
    const migrate = async (name) =>
      db.exec(
        await readFile(
          new URL("../database/migrations/" + name + ".sql", import.meta.url),
          "utf8",
        ),
      );
    await migrate("001_accounts");
    for (const id of [admin, buyer, otherBuyer])
      await db.query("insert into auth.users values($1,$2,now(),$3)", [
        id,
        {
          first_name: "Test",
          last_name: "Persoon",
          requested_company_name: "Voorbeeldbedrijf",
          requested_kvk: "77328949",
        },
        id === buyer ? "koper@example.test" : id + "@example.test",
      ]);
    const company = (
        await db.query(
          "insert into public.companies(name,kvk_number) values('Voorbeeldbedrijf','77328949') returning id",
        )
      ).rows[0].id,
      other = (
        await db.query(
          "insert into public.companies(name,kvk_number) values('Anderbedrijf','84957476') returning id",
        )
      ).rows[0].id;
    await db.query(
      "update public.profiles set status='approved',company_id=$1,reviewed_at=now()",
      [company],
    );
    await db.query("update public.profiles set company_id=$1 where id=$2", [
      other,
      otherBuyer,
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
      await migrate(name);
    const purpose = (
        await db.query(
          "select id from public.usage_purposes where name='Online'",
        )
      ).rows[0].id,
      agreement = (
        await db.query("select agreement_id from public.checkout_settings")
      ).rows[0].agreement_id;
    const addOrder = async (isTest = false, items = 1) => {
      await db.exec("reset role");
      const order = (
        await db.query(
          "insert into public.orders(company_id,user_id,company_name_snapshot,is_test,customer_reference) values($1,$2,$3,$4,$5) returning id",
          [company, buyer, "Voorbeeldbedrijf", isTest, "PO-001"],
        )
      ).rows[0].id;
      for (let n = 0; n < items; n++) {
        const image = randomUUID();
        await db.query(
          "insert into public.catalogue_drawings(id,catalogue_key,title,published,is_test) values($1,$2,$3,false,$4)",
          [image, "CAT-" + image, "Zaakvoorbeeld", isTest],
        );
        const item = (
          await db.query(
            "insert into public.order_items(order_id,company_id,drawing_id,purpose_id,drawing_title_snapshot,purpose_name_snapshot,amount_cents,vat_percent,vat_cents,total_cents,currency,agreement_id,agreement_text_snapshot) values($1,$2,$3,$4,'Zaakvoorbeeld','Online',10000,21,2100,12100,'EUR',$5,'Akkoord') returning id",
            [order, company, image, purpose, agreement],
          )
        ).rows[0].id;
        await db.query(
          "insert into public.usage_rights(order_item_id) values($1)",
          [item],
        );
        if (!isTest)
          await db.query(
            "insert into private.catalogue_order_sources(order_item_id,image_id,source_path,image_key) values($1,$2,$3,$4)",
            [
              item,
              image,
              "Rechtbanktekeningen/Beelden/2024/voorbeeld.jpg",
              "voorbeeld.jpg",
            ],
          );
      }
      return order;
    };
    const oldReal = await addOrder(),
      oldTest = await addOrder(true);
    await migrate("020_order_invoice_drafts");
    assert.equal(
      (await db.query("select count(*) n from private.order_invoice_jobs"))
        .rows[0].n,
      0,
    );
    const first = await addOrder(false, 2),
      newTest = await addOrder(true);
    assert.equal(
      (await db.query("select count(*) n from private.order_invoice_jobs"))
        .rows[0].n,
      1,
      "multiple items enqueue one job; tests and old orders are not queued",
    );
    await db.query(
      "insert into private.moneybird_company_links(company_id,administration_id,contact_id,contact_snapshot,recipient_snapshot,revision,updated_by) values($1,$2,$3,$4,$5,1,$6)",
      [
        company,
        administration,
        contactId,
        { id: contactId, country: "NL" },
        { id: null, email: "facturen@example.test" },
        admin,
      ],
    );
    await db.query(
      "update private.moneybird_connection set encrypted_tokens='fictional-encrypted',administration_id=$1,reconnect_required=false",
      [administration],
    );
    const service = () => db.exec("reset role;set role service_role"),
      auth = (id) =>
        db.exec(
          `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`,
        );
    const call = async (
      action,
      order = null,
      owner = null,
      data = {},
      actor = admin,
    ) =>
      (
        await db.query(
          "select public.server_order_invoices($1,$2,$3,$4,$5) r",
          [actor, action, order, owner, data],
        )
      ).rows[0].r;
    const repository =
      (order, owner = randomUUID()) =>
      (action, data = {}) =>
        call(action, order, owner, data);
    await service();
    await assert.rejects(call("detail", newTest), /REAL_ONLY/);
    await assert.rejects(call("detail", oldTest), /REAL_ONLY/);
    await assert.rejects(call("detail", oldReal), /NOT_QUEUED/);
    await assert.rejects(
      call("overview", null, null, {}, buyer),
      /ADMIN_REQUIRED/,
    );
    let source = (await call("detail", first)).source,
      plan = planFor(source);
    assert.equal(plan.amount_cents, 20000);
    const stored = [];
    let writes = 0,
      sends = 0;
    const provider = {
      findForPlan: async (p) =>
        stored.find(
          (i) =>
            i.reference === p.reference &&
            i.details.some((d) => d.description.startsWith(p.order_marker)),
        )?.id || null,
      create: async (p) => {
        writes++;
        const invoice = invoiceSummary(
          rawInvoice(p, String(33000000000000000n + BigInt(writes))),
        );
        stored.push(invoice);
        return invoice.id;
      },
      get: async (id) => {
        const item = stored.find((i) => i.id === id);
        if (!item) throw Error("INVOICE_MISSING");
        return item;
      },
      send: async () => {
        sends++;
        assert.fail("regular draft flow may never send");
      },
    };
    let job = await runOrderInvoice({
      intent: "create",
      repository: repository(first),
      client: provider,
      plan,
    });
    assert.equal(job.status, "draft");
    assert.equal(writes, 1);
    await runOrderInvoice({
      intent: "create",
      repository: repository(first),
      client: provider,
      plan,
    });
    assert.equal(writes, 1);
    stored[0].state = "open";
    stored[0].sent_at = "2026-01-02T12:00:00Z";
    stored[0].invoice_number = "2026-0001";
    job = await runOrderInvoice({
      intent: "check",
      repository: repository(first),
      client: provider,
    });
    assert.equal(job.status, "issued");
    assert.equal(job.ever_issued, true);
    stored[0].state = "draft";
    stored[0].sent_at = null;
    job = await runOrderInvoice({
      intent: "check",
      repository: repository(first),
      client: provider,
    });
    assert.equal(
      job.status,
      "issued",
      "a prior issued invoice can never turn into a fresh draft",
    );
    const originalTotal = stored[0].total_cents;
    stored[0].total_cents++;
    await assert.rejects(
      runOrderInvoice({
        intent: "check",
        repository: repository(first),
        client: provider,
      }),
      /MISMATCH/,
    );
    assert.equal(
      (await call("overview", null, null, { status: "attention" })).orders.some(
        (r) => r.order_id === first,
      ),
      true,
      "issued documents with mismatches still need administrator attention",
    );
    stored[0].total_cents = originalTotal;
    await runOrderInvoice({
      intent: "check",
      repository: repository(first),
      client: provider,
    });
    const uncertain = await addOrder();
    await service();
    plan = planFor((await call("detail", uncertain)).source);
    const timeoutClient = {
      ...provider,
      create: async (p) => {
        await provider.create(p);
        throw new InvoiceWriteError("INVOICE_WRITE_UNCERTAIN", true);
      },
    };
    await assert.rejects(
      runOrderInvoice({
        intent: "create",
        repository: repository(uncertain),
        client: timeoutClient,
        plan,
      }),
      /WRITE_UNCERTAIN/,
    );
    assert.equal(
      (await call("detail", uncertain)).job.status,
      "create_uncertain",
    );
    const writesBefore = writes;
    job = await runOrderInvoice({
      intent: "create",
      repository: repository(uncertain),
      client: provider,
    });
    assert.equal(job.status, "draft");
    assert.equal(
      writes,
      writesBefore,
      "recovery must link the accepted invoice without another write",
    );
    const noResult = await addOrder();
    await service();
    plan = planFor((await call("detail", noResult)).source);
    const neverCreated = {
      ...provider,
      create: async () => {
        writes++;
        throw new InvoiceWriteError("INVOICE_WRITE_UNCERTAIN", true);
      },
    };
    await assert.rejects(
      runOrderInvoice({
        intent: "create",
        repository: repository(noResult),
        client: neverCreated,
        plan,
      }),
      /WRITE_UNCERTAIN/,
    );
    const unknownWrites = writes;
    await assert.rejects(
      runOrderInvoice({
        intent: "create",
        repository: repository(noResult),
        client: provider,
      }),
      /WRITE_UNCERTAIN/,
    );
    assert.equal(
      writes,
      unknownWrites,
      "zero matches after a timeout is not permission to retry",
    );
    const interrupted = await addOrder();
    await service();
    plan = planFor((await call("detail", interrupted)).source);
    const owner = randomUUID();
    await call("reserve", interrupted, owner, { intent: "create", plan });
    assert.equal(
      (await call("reserve", interrupted, randomUUID(), { intent: "check" }))
        .acquired,
      false,
    );
    await assert.rejects(call("release", interrupted, randomUUID()), /BUSY/);
    await call("creating", interrupted, owner);
    await db.exec("reset role");
    await db.query(
      "update private.order_invoice_jobs set lease_until=now()-interval '1 second' where order_id=$1",
      [interrupted],
    );
    await service();
    const beforeInterrupted = writes;
    await assert.rejects(
      runOrderInvoice({
        intent: "create",
        repository: repository(interrupted),
        client: provider,
      }),
      /WRITE_UNCERTAIN/,
    );
    assert.equal(
      writes,
      beforeInterrupted,
      "an expired lease must not undo a persisted creating fence",
    );
    const changed = await addOrder();
    await service();
    plan = planFor((await call("detail", changed)).source);
    const changedOwner = randomUUID();
    await call("reserve", changed, changedOwner, { intent: "create", plan });
    await db.exec("reset role");
    await db.query(
      "update private.moneybird_company_links set revision=2 where company_id=$1",
      [company],
    );
    await service();
    await assert.rejects(
      call("creating", changed, changedOwner),
      /PLAN_CHANGED/,
    );
    await call("release", changed, changedOwner);
    const rejected = await addOrder();
    await service();
    plan = planFor((await call("detail", rejected)).source);
    await assert.rejects(
      call("reserve", rejected, randomUUID(), {
        intent: "create",
        plan: { ...plan, total_cents: plan.total_cents + 1 },
      }),
      /PLAN_CHANGED/,
    );
    const rejectedClient = {
      ...provider,
      create: async () => {
        writes++;
        throw new InvoiceWriteError("INVOICE_PROVIDER_REJECTED", false);
      },
    };
    await assert.rejects(
      runOrderInvoice({
        intent: "create",
        repository: repository(rejected),
        client: rejectedClient,
        plan,
      }),
      /PROVIDER_REJECTED/,
    );
    assert.equal(
      (await call("detail", rejected)).job.status,
      "create_rejected",
    );
    job = await runOrderInvoice({
      intent: "create",
      repository: repository(rejected),
      client: provider,
      plan,
    });
    assert.equal(
      job.status,
      "draft",
      "a definite rejection permits a new explicit create",
    );
    const modified = stored.find((i) => i.id === job.invoice_id),
      originalContact = modified.contact_id;
    modified.contact_id = "77777777777777777";
    const beforeMismatch = writes;
    await assert.rejects(
      runOrderInvoice({
        intent: "check",
        repository: repository(rejected),
        client: provider,
      }),
      /MISMATCH/,
    );
    assert.equal((await call("detail", rejected)).job.status, "blocked");
    await assert.rejects(
      runOrderInvoice({
        intent: "create",
        repository: repository(rejected),
        client: provider,
      }),
      /MISMATCH/,
    );
    assert.equal(writes, beforeMismatch);
    modified.contact_id = originalContact;
    const missingId = (await call("detail", first)).job.invoice_id;
    stored.splice(
      stored.findIndex((i) => i.id === missingId),
      1,
    );
    await assert.rejects(
      runOrderInvoice({
        intent: "check",
        repository: repository(first),
        client: provider,
      }),
      /INVOICE_MISSING/,
    );
    job = (await call("detail", first)).job;
    assert.equal(job.status, "blocked");
    assert.equal(job.invoice_id, missingId);
    assert.equal(job.ever_issued, true);
    await auth(buyer);
    const visible = (
      await db.query("select public.company_order_invoices($1) r", [
        [first, uncertain],
      ])
    ).rows[0].r;
    assert.equal(visible.length, 2);
    assert.ok(!JSON.stringify(visible).includes("recipient_email"));
    await assert.rejects(call("overview"), /permission denied/);
    await assert.rejects(
      db.query("select * from private.order_invoice_jobs"),
      /permission denied/,
    );
    await auth(otherBuyer);
    assert.deepEqual(
      (
        await db.query("select public.company_order_invoices($1) r", [
          [first, uncertain],
        ])
      ).rows[0].r,
      [],
    );
    await db.exec("reset role;set role anon");
    await assert.rejects(
      db.query("select public.company_order_invoices($1)", [[first]]),
      /permission denied/,
    );
    assert.equal(sends, 0);
    await db.exec("reset role");
    assert.ok(
      (await db.query("select count(*) n from private.order_invoice_events"))
        .rows[0].n > 10,
    );
  } finally {
    await db.close();
  }
});
