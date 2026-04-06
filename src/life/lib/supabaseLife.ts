// Second supabase client — points at the LIFE database (separate Supabase project).
// Env vars expected in .env:
//   VITE_LIFE_SUPABASE_URL
//   VITE_LIFE_SUPABASE_ANON_KEY
//
// Will throw at first query if env vars are missing — that's intentional so it
// fails loud when an admin opens /life without provisioning the DB.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let _client: SupabaseClient | null = null

export function lifeDb(): SupabaseClient {
  if (_client) return _client
  const url = import.meta.env.VITE_LIFE_SUPABASE_URL
  const key = import.meta.env.VITE_LIFE_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error(
      'Life DB not configured. Set VITE_LIFE_SUPABASE_URL and VITE_LIFE_SUPABASE_ANON_KEY in .env'
    )
  }
  _client = createClient(url, key)
  return _client
}

export function isLifeDbConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_LIFE_SUPABASE_URL && import.meta.env.VITE_LIFE_SUPABASE_ANON_KEY
  )
}
