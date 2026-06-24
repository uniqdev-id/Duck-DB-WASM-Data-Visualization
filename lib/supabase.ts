/**
 * Supabase browser client — singleton.
 *
 * Stores chart *definitions* only (AGENTS.md rule 5).
 * Never used for DuckDB queries or dataset rows.
 *
 * Works in both Server Components (Node.js) and Client Components (browser)
 * because both env vars are NEXT_PUBLIC_ prefixed.
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
      "must be set in .env.local"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
