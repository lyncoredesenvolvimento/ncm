import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware de proteção de rotas.
 * 
 * Roda no Edge Runtime da Vercel — NÃO pode usar Node.js APIs (crypto, fs, etc).
 * Apenas manipulação de cookies e redirecionamentos são permitidos aqui.
 * 
 * Estratégia: detectar o cookie de sessão do Supabase para saber se o usuário
 * está autenticado, sem chamar o SDK (que pode usar APIs Node.js internas).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // O Supabase salva a sessão num cookie cujo nome segue o padrão:
  // sb-<project-ref>-auth-token
  // Verificamos se existe QUALQUER cookie que começa com "sb-" e termina com "-auth-token"
  const allCookies = request.cookies.getAll();
  const authCookie = allCookies.find(
    (c) => c.name.startsWith("sb-") && c.name.endsWith("-auth-token")
  );

  let isAuthenticated = false;

  if (authCookie?.value) {
    try {
      // O valor pode ser URL-encoded — decodificar antes de parsear
      const decoded = decodeURIComponent(authCookie.value);
      // O Supabase armazena um array [access_token, ...] ou um objeto {access_token}
      const parsed = JSON.parse(decoded);
      const accessToken = Array.isArray(parsed)
        ? parsed[0]
        : parsed?.access_token;
      if (accessToken && typeof accessToken === "string" && accessToken.length > 10) {
        isAuthenticated = true;
      }
    } catch {
      // Cookie inválido ou corrompido — tratar como não autenticado
    }
  }

  const isDashboardRoute = pathname.startsWith("/dashboard");
  const isAuthRoute = pathname === "/";

  // Redireciona para login se tentar acessar rota privada sem sessão
  if (isDashboardRoute && !isAuthenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Redireciona para dashboard se já autenticado e tentar acessar o login
  if (isAuthRoute && isAuthenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
