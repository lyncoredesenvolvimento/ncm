import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Proxy de proteção de rotas.
 * 
 * O Supabase v2 fragmenta os cookies de sessão em múltiplas partes:
 * sb-<ref>-auth-token, sb-<ref>-auth-token.0, sb-<ref>-auth-token.1, etc.
 * 
 * Para garantir compatibilidade, verificamos a existência de QUALQUER cookie
 * cujo nome contenha o padrão de autenticação do Supabase.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const allCookies = request.cookies.getAll();
  
  // Supabase v2 usa cookies fragmentados: sb-*-auth-token, sb-*-auth-token.0, etc.
  // Basta verificar se EXISTE qualquer cookie de sessão do Supabase
  const hasSupabaseAuthCookie = allCookies.some(
    (c) =>
      c.name.includes("-auth-token") ||
      c.name.startsWith("sb-") ||
      c.name === "supabase-auth-token"
  );

  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isAuthRoute = pathname === "/";

  // Redireciona para login se tentar acessar rota privada sem sessão
  if (isDashboardRoute && !hasSupabaseAuthCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Redireciona para dashboard se já autenticado e tentar acessar o login
  if (isAuthRoute && hasSupabaseAuthCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
