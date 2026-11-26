import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  requireApproved,
  portalFailure,
  privateHeaders,
} from "../../../../../lib/portal/server";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApproved();
    const { id } = await params;
    if (!/^(?:[1-9]|1[0-2])$/.test(id))
      return new Response(null, { status: 404, headers: privateHeaders });
    const bytes = await readFile(
      path.join(process.cwd(), "assets/sample-previews", `drawing-${id}.jpg`),
    );
    return new Response(bytes, {
      headers: { ...privateHeaders, "Content-Type": "image/jpeg" },
    });
  } catch (error) {
    return portalFailure(error);
  }
}
