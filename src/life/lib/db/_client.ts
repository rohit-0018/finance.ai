// Shared supabase client re-export so db modules don't all import supabaseLife
// directly. Gives one throat to choke if we change the transport.
export { lifeDb, isLifeDbConfigured } from '../supabaseLife'
