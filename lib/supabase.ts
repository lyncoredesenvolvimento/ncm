import { createClient } from "@supabase/supabase-js";

// ──────────────────────────────────────────────────────────────────────────────
// Cliente PÚBLICO — usado em Client Components ("use client")
// As variáveis NEXT_PUBLIC_* são expostas ao browser intencionalmente.
// ──────────────────────────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ──────────────────────────────────────────────────────────────────────────────
// Cliente ADMIN — usado APENAS em Server Components e API Routes (servidor)
// NUNCA expor SUPABASE_SERVICE_ROLE_KEY ao browser.
// ──────────────────────────────────────────────────────────────────────────────
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : supabase;
