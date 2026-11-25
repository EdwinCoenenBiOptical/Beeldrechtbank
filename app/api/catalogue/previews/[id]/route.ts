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
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!uuid(id) || !version || !/^[a-f0-9]{64}$/.test(version))
    return new Response(null, { status: 404, headers });
  try {
    const { key } = await catalogueAction(null, "public_preview", {
      id,
      version,
    });
    if (!key) return new Response(null, { status: 404, headers });
    return new Response(await storedPreview(key), {
      headers: {
        ...headers,
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
