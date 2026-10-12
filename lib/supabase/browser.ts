import { createBrowserClient } from '@supabase/ssr';
import { supabaseConfig } from './config';
export function browserClient() {
  const config = supabaseConfig();
  if (!config) throw new Error('De accountdienst is nog niet ingesteld.');
  return createBrowserClient(config.url, config.key);
}
