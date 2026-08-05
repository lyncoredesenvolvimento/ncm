import { createClient } from "@supabase/supabase-js";

// Variáveis públicas — disponíveis no browser (prefixo NEXT_PUBLIC_ obrigatório)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Variável secreta — disponível APENAS no servidor (API Routes)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

// Cliente público (usado em Client Components e páginas)
export const supabase = createClient(
  supabaseUrl || "https://placeholder.supabase.co",
  supabaseAnonKey || "placeholder-anon-key"
);

// Cliente admin (usado APENAS em API Routes no servidor — NUNCA expor ao browser)
export const supabaseAdmin = supabaseServiceKey
  ? createClient(
      supabaseUrl || "https://placeholder.supabase.co",
      supabaseServiceKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      }
    )
  : supabase;

// Retorna true se o cliente está corretamente configurado com variáveis reais
export function isSupabaseConfigured(): boolean {
  return Boolean(
    supabaseUrl &&
      supabaseUrl !== "https://placeholder.supabase.co" &&
      supabaseAnonKey &&
      supabaseAnonKey !== "placeholder-anon-key"
  );
}
