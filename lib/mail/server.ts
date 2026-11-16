import "server-only";
import { randomUUID } from "node:crypto";
import { serviceClient } from "../supabase/service";
import {
  mailConfiguration,
  orderConfirmation,
  demoOrder,
  deliverOrder,
} from "./order-confirmation.mjs";
import { rootnetTransport } from "./transport.mjs";
export function orderMailConfig() {
  return mailConfiguration();
}
export function sendingEnabled() {
  return process.env.ORDER_MAIL_ENABLED === "true";
}
export async function mailAction(
  actor: string,
  action: string,
  data: Record<string, unknown> = {},
) {
  const { data: result, error } = await serviceClient().rpc(
    "server_order_mail",
    { p_actor_id: actor, p_action: action, p_data: data },
  );
  if (error)
    throw Error(
      error.message.includes("ADMIN_REQUIRED")
        ? "MONEYBIRD_ADMIN_CHANGED"
        : error.message.includes("MAIL_TEST_REQUIRED")
          ? "ORDER_MAIL_TEST_REQUIRED"
          : "ORDER_MAIL_DATABASE",
    );
  return result;
}
async function send(message: ReturnType<typeof orderConfirmation>) {
  const transport = rootnetTransport(orderMailConfig());
  try {
    return await deliverOrder(message, (mail: any) => transport.sendMail(mail));
  } finally {
    try {
      transport.close();
    } catch {
      /* Closing a completed connection cannot change the accepted outcome. */
    }
  }
}
export async function dispatchOrderConfirmation(
  actor: string,
  orderId: string,
) {
  if (!sendingEnabled()) return { status: "disabled" };
  orderMailConfig(); // Validate before claiming; a missing configuration cannot strand an order in 'sending'.
  const owner = randomUUID(),
    job = await mailAction(actor, "claim", { id: orderId, owner });
  if (!job.claimed) return { status: job.status };
  let message;
  try {
    message = orderConfirmation(job.payload, { appUrl: process.env.APP_URL });
  } catch {
    return mailAction(actor, "finish", {
      id: orderId,
      owner,
      status: "failed",
      error_code: "ORDER_MAIL_PREPARATION",
      accepted: [],
    });
  }
  const result = await send(message).catch(() => ({
    status: "uncertain",
    error_code: "SMTP_RESULT_UNCERTAIN",
    accepted: [],
  }));
  return mailAction(actor, "finish", { id: orderId, owner, ...result });
}
export async function sendOrderMailTest(actor: string, id: string) {
  if (!sendingEnabled()) throw Error("ORDER_MAIL_DISABLED");
  orderMailConfig();
  const owner = randomUUID(),
    job = await mailAction(actor, "test_claim", { id, owner });
  if (!job.claimed) return { status: job.status };
  let message;
  try {
    message = orderConfirmation(demoOrder(job.recipient), {
      appUrl: process.env.APP_URL,
      test: true,
      to: job.recipient,
      messageKey: id,
    });
  } catch {
    return mailAction(actor, "test_finish", {
      id,
      owner,
      status: "failed",
      error_code: "ORDER_MAIL_PREPARATION",
      accepted: [],
    });
  }
  const result = await send(message).catch(() => ({
    status: "uncertain",
    error_code: "SMTP_RESULT_UNCERTAIN",
    accepted: [],
  }));
  return mailAction(actor, "test_finish", { id, owner, ...result });
}
