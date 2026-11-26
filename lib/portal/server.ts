import "server-only";
import { serverClient } from "../supabase/server";
export class PortalError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export const privateHeaders = {
  "Cache-Control": "private, no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function portalAccess() {
  const client = await serverClient(),
    {
      data: { user },
      error,
    } = await client.auth.getUser();
  if (error || !user)
    throw new PortalError("Log in om Beeldrechtbank te bekijken.", 401);
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("status,company_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError || !profile)
    throw new PortalError(
      "Je accountstatus kon niet worden gecontroleerd. Probeer opnieuw.",
      503,
    );
  return {
    client,
    user,
    profile,
    approved:
      !!user.email_confirmed_at &&
      profile.status === "approved" &&
      !!profile.company_id,
  };
}
export async function requireApproved() {
  const access = await portalAccess();
  if (!access.approved)
    throw new PortalError("Je account moet eerst worden goedgekeurd.", 403);
  return access;
}
export function portalFailure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof PortalError
          ? error.message
          : "De accountdienst is tijdelijk niet bereikbaar.",
    },
    {
      status: error instanceof PortalError ? error.status : 503,
      headers: privateHeaders,
    },
  );
}
export function portalOrigin(request: Request) {
  try {
    if (
      !request.headers.get("origin") ||
      new URL(request.headers.get("origin")!).host !==
        request.headers.get("host")
    )
      throw Error();
  } catch {
    throw new PortalError("Ongeldige aanvraag.", 403);
  }
}
