import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Variáveis de ambiente do Supabase (URL/ANON_KEY) não configuradas no servidor.");
}

// Cliente público/padrão (segue regras de RLS)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cliente administrador (ignora regras de RLS, usar com cautela apenas no servidor)
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : supabase;
