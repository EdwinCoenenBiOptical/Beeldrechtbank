import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfig } from './config';
export async function serverClient() {
  const config = supabaseConfig();
  if (!config) throw new Error('Missing Supabase configuration');
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (values) => values.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}
