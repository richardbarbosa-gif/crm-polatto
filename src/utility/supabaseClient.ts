import { createClient } from "@refinedev/supabase";

const SUPABASE_URL = "https://javpzpyuonecoxxonapd.supabase.co";
const SUPABASE_KEY = "sb_publishable_JWPeytnf8Yxxjool01IrxA_vG4WeJon"

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
  db: {
    schema: "public",
  },
  auth: {
    persistSession: true,
  },
});
