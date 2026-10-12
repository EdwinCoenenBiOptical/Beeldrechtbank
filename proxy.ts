import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseConfig } from './lib/supabase/config';
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = supabaseConfig();
  if (!config) return response;
  const client = createServerClient(config.url, config.key, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: (values) => {
      values.forEach(({name, value}) => request.cookies.set(name, value));
      response = NextResponse.next({request});
      values.forEach(({name, value, options}) => response.cookies.set(name, value, options));
    },
  }});
  try { await client.auth.getUser(); } catch { /* Public catalogue remains available during auth outages. */ }
  return response;
}
export const config = {matcher: ['/api/account', '/api/prices', '/api/orders/:path*', '/api/onedrive/:path*', '/auth/callback', '/reset-password']};
