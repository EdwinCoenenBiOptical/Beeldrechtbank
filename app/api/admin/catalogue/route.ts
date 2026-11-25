import {
  moneybirdAdmin,
  originCheck,
  uuid,
  AdminError,
  headers,
  fail,
} from "../../../../lib/moneybird/server";
import {
  CatalogueError,
  parseCatalogue,
} from "../../../../lib/catalogue/csv.mjs";
import {
  catalogueAction,
  preparePreview,
  storedPreview,
} from "../../../../lib/catalogue/server";
export const runtime = "nodejs";
export const maxDuration = 60;
function errorResponse(error: unknown) {
  if (error instanceof AdminError) return fail(error.message, error.status);
  if (error instanceof CatalogueError) return fail(error.message, 400);
  return fail(
    "Het catalogusbeheer is nog niet bereikbaar. Controleer script 017 en de serverinstellingen.",
    503,
  );
}
export async function GET(request: Request) {
  try {
    const { user } = await moneybirdAdmin(),
      url = new URL(request.url),
      batch = url.searchParams.get("batch_id"),
      preview = url.searchParams.get("preview");
    if (batch && !uuid(batch)) return fail("Ongeldige import.", 400);
    if (preview) {
      if (!uuid(preview) || !batch) return fail("Ongeldige preview.", 400);
      const { key } = await catalogueAction(user.id, "draft_preview", {
        batch_id: batch,
        id: preview,
      });
      if (!key) return fail("Deze preview is nog niet beschikbaar.", 404);
      return new Response(await storedPreview(key), {
        headers: {
          ...headers,
          "Content-Type": "image/jpeg",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const page = Number(url.searchParams.get("page") || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000)
      return fail("Ongeldige pagina.", 400);
    return Response.json(
      await catalogueAction(user.id, "status", { batch_id: batch, page }),
      { headers },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    originCheck(request);
    const { user } = await moneybirdAdmin();
    if (Number(request.headers.get("content-length")) > 3 * 1024 * 1024)
      return fail("De aanvraag is te groot.", 413);
    const text = await request.text();
    if (Buffer.byteLength(text) > 3 * 1024 * 1024)
      return fail("De aanvraag is te groot.", 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return fail("Ongeldige aanvraag.", 400);
    }
    if (["validate", "stage"].includes(body?.action)) {
      const result = parseCatalogue(body.csv);
      if (body.action === "validate" || result.errors.length)
        return Response.json(
          { ...result, rows: undefined, sample: result.rows.slice(0, 10) },
          { headers },
        );
      if (
        body.confirmed !== true ||
        !uuid(body.batch_id) ||
        body.hash !== result.hash
      )
        return fail("Controleer en bevestig eerst deze CSV.", 400);
      return Response.json(
        await catalogueAction(user.id, "stage", {
          batch_id: body.batch_id,
          hash: result.hash,
          rows: result.rows,
          summary: result.summary,
          warnings: result.warnings,
        }),
        { headers },
      );
    }
    if (!uuid(body?.batch_id)) return fail("Kies een geldige import.", 400);
    if (body.action === "next")
      return Response.json(
        {
          ids: await catalogueAction(user.id, "next", {
            batch_id: body.batch_id,
          }),
        },
        { headers },
      );
    if (body.action === "prepare" && uuid(body.id))
      return Response.json(
        await preparePreview(user.id, body.batch_id, body.id),
        { headers },
      );
    if (body.action === "publish" && body.confirmed === true)
      return Response.json(
        await catalogueAction(user.id, "publish", { batch_id: body.batch_id }),
        { headers },
      );
    return fail("Ongeldige catalogusactie.", 400);
  } catch (e) {
    return errorResponse(e);
  }
}
