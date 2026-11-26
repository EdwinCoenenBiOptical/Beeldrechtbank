import { drawings } from "../../../lib/drawings";
import {
  requireApproved,
  portalFailure,
  PortalError,
  privateHeaders,
} from "../../../lib/portal/server";
export async function GET() {
  try {
    const { client } = await requireApproved();
    const { data, error } = await client.rpc("catalogue_public_rows");
    if (error)
      throw new PortalError("De beeldbank is tijdelijk niet bereikbaar.", 503);
    if (data?.active)
      return Response.json(
        { drawings: data.drawings, isSample: false },
        { headers: privateHeaders },
      );
    return Response.json(
      {
        drawings: drawings.map((d) => ({
          ...d,
          key: "NVH-" + String(d.id).padStart(4, "0"),
          preview: "/api/catalogue/samples/" + d.id,
          isSample: true,
        })),
        isSample: true,
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return portalFailure(error);
  }
}
