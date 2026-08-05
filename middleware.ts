import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  // No middleware do Next.js, criamos o cliente do Supabase e repassamos os cookies
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
  });

  // Obter o token de autenticação dos cookies do Supabase
  // O Supabase salva a sessão no cookie 'sb-access-token' ou similar,
  // ou podemos usar a estratégia padrão de ler a sessão pelo cookie da request
  const token = request.cookies.get("sb-access-token")?.value || 
                request.cookies.get("supabase-auth-token")?.value;

  // Para garantir segurança máxima em SSR, o Supabase recomenda verificar a sessão
  // utilizando o cookie 'sb-ldhvwtcueekexvviwrkw-auth-token' (ID do seu projeto) ou simplesmente buscar o usuário
  // Vamos buscar cookies que começam com 'sb-' e terminam com '-auth-token' para sermos dinâmicos e robustos
  let isAuthenticated = false;
  const cookieNames = request.cookies.getAll().map(c => c.name);
  const authCookieName = cookieNames.find(name => name.startsWith("sb-") && name.endsWith("-auth-token"));
  
  if (authCookieName) {
    const authCookie = request.cookies.get(authCookieName)?.value;
    if (authCookie) {
      try {
        // O cookie do Supabase armazena um JSON com access_token
        const parsed = JSON.parse(authCookie);
        if (parsed && parsed.access_token) {
          isAuthenticated = true;
        }
      } catch (e) {
        // Não é JSON ou está corrompido
      }
    }
  }

  // Rotas privadas
  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isAuthRoute = pathname === "/";

  if (isDashboardRoute && !isAuthenticated) {
    // Redireciona para o login se tentar acessar área restrita deslogado
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (isAuthRoute && isAuthenticated) {
    // Redireciona para o dashboard se tentar acessar o login já autenticado
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Configurar as rotas nas quais o middleware deve rodar
export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
