import { createClient } from "@supabase/supabase-js";
import { drawings } from "../../../lib/drawings";
import { supabaseConfig } from "../../../lib/supabase/config";
export async function GET() {
  const headers = { "Cache-Control": "no-store" },
    config = supabaseConfig();
  if (config) {
    const client = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc("catalogue_public_rows");
    if (!error && data?.active)
      return Response.json(
        { drawings: data.drawings, isSample: false },
        { headers },
      );
    // Only a not-yet-installed migration may fall back. A provider outage must not replace a real catalogue with fixtures.
    if (error && error.code !== "PGRST202" && error.code !== "42883")
      return Response.json(
        { error: "De beeldbank is tijdelijk niet bereikbaar." },
        { status: 503, headers },
      );
  }
  return Response.json(
    {
      drawings: drawings.map((d) => ({
        ...d,
        key: "NVH-" + String(d.id).padStart(4, "0"),
        isSample: true,
      })),
      isSample: true,
    },
    { headers },
  );
}
