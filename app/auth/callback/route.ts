import { NextResponse } from 'next/server';
import { serverClient } from '../../../lib/supabase/server';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const target = url.searchParams.get('next') === '/reset-password' ? '/reset-password' : '/#account';
  if (code) {
    try {
      const client = await serverClient();
      const {error} = await client.auth.exchangeCodeForSession(code);
      if (!error) return new NextResponse(null, {status:303,headers:{Location:target,'Cache-Control':'no-store'}});
    } catch { /* Display a safe, actionable error without token details. */ }
  }
  return new NextResponse(null, {status:303,headers:{Location:'/?auth_error=1#inloggen','Cache-Control':'no-store'}});
}
