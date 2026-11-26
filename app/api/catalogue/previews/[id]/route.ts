import {
  requireApproved,
  portalFailure,
  privateHeaders,
} from "../../../../../lib/portal/server";
import {
  catalogueAction,
  storedPreview,
} from "../../../../../lib/catalogue/server";
import { uuid } from "../../../../../lib/moneybird/server";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params,
    version = new URL(request.url).searchParams.get("v");
  const headers = privateHeaders;
  if (!uuid(id) || !version || !/^[a-f0-9]{64}$/.test(version))
    return new Response(null, { status: 404, headers });
  try {
    await requireApproved();
    const { key } = await catalogueAction(null, "public_preview", {
      id,
      version,
    });
    if (!key) return new Response(null, { status: 404, headers });
    return new Response(await storedPreview(key), {
      headers: {
        ...headers,
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return portalFailure(error);
  }
}
