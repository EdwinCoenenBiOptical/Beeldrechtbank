import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import {
  orderConfirmation,
  demoOrder,
  orderCopy,
  mailConfiguration,
  deliverOrder,
  smtpFailure,
} from "../lib/mail/order-confirmation.mjs";
import { rootnetTransport } from "../lib/mail/transport.mjs";
test("order email carries frozen prices/PO, safe HTML, fixed sender/reply/BCC and strict TLS; MIME hides BCC", async () => {
  const payload = demoOrder("customer@example.test");
  payload.company_name = "<script>bad</script>";
  payload.customer_reference = "PO-<img src=x>";
  const mail = orderConfirmation(payload, { test: true });
  assert.equal(mail.from.address, "info@beeldrechtbank.nl");
  assert.equal(mail.bcc, orderCopy);
  assert.equal(mail.replyTo, orderCopy);
  assert.deepEqual(mail.envelope.to, ["customer@example.test", orderCopy]);
  assert.ok(mail.text.includes("PO-<img src=x>"));
  assert.ok(mail.html.includes("PO-&lt;img src=x&gt;"));
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.text.includes("121,00"));
  assert.ok(mail.text.includes("21,00"));
  assert.ok(mail.text.includes("geen bestelling of factuur"));
  assert.equal(mail.attachments, undefined);
  assert.throws(
    () =>
      orderConfirmation(payload, {
        to: "recipient@example.test\r\nBcc: bad@example.test",
      }),
    /ORDER_MAIL_PAYLOAD/,
  );
  assert.throws(
    () =>
      orderConfirmation({
        ...payload,
        items: [{ ...payload.items[0], vat_cents: 2000 }],
      }),
    /ORDER_MAIL_PAYLOAD/,
  );
  const config = mailConfiguration({
    SMTP_HOST: "rootnet.email",
    SMTP_PORT: "587",
    SMTP_USER: "info@beeldrechtbank.nl",
    SMTP_PASSWORD: "fictional-password",
  });
  const transport = rootnetTransport(config);
  assert.equal(transport.options.secure, false);
  assert.equal(transport.options.requireTLS, true);
  assert.equal(transport.options.tls.rejectUnauthorized, true);
  assert.equal(transport.options.logger, false);
  assert.equal(transport.options.disableFileAccess, true);
  transport.close();
  const tls = rootnetTransport({ ...config, port: 465 });
  assert.equal(tls.options.secure, true);
  tls.close();
  assert.throws(
    () => mailConfiguration({ ...config, SMTP_HOST: "evil.example" }),
    /ORDER_SMTP_CONFIG/,
  );
  const stream = nodemailer.createTransport({
    name: "offline-mime-capture",
    version: "1",
    send(mail, callback) {
      mail.message.build((error, message) => callback(error, { message }));
    },
  });
  const info = await stream.sendMail(mail);
  const mime = info.message.toString();
  assert.match(mime, /^From: Beeldrechtbank <info@beeldrechtbank.nl>/m);
  assert.match(mime, /^To: customer@example.test/m);
  assert.doesNotMatch(mime, /^Bcc:/im);
  assert.match(mime, /^Reply-To: rechtbanktekeningen@nicolevandenhout.nl/m);
  assert.ok(mime.includes("text/plain"));
  assert.ok(mime.includes("text/html"));
});
test("SMTP acceptance differs from delivery; partial and unknown results must not be retried blindly", async () => {
  const message = orderConfirmation(demoOrder("customer@example.test"));
  assert.equal(
    (
      await deliverOrder(message, async () => ({
        accepted: message.envelope.to,
      }))
    ).status,
    "accepted",
  );
  assert.equal(
    (
      await deliverOrder(message, async () => ({
        accepted: ["customer@example.test"],
        rejected: [orderCopy],
      }))
    ).status,
    "partial",
  );
  assert.equal(
    (
      await deliverOrder(message, async () => {
        throw { code: "ETIMEDOUT", command: "DATA" };
      })
    ).status,
    "uncertain",
  );
  assert.equal(
    smtpFailure({
      code: "EAUTH",
      command: "AUTH PLAIN",
      message: "secret authentication data",
    }).status,
    "failed",
  );
  assert.equal(smtpFailure({ code: "EDNS" }).status, "failed");
  assert.equal(
    smtpFailure({ responseCode: 550, command: "DATA" }).status,
    "failed",
  );
  assert.ok(
    !JSON.stringify(
      smtpFailure({ code: "EAUTH", message: "secret authentication data" }),
    ).includes("secret authentication"),
  );
});
test("transactional mail outbox is off by default, snapshots final PO, ignores old/repeated orders and prevents duplicate/uncertain sends", async () => {
  const db = new PGlite({ extensions: { btree_gist } });
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to authenticated;`,
    );
    const load = async (n) =>
      db.exec(
        await readFile(
          new URL("../database/migrations/" + n + ".sql", import.meta.url),
          "utf8",
        ),
      );
    await load("001_accounts");
    const admin = "ab74ba00-4f8e-4ee0-8479-bee145211f16",
      buyer = "11111111-1111-1111-1111-111111111111",
      colleague = "22222222-2222-2222-2222-222222222222";
    for (const [id, email] of [
      [admin, "admin@example.test"],
      [buyer, "buyer@example.test"],
      [colleague, "colleague@example.test"],
    ])
      await db.query("insert into auth.users values($1,$2,$3,now())", [
        id,
        email,
        {
          first_name: "Test",
          last_name: "Persoon",
          requested_company_name: "Voorbeeld",
          requested_kvk: "77328949",
        },
      ]);
    const company = (
      await db.query(
        "insert into public.companies(name,kvk_number) values('Voorbeeld','77328949') returning id",
      )
    ).rows[0].id;
    await db.query(
      "update public.profiles set status='approved',company_id=$1,reviewed_at=now()",
      [company],
    );
    for (const n of [
      "002_prices",
      "003_test_orders",
      "004_onedrive_connection",
      "007_application_admin",
      "010_moneybird_contacts",
      "011_moneybird_oauth",
      "013_moneybird_invoice_trial",
      "014_order_customer_reference",
      "016_order_confirmation_mail",
    ])
      await load(n);
    await db.query(
      "insert into public.company_prices(company_id,purpose_id,amount_cents,currency,valid_from) select $1,id,10000,'EUR',current_date from public.usage_purposes",
      [company],
    );
    const purpose = (
      await db.query("select id from public.usage_purposes where name='Online'")
    ).rows[0].id;
    const auth = async (id) =>
        db.exec(
          `reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`,
        ),
      service = () => db.exec("reset role;set role service_role");
    const action = async (a, data = {}, actor = admin) =>
      (
        await db.query("select public.server_order_mail($1,$2,$3) r", [
          actor,
          a,
          data,
        ])
      ).rows[0].r;
    const place = async (key, ref) => {
      const q = (
        await db.query("select public.test_order_quote($1,$2) q", [
          key,
          purpose,
        ])
      ).rows[0].q;
      return (
        await db.query(
          "select public.place_test_order($1,$2,$3,$4,$5,true,$6) q",
          [key, purpose, q.agreement_id, q.amount_cents, q.agreement_text, ref],
        )
      ).rows[0].q.order_id;
    };
    await auth(buyer);
    const old = await place("NVH-0001", "PO-OLD");
    await assert.rejects(action("status"), /permission denied/);
    await service();
    await assert.rejects(action("status", {}, buyer), /ADMIN_REQUIRED/);
    assert.equal((await action("status")).settings.auto_enabled, false);
    assert.equal((await action("status")).jobs.length, 0);
    await assert.rejects(
      action("enable", { enabled: true, confirmed_received: true }),
      /MAIL_TEST_REQUIRED/,
    );
    const testId = randomUUID(),
      testOwner = randomUUID();
    const first = await action("test_claim", { id: testId, owner: testOwner });
    assert.equal(first.recipient, "admin@example.test");
    assert.equal(
      (await action("test_claim", { id: testId, owner: randomUUID() })).claimed,
      false,
    );
    await assert.rejects(
      action("test_finish", {
        id: testId,
        owner: randomUUID(),
        status: "accepted",
      }),
      /MAIL_CHANGED/,
    );
    await action("test_finish", {
      id: testId,
      owner: testOwner,
      status: "accepted",
      accepted: ["admin@example.test", orderCopy],
    });
    await assert.rejects(
      action("enable", { enabled: true, confirmed_received: false }),
      /MAIL_TEST_REQUIRED/,
    );
    await action("enable", { enabled: true, confirmed_received: true });
    assert.equal((await action("status")).jobs.length, 0);
    assert.equal(
      (await action("claim", { id: old, owner: randomUUID() }, buyer)).status,
      "not_queued",
    );
    await auth(buyer);
    const order = await place("NVH-0002", "PO-NEW");
    assert.equal(await place("NVH-0002", "PO-OTHER"), order);
    await service();
    assert.equal((await action("status")).jobs.length, 1);
    assert.equal(
      (await action("claim", { id: order, owner: randomUUID() }, colleague))
        .status,
      "not_applicable",
    );
    let owner = randomUUID();
    const claimed = await action("claim", { id: order, owner }, buyer);
    assert.equal(claimed.claimed, true);
    assert.equal(claimed.payload.customer_reference, "PO-NEW");
    assert.equal(claimed.payload.recipient, "buyer@example.test");
    assert.equal(claimed.payload.items[0].total_cents, 12100);
    assert.equal(
      (await action("claim", { id: order, owner: randomUUID() }, buyer))
        .claimed,
      false,
    );
    await action(
      "finish",
      {
        id: order,
        owner,
        status: "uncertain",
        error_code: "SMTP_RESULT_UNCERTAIN",
        accepted: [],
      },
      buyer,
    );
    assert.equal(
      (await action("claim", { id: order, owner: randomUUID() }, buyer)).status,
      "uncertain",
    );
    await auth(buyer);
    const retry = await place("NVH-0003", "PO-RETRY");
    await service();
    owner = randomUUID();
    await action("claim", { id: retry, owner }, buyer);
    await action(
      "finish",
      {
        id: retry,
        owner,
        status: "failed",
        error_code: "SMTP_AUTH",
        accepted: [],
      },
      buyer,
    );
    owner = randomUUID();
    assert.equal(
      (await action("claim", { id: retry, owner }, buyer)).claimed,
      true,
    );
    await action(
      "finish",
      {
        id: retry,
        owner,
        status: "accepted",
        accepted: ["buyer@example.test", orderCopy],
      },
      buyer,
    );
    assert.equal(
      (await action("claim", { id: retry, owner: randomUUID() }, buyer)).status,
      "accepted",
    );
    assert.equal(
      (await action("status")).jobs.find((j) => j.order_id === retry).attempts,
      2,
    );
    await action("enable", { enabled: false });
    await auth(buyer);
    await place("NVH-0004", "PO-PAUSED");
    await service();
    assert.equal((await action("status")).jobs.length, 2);
    assert.equal(
      (await action("claim", { id: order, owner: randomUUID() }, buyer)).status,
      "disabled",
    );
    await auth(colleague);
    await assert.rejects(
      db.exec("select * from private.order_confirmation_mail"),
      /permission denied/,
    );
    await db.exec("reset role");
    assert.equal(
      (await db.query("select count(*)::int n from public.orders")).rows[0].n,
      4,
    );
  } finally {
    await db.close();
  }
});
