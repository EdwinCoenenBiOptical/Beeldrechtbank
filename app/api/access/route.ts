import {
  portalAccess,
  portalFailure,
  privateHeaders,
} from "../../../lib/portal/server";
export async function GET() {
  try {
    const { approved, profile } = await portalAccess();
    return Response.json(
      { authenticated: true, approved, status: profile.status },
      { headers: privateHeaders },
    );
  } catch (error) {
    return portalFailure(error);
  }
}
